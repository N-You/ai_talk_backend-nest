/**
 * TTS（文本转语音）后端契约。
 * 云端 TTS 用预设 voice id 即可；isLoaded/unload 为本地模型预留扩展位。
 */
export interface TTSBackend {
  /** 后端标识, 如 "openai" / "volcengine" / "kokoro-local" */
  readonly provider: string;

  /** 合成一段文本为音频 */
  synthesize(input: TTSInput): Promise<TTSResult>;

  /** 本地模型后端扩展位 */
  isLoaded?(): boolean;
  unload?(): void;
}

export interface TTSInput {
  text: string;
  /** 预设音色 id (如 OpenAI "alloy" / "nova") */
  voice?: string;
  language?: string;
  /** 语速倍率 */
  speed?: number;
}

export interface TTSResult {
  audio: Buffer;
  mimeType: string;
  durationSec: number;
}
