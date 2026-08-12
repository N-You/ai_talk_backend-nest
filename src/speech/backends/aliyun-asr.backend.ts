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
 * 关键点:
 * - data URI 格式: data:audio/{fmt};base64,{b64}
 * - 原生支持 webm/opus/m4a 等 18 种格式 (智谱时代"只收 wav/mp3"的转码问题消失)
 * - 按音频时长计费 0.00022 元/秒, 新用户 10 小时免费额度
 * - 支持 stream: true (Phase 2 流式对话用)
 * - 响应为标准 OpenAI 结构: choices[0].message.content
 */
export class AliyunAsrBackend implements ASRBackend {
  readonly provider = "dashscope";

  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>("speech.dashscopeApiKey") ?? "";
    this.apiBase = (
      config.get<string>("speech.dashscopeCompatibleBase") ??
      "https://dashscope.aliyuncs.com/compatible-mode/v1"
    ).replace(/\/$/, "");
    this.model = config.get<string>("speech.asrModel") ?? "qwen3-asr-flash";
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    if (!this.apiKey) {
      // 与 AiService 的 fallback 不同: 转写失败宁可报错, 不能编造文本
      throw new Error("DASHSCOPE_API_KEY not configured (阿里云百炼 API Key)");
    }

    const dataUri = `data:${input.mimeType};base64,${input.audio.toString("base64")}`;
    console.log(
      `[DashScope ASR] mime=${input.mimeType} bytes=${input.audio.length} model=${this.model}`,
    );
    const body = {
      model: this.model,
      messages: [
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: dataUri } }],
        },
      ],
      stream: false,
      asr_options: { enable_itn: false },
    };

    let res: Response;
    try {
      res = await fetch(`${this.apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`DashScope ASR network error: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`DashScope ASR error ${res.status}: ${detail.slice(0, 300)}`);
    }

    const json: any = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    return { text, durationSec: 0, language: undefined };
  }
}
