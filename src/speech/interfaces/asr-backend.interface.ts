/**
 * ASR (Speech-to-Text) 后端契约
 *
 * 复刻 voicebox backend/backends/base.py 中 STTBackend Protocol 的设计思想:
 * - Protocol 只定义最小契约, 实现与调用方完全解耦
 * - 工厂 (SpeechModule 的 factory Provider) 按配置选择具体实现, 等价 get_stt_backend()
 *
 * 与 voicebox 的刻意差异 (云端策略):
 * - voicebox 的 STTBackend 有 load_model / is_loaded / unload_model 四个方法,
 *   因为本地 Whisper 模型需要显式管理显存生命周期
 * - 云端 API 没有本地模型, 生命周期方法退化为可选 (isLoaded? / unload?),
 *   为将来接入本地 sidecar (whisper.cpp 等) 保留扩展位, 上层代码零改动
 */
export interface ASRBackend {
  /** 后端标识, 如 "openai" / "tencent" / "local-whisper" */
  readonly provider: string;

  /** 转写一段音频为文本 (等价 voicebox STTBackend.transcribe) */
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;

  /** 本地模型后端扩展位: 模型是否已加载 (云端实现不需要) */
  isLoaded?(): boolean;

  /** 本地模型后端扩展位: 卸载模型释放显存 (云端实现不需要) */
  unload?(): void;
}

export interface TranscribeInput {
  /**
   * 音频二进制。
   * voicebox 本地链路必须先把 WebM/Opus 转码成 WAV (miniaudio 解码器限制),
   * 云端 API 原生支持 webm/ogg/mp3/m4a 等格式 —— 转码桥接在这里整体消失,
   * 这正是云端策略相对 voicebox 本地链路的结构性优势。
   */
  audio: Buffer;
  /** 原始 MIME 类型, 云端服务端依赖它解码 */
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
