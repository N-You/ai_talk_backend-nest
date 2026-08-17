import { ConfigService } from "@nestjs/config";
import { TTSBackend, TTSInput, TTSResult } from "../interfaces/tts-backend.interface";

/**
 * 阿里云百炼 Qwen-Audio-3.0-TTS-Flash 实现。
 * 调用链：
 * 1. POST /api/v1/services/audio/tts/SpeechSynthesizer (Bearer key)
 *    body: { model, input: { text, voice, format: "wav" } }
 * 2. 响应是 JSON（非音频流）：output.audio.url = OSS 临时签名链接（约 10 分钟有效）
 * 3. 后端下载 url 得到 WAV buffer 返回给上层
 *
 * 为什么后端中转下载而不是直接把 url 给前端：
 * - url 是 http://（非 https），https 页面播放会触发浏览器混合内容拦截
 * - url 带时效签名，前端缓存会过期；后端中转后前端拿到的是自持 buffer
 *
 * 健壮性（对齐 ASR 后端）：合成请求与音频下载均带 60s 超时（AbortController），
 * 429/5xx/网络错误指数退避重试（最多 2 次）——防止上游挂起让前端"等待朗读"永久悬停。
 */
export class AliyunTtsBackend implements TTSBackend {
  readonly provider = "dashscope";

  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly model: string;
  private readonly defaultVoice: string;

  /** 单次请求超时（毫秒） */
  private readonly REQUEST_TIMEOUT_MS = 60_000;
  /** 可重试状态码：服务端错误 / 限流 */
  private readonly RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
  /** 最多重试次数（指数退避 0.5s×2^n + 抖动，与 ASR 后端一致） */
  private readonly MAX_RETRY = 2;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>("speech.dashscopeApiKey") ?? "";
    this.apiBase = (config.get<string>("speech.dashscopeBase") ?? "https://dashscope.aliyuncs.com").replace(
      /\/$/,
      "",
    );
    this.model = config.get<string>("speech.ttsModel") ?? "qwen-audio-3.0-tts-flash";
    this.defaultVoice = config.get<string>("speech.ttsVoice") ?? "longanhuan_v3.6";
  }

  async synthesize(input: TTSInput): Promise<TTSResult> {
    if (!this.apiKey) {
      throw new Error("DASHSCOPE_API_KEY not configured (阿里云百炼 API Key)");
    }

    // 1. 合成，拿音频 URL（带超时 + 重试）
    const body = {
      model: this.model,
      input: {
        text: input.text,
        voice: input.voice ?? this.defaultVoice,
        format: "wav",
        ...(input.speed ? { rate: input.speed } : {}),
      },
    };
    const res = await this.fetchWithRetry(`${this.apiBase}/api/v1/services/audio/tts/SpeechSynthesizer`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json: any = await res.json();
    const audioUrl: string | undefined = json?.output?.audio?.url;
    if (!audioUrl) {
      throw new Error("DashScope TTS: no audio url in response");
    }

    // 2. 下载音频 buffer（OSS 临时签名链接，立即取走；同样带超时 + 重试）
    const audioRes = await this.fetchWithRetry(audioUrl);
    const audio = Buffer.from(await audioRes.arrayBuffer());

    return {
      audio,
      mimeType: "audio/wav",
      durationSec: 0,
    };
  }

  /**
   * 带超时 + 重试的 fetch：
   * - 60s 超时（AbortController）→ 抛明确超时错误
   * - 429/5xx/网络错误 → 指数退避重试（最多 MAX_RETRY 次）；其余 4xx 不重试
   */
  private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt <= this.MAX_RETRY; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, { ...init, signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok) return res;

        const detail = await res.text().catch(() => "");
        const err = new Error(`DashScope TTS error ${res.status}: ${detail.slice(0, 300)}`);
        if (!this.RETRYABLE_STATUS.has(res.status)) throw err; // 4xx（非 429）不重试
        lastErr = err;
      } catch (err) {
        clearTimeout(timer);
        const e = err as Error;
        if (e.name === "AbortError") {
          throw new Error("DashScope TTS timeout (60s)");
        }
        if (attempt >= this.MAX_RETRY) throw e;
        lastErr = e;
      }

      // 指数退避 + 抖动，避免并发重试踩踏（与 ASR 后端一致）
      const delay = 500 * 2 ** attempt * (0.7 + Math.random() * 0.6);
      console.warn(`[DashScope TTS] 请求失败，${Math.round(delay)}ms 后重试 (${attempt + 1}/${this.MAX_RETRY}): ${lastErr?.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
    throw lastErr ?? new Error("DashScope TTS request failed");
  }
}
