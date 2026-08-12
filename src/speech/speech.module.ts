import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SpeechController } from "./speech.controller";
import { SpeechService } from "./speech.service";
import { ASR_BACKEND, TTS_BACKEND } from "./speech.constants";
import { ASRBackend } from "./interfaces/asr-backend.interface";
import { TTSBackend } from "./interfaces/tts-backend.interface";
import { OpenAiAsrBackend } from "./backends/openai-asr.backend";
import { AliyunAsrBackend } from "./backends/aliyun-asr.backend";
import { AliyunTtsBackend } from "./backends/aliyun-tts.backend";

/**
 * 语音模块。
 *
 * 复刻 voicebox backend/backends/__init__.py 的工厂思想:
 * - get_stt_backend() / get_tts_backend_for_engine() -> 这里 useFactory 按配置选 provider
 * - 单例语义: Nest DI 默认单例
 * - 新增实现 = 新增一个 case + 一个实现类, 上层零改动
 */
@Module({
  controllers: [SpeechController],
  providers: [
    SpeechService,
    {
      provide: ASR_BACKEND,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ASRBackend => {
        const provider = (config.get<string>("speech.asrProvider") ?? "dashscope").toLowerCase();
        switch (provider) {
          case "dashscope":
            return new AliyunAsrBackend(config);
          case "openai":
            return new OpenAiAsrBackend(config);
          default:
            throw new Error(
              `Unknown ASR provider: '${provider}'. Supported: dashscope, openai. ` +
                `Set SPEECH_ASR_PROVIDER in .env`,
            );
        }
      },
    },
    {
      provide: TTS_BACKEND,
      inject: [ConfigService],
      useFactory: (config: ConfigService): TTSBackend => {
        const provider = (config.get<string>("speech.ttsProvider") ?? "dashscope").toLowerCase();
        switch (provider) {
          case "dashscope":
            return new AliyunTtsBackend(config);
          default:
            throw new Error(
              `Unknown TTS provider: '${provider}'. Supported: dashscope. ` +
                `Set SPEECH_TTS_PROVIDER in .env`,
            );
        }
      },
    },
  ],
  exports: [SpeechService],
})
export class SpeechModule {}
