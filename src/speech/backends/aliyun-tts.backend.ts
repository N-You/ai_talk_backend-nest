import { ConfigService } from "@nestjs/config";
import { TTSBackend, TTSInput, TTSResult } from "../interfaces/tts-backend.interface";

/**
 * 阿里云百炼 Qwen-Audio-3.0-TTS-Flash 实现。
 *
 * 调用链 (实测确认, 2026-08):
 * 1. POST /api/v1/services/audio/tts/SpeechSynthesizer (Bearer key)
 *    body: { model, input: { text, voice, format: "wav" } }
 * 2. 响应是 JSON (非音频流): output.audio.url = OSS 临时签名链接 (约 10 分钟有效)
 * 3. 后端下载 url 得到 WAV buffer 返回给上层
 *
 * 为什么后端中转下载而不是直接把 url 给前端:
 * - url 是 http:// (非 https), https 页面播放会触发浏览器混合内容拦截
 * - url 带时效签名, 前端缓存会过期; 后端中转后前端拿到的是自持 buffer
 * 这与 voicebox 的"生成 → 版本管理 → 播放"思路一致: 播放层只面对音频数据,
 * 不感知上游 url/签名等传输细节。
 */
export class AliyunTtsBackend implements TTSBackend {
  readonly provider = "dashscope";

  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly model: string;
  private readonly defaultVoice: string;

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

    // 1. 合成, 拿音频 URL
    const body = {
      model: this.model,
      input: {
        text: input.text,
        voice: input.voice ?? this.defaultVoice,
        format: "wav",
        ...(input.speed ? { rate: input.speed } : {}),
      },
    };

    let res: Response;
    try {
      res = await fetch(`${this.apiBase}/api/v1/services/audio/tts/SpeechSynthesizer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`DashScope TTS network error: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`DashScope TTS error ${res.status}: ${detail.slice(0, 300)}`);
    }

    const json: any = await res.json();
    const audioUrl: string | undefined = json?.output?.audio?.url;
    if (!audioUrl) {
      throw new Error("DashScope TTS: no audio url in response");
    }

    // 2. 下载音频 buffer (OSS 临时签名链接, 立即取走)
    let audioRes: Response;
    try {
      audioRes = await fetch(audioUrl);
    } catch (err) {
      throw new Error(`DashScope TTS audio download error: ${(err as Error).message}`);
    }
    if (!audioRes.ok) {
      throw new Error(`DashScope TTS audio download error ${audioRes.status}`);
    }
    const audio = Buffer.from(await audioRes.arrayBuffer());

    return {
      audio,
      mimeType: "audio/wav",
      durationSec: 0,
    };
  }
}
