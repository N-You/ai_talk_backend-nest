/**
 * 语音后端注入 token：Nest 用 Symbol 作为依赖注入的 key（对应 speech.module 的工厂 Provider）。
 */
export const ASR_BACKEND = Symbol("ASR_BACKEND");
export const TTS_BACKEND = Symbol("TTS_BACKEND");
