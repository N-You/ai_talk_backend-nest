import { Inject, Injectable } from "@nestjs/common";
import { ASR_BACKEND, TTS_BACKEND } from "./speech.constants";
import { ASRBackend, TranscribeInput, TranscribeResult } from "./interfaces/asr-backend.interface";
import { TTSBackend, TTSInput, TTSResult } from "./interfaces/tts-backend.interface";

/**
 * 语音服务门面（facade）：极薄转发层，不承载业务逻辑。
 * 上层只依赖本门面，不感知具体 provider；实现类通过 DI token 注入（见 speech.module）。
 */
@Injectable()
export class SpeechService {
  constructor(
    @Inject(ASR_BACKEND) private readonly asr: ASRBackend,
    @Inject(TTS_BACKEND) private readonly tts: TTSBackend,
  ) {}

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    return this.asr.transcribe(input);
  }

  async synthesize(input: TTSInput): Promise<TTSResult> {
    return this.tts.synthesize(input);
  }
}
