import { ConfigService } from "@nestjs/config";
import { ASRBackend, TranscribeInput, TranscribeResult } from "../interfaces/asr-backend.interface";

/**
 * OpenAI Whisper API 云端 ASR 实现。
 *
 * 对应 voicebox 的 MLXSTTBackend / PyTorchSTTBackend, 但省掉了整个模型生命周期:
 * - voicebox 本地链路: 检查模型缓存 -> (202 + 后台下载) -> load_model -> transcribe -> unload
 * - 云端链路: multipart 直传, 服务端解码推理, 无下载/加载/卸载
 *
 * 因此 voicebox 的 HTTP 202 异步下载模式在云端实现中不需要 —— 那是"大模型懒加载"
 * 的产物, 不是转写流程本身的产物。将来换本地 sidecar 时, 由该 provider 自己
 * 决定是否引入下载进度模式。
 */
export class OpenAiAsrBackend implements ASRBackend {
  readonly provider = "openai";

  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly defaultModel: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>("ai.apiKey") ?? "";
    this.apiBase = (config.get<string>("ai.apiBase") ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.defaultModel = config.get<string>("speech.asrModel") ?? "gpt-4o-transcribe";
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    if (!this.apiKey) {
      // 与 AiService 的 fallback 不同: 转写失败宁可报错, 不能编造文本
      throw new Error("OpenAI API key not configured (OPENAI_API_KEY)");
    }

    const form = new FormData();
    const ext = this.extFromMime(input.mimeType);
    // Buffer<ArrayBufferLike> 与 BlobPart 类型不兼容 (@types/node 22 泛型),
    // new Uint8Array() 拷贝出标准 Uint8Array<ArrayBuffer> 解决
    const blob = new Blob([new Uint8Array(input.audio)], { type: input.mimeType });
    form.append("file", blob, `audio.${ext}`);
    form.append("model", input.model ?? this.defaultModel);
    // verbose_json 才能拿到 duration / language 字段 (默认 json 只回 text)
    form.append("response_format", "verbose_json");
    if (input.language) form.append("language", input.language);

    let res: Response;
    try {
      res = await fetch(`${this.apiBase}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
    } catch (err) {
      throw new Error(`ASR network error: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`ASR API error ${res.status}: ${detail.slice(0, 300)}`);
    }

    const json: any = await res.json();
    return {
      text: json.text ?? "",
      durationSec: typeof json.duration === "number" ? json.duration : 0,
      language: json.language,
    };
  }

  /** MIME -> 文件扩展名, 供 multipart filename 使用 (服务端按扩展名+类型解码) */
  private extFromMime(mime: string): string {
    const map: Record<string, string> = {
      "audio/wav": "wav",
      "audio/wave": "wav",
      "audio/x-wav": "wav",
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/mp4": "m4a",
      "audio/x-m4a": "m4a",
      "audio/webm": "webm",
      "audio/ogg": "ogg",
      "audio/oga": "oga",
      "audio/flac": "flac",
      "audio/aac": "aac",
    };
    return map[mime] ?? "wav";
  }
}
