/**
 * ASR（语音转文本）后端契约。
 * - 最小契约 + 工厂注入（speech.module）：实现与调用方解耦
 * - 云端实现不需要本地模型，isLoaded/unload 为本地模型（如 whisper.cpp）预留的扩展位
 */
export interface ASRBackend {
  /** 后端标识，如 "openai" / "tencent" / "local-whisper" */
  readonly provider: string;

  /** 转写一段音频为文本 */
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;

  /** 本地模型后端扩展位: 模型是否已加载 (云端实现不需要) */
  isLoaded?(): boolean;

  /** 本地模型后端扩展位: 卸载模型释放显存 (云端实现不需要) */
  unload?(): void;
}

export interface TranscribeInput {
  /** 音频二进制（云端 API 原生支持 webm/ogg/mp3/m4a 等，无需转码） */
  audio: Buffer;
  /** 原始 MIME 类型，服务端依赖它解码 */
  mimeType: string;
  /** 可选: 语言提示 (ISO 639-1, 如 "en" / "zh"), 传了可提升准确率 */
  language?: string;
  /** 可选: 覆盖默认模型 (如 "whisper-1" / "gpt-4o-transcribe") */
  model?: string;
}

export interface TranscribeResult {
  text: string;
  durationSec: number;
  language?: string;
}
