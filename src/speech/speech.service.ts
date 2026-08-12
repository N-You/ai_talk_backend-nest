import { Inject, Injectable } from "@nestjs/common";
import { ASR_BACKEND, TTS_BACKEND } from "./speech.constants";
import { ASRBackend, TranscribeInput, TranscribeResult } from "./interfaces/asr-backend.interface";
import { TTSBackend, TTSInput, TTSResult } from "./interfaces/tts-backend.interface";

/**
 * 语音服务门面 (facade)。
 *
 * 对应 voicebox backend/services/transcribe.py + tts.py —— 极薄门面,
 * 不承载业务逻辑, 只把上层请求转交给后端抽象层。
 * 业务方 (Agent 状态机 / Controller) 只依赖本门面, 不感知具体 provider。
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
