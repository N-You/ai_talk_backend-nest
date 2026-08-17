import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SpeechController } from "./speech.controller";
import { SpeechService } from "./speech.service";
import { ChunkStoreService } from "./chunk-store.service";
import { ASR_BACKEND, TTS_BACKEND } from "./speech.constants";
import { ASRBackend } from "./interfaces/asr-backend.interface";
import { TTSBackend } from "./interfaces/tts-backend.interface";
import { AliyunAsrBackend } from "./backends/aliyun-asr.backend";
import { AliyunTtsBackend } from "./backends/aliyun-tts.backend";

/**
 * 语音模块：ASR/TTS 按配置（speech.asrProvider / speech.ttsProvider）选择 provider 实现。
 * 当前仅阿里云百炼（DashScope）；新增实现 = 新增一个 case + 一个实现类，上层零改动。
 */
@Module({
  controllers: [SpeechController],
  providers: [
    SpeechService,
    ChunkStoreService, // 分片上传暂存（内存 + TTL）
    {
      provide: ASR_BACKEND,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ASRBackend => {
        const provider = (config.get<string>("speech.asrProvider") ?? "dashscope").toLowerCase();
        switch (provider) {
          case "dashscope":
            return new AliyunAsrBackend(config);
          default:
            throw new Error(
              `Unknown ASR provider: '${provider}'. Supported: dashscope. ` +
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
