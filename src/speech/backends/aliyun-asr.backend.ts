import { ConfigService } from "@nestjs/config";
import { ASRBackend, TranscribeInput, TranscribeResult } from "../interfaces/asr-backend.interface";

/**
 * 阿里云百炼 Qwen3-ASR-Flash 实现 (OpenAI 兼容模式)。
 *
 * 通过实测选型 (2026-08): qwen-audio-3.0-asr-flash 的 multimodal-generation
 * 接口要求音频公网 URL (服务端 wget 下载, base64 直传报 "Argument list too long");
 * 而 qwen3-asr-flash 走 compatible-mode/v1/chat/completions, 支持 base64 data URI
 * 直传 —— 免 URL、免 OSS、免转码。这也是三个 provider 里实现最干净的。
 *
 * 关键点 (2026-08 官方文档核实):
 * - data URI 格式: data:audio/{fmt};base64,{b64}
 * - 原生支持 webm/opus/m4a 等 18 种格式 (智谱时代"只收 wav/mp3"的转码问题消失)
 * - **base64 后大小上限 10MB** → 原始音频建议 ≤7MB。超长语音必须切段/缩短,
 *   否则 DashScope 直接 4xx 拒绝 → 这是"长语音识别失败"的根因之一
 * - asr_options 支持 language (en/zh/... 单一语种提示, 中英混合请勿指定) 与
 *   enable_itn (逆文本正则化, 默认 false)
 * - 按音频时长计费 0.00022 元/秒, 新用户 10 小时免费额度
 *
 * 本次参数调优 (2026-08):
 * 1. asr_options 从写死 { enable_itn: false } 改为走配置 (SPEECH_ASR_ENABLE_ITN)
 * 2. 支持 language 提示 (SPEECH_ASR_LANGUAGE 全局 / TranscribeInput.language 单次),
 *    留空则自动检测 —— 本应用是中英混合场景, 默认留空最准
 * 3. 请求 60s 超时 (AbortController) + 5xx/429/网络错误指数退避重试 (最多 2 次),
 *    避免偶发超时直接让用户"识别失败"
 * 4. 入参大小守卫: >7MB 直接拒绝并给出中文提示 (防 base64 超 10MB 上限)
 */

/** 原始音频大小上限 (字节): base64 膨胀 ≈1.37 倍, 7MB → ~9.6MB, 低于 10MB 硬限 */
const MAX_AUDIO_BYTES = 7 * 1024 * 1024;
/** 单次请求超时 (毫秒) */
const REQUEST_TIMEOUT_MS = 60_000;
/** 可重试状态码: 服务端错误/限流 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
/** 最多重试次数 (指数退避 0.5s×2^n) */
const MAX_RETRY = 2;

export class AliyunAsrBackend implements ASRBackend {
  readonly provider = "dashscope";

  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly model: string;
  private readonly enableItn: boolean;
  private readonly asrLanguage: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>("speech.dashscopeApiKey") ?? "";
    this.apiBase = (
      config.get<string>("speech.dashscopeCompatibleBase") ??
      "https://dashscope.aliyuncs.com/compatible-mode/v1"
    ).replace(/\/$/, "");
    this.model = config.get<string>("speech.asrModel") ?? "qwen3-asr-flash";
    this.enableItn = config.get<boolean>("speech.enableItn") ?? false;
    this.asrLanguage = config.get<string>("speech.asrLanguage") ?? "";
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    if (!this.apiKey) {
      // 与 AiService 的 fallback 不同: 转写失败宁可报错, 不能编造文本
      throw new Error("DASHSCOPE_API_KEY not configured (阿里云百炼 API Key)");
    }

    // 大小守卫: base64 直传上限 10MB (官方文档), 原始音频按 7MB 卡
    if (input.audio.length > MAX_AUDIO_BYTES) {
      throw new Error(
        `音频过大 (${(input.audio.length / 1024 / 1024).toFixed(1)}MB > 7MB 上限): ` +
          `DashScope base64 直传限制 10MB, 请缩短录音或减小码率`,
      );
    }

    const dataUri = `data:${input.mimeType};base64,${input.audio.toString("base64")}`;
    console.log(
      `[DashScope ASR] mime=${input.mimeType} bytes=${input.audio.length} model=${this.model} ` +
        `lang=${input.language || this.asrLanguage || "auto"} itn=${this.enableItn}`,
    );

    // 参数调优: asr_options 支持 language + enable_itn
    // - language: 单次请求优先于全局配置; 留空 = 自动检测 (中英混合最准)
    // - enable_itn: 见 config.ts 注释, 默认 false (英语学习保留数字原文)
    const language = input.language || this.asrLanguage || undefined;
    const asrOptions: Record<string, unknown> = { enable_itn: this.enableItn };
    if (language) asrOptions.language = language;

    const body = {
      model: this.model,
      messages: [
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: dataUri } }],
        },
      ],
      stream: false,
      asr_options: asrOptions,
    };

    // 带超时 + 重试的请求 (5xx/429/网络错误指数退避, 最多 2 次)
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        return await this.requestOnce(body);
      } catch (err) {
        const e = err as Error & { status?: number };
        lastErr = e;
        const retryable = !e.status || RETRYABLE_STATUS.has(e.status);
        if (!retryable || attempt >= MAX_RETRY) break;
        // 指数退避 + 抖动, 避免并发重试踩踏
        const delay = 500 * 2 ** attempt * (0.7 + Math.random() * 0.6);
        console.warn(`[DashScope ASR] 请求失败, ${Math.round(delay)}ms 后重试 (${attempt + 1}/${MAX_RETRY}): ${e.message}`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr ?? new Error("DashScope ASR request failed");
  }

  /** 单次 chat/completions 请求 (60s 超时) */
  private async requestOnce(body: Record<string, unknown>): Promise<TranscribeResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${this.apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === "AbortError") {
        throw Object.assign(new Error("DashScope ASR timeout (60s)"), { status: 0 });
      }
      throw Object.assign(new Error(`DashScope ASR network error: ${e.message}`), { status: 0 });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw Object.assign(
        new Error(`DashScope ASR error ${res.status}: ${detail.slice(0, 300)}`),
        { status: res.status },
      );
    }

    const json: any = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    // 时长信息可后续用于计费统计; 当前返回 0 表示未知
    return { text, durationSec: 0, language: undefined };
  }
}
