/**
 * TTS (Text-to-Speech) 后端契约
 *
 * 复刻 voicebox TTSBackend Protocol 的抽象思想。
 * 刻意精简: voicebox 的 TTSBackend 还有 create_voice_prompt / combine_voice_prompts
 * (声音克隆链路), 云端 TTS 用预设 voice id 即可, 克隆留作后续扩展。
 *
 * Phase 0 只建契约 + 注册位, 实现与路由在 Phase 1 (voicebox TTS 模块分析后) 接入。
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
