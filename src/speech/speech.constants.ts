/**
 * 后端注入 token。
 * 等价 voicebox get_stt_backend() / get_tts_backend_for_engine() 的"注册表键",
 * Nest 里用 Symbol 作为依赖注入的 key。
 */
export const ASR_BACKEND = Symbol("ASR_BACKEND");
export const TTS_BACKEND = Symbol("TTS_BACKEND");
