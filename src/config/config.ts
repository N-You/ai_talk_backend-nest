/**
 * 集中配置工厂：把 process.env 归整为带默认值的命名空间对象。
 * 业务侧通过 ConfigService.get("speech.dashscopeApiKey") 点号路径取用，
 * 环境变量不散落各处，默认值兜底保证本地零配置可启动。
 */
export default () => ({
  port: parseInt(process.env.PORT ?? "8002", 10),

  database: {
    host: process.env.DB_HOST ?? "localhost",
    port: parseInt(process.env.DB_PORT ?? "5432", 10),
    username: process.env.DB_USERNAME ?? "postgres",
    password: process.env.DB_PASSWORD ?? "postgres",
    database: process.env.DB_NAME ?? "english_tutor",
  },

  redis: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: parseInt(process.env.REDIS_PORT ?? "6379", 10),
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
    expiresIn: process.env.JWT_EXPIRES ?? "7d",
  },

  ai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    apiBase: process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  },

  speech: {
    // 语音后端 provider 选择, 等价 voicebox 的平台二选一逻辑
    // dashscope = 阿里云百炼 (ASR: qwen3-asr-flash OpenAI兼容, TTS: qwen-audio-3.0-tts-flash)
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY ?? "",
    asrProvider: process.env.SPEECH_ASR_PROVIDER ?? "dashscope",
    asrModel: process.env.SPEECH_ASR_MODEL ?? "qwen3-asr-flash",
    ttsProvider: process.env.SPEECH_TTS_PROVIDER ?? "dashscope",
    ttsModel: process.env.SPEECH_TTS_MODEL ?? "qwen-audio-3.0-tts-flash",
    ttsVoice: process.env.SPEECH_TTS_VOICE ?? "longanhuan_v3.6",
  },
});
