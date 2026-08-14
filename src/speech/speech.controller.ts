import {
  BadRequestException,
  Body,
  Controller,
  Post,
  ServiceUnavailableException,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SpeechService } from "./speech.service";

/**
 * 语音转写端点。
 *
 * 对应 voicebox backend/routes/transcription.py, 但省掉了它的两个工程负担:
 * 1. 临时文件: voicebox 用 1MB 分块写 tempfile (Python 生态习惯), Node 里
 *    multer 默认 memoryStorage, Buffer 直接进内存, 无需落盘
 * 2. 格式转码: voicebox 必须 librosa 解码 -> 重编码 WAV 喂 Whisper (本地解码器
 *    限制), 云端 API 原生支持 webm/ogg, 原始 Buffer 直传
 *
 * voicebox 的 HTTP 202 + 后台下载模式同样不需要: 那是本地模型懒加载的产物,
 * 云端模型不存在"首次下载"问题。若将来本地 sidecar 接入, 该模式由 provider
 * 层自行引入, 不污染本路由。
 */
@Controller("api/speech")
@UseGuards(JwtAuthGuard)
export class SpeechController {
  constructor(private readonly speech: SpeechService) {}

  /** 把 provider 抛出的"配置缺失"错误转成 503 + 可读信息，避免裸 500 堆栈 */
  private friendly(e: unknown): never {
    if (e instanceof Error && e.message.includes("not configured")) {
      throw new ServiceUnavailableException(
        "语音服务未配置：请在后端 .env 中填写 DASHSCOPE_API_KEY（阿里云百炼）后重启",
      );
    }
    throw e;
  }

  /**
   * 语音转写（ASR）：multipart 上传 ≤25MB 音频 → 文本。
   * - mime 兜底：octet-stream 按扩展名推断，避免误杀合法录音
   * - 配置缺失错误经 friendly() 转 503 中文提示
   */
  @Post("transcribe")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024 } }))
  async transcribe(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("language") language?: string,
    @Body("model") model?: string,
  ) {
    if (!file) {
      throw new BadRequestException("Missing audio file (form field name: file)");
    }

    // 部分客户端 (curl/原生录音) 上传时 content-type 是 application/octet-stream,
    // 此时按文件名扩展名兜底推断 mimeType, 避免误杀合法录音
    let mimeType = file.mimetype;
    if (!mimeType.startsWith("audio/")) {
      const ext = (file.originalname ?? "").split(".").pop()?.toLowerCase() ?? "";
      const extToMime: Record<string, string> = {
        wav: "audio/wav",
        mp3: "audio/mpeg",
        webm: "audio/webm",
        m4a: "audio/mp4",
        ogg: "audio/ogg",
        opus: "audio/ogg",
        flac: "audio/flac",
        aac: "audio/aac",
      };
      mimeType = extToMime[ext] ?? mimeType;
    }
    if (!mimeType.startsWith("audio/")) {
      throw new BadRequestException(`Unsupported content type: ${file.mimetype}`);
    }

    try {
      return await this.speech.transcribe({
        audio: file.buffer,
        mimeType,
        language: language || undefined,
        model: model || undefined,
      });
    } catch (e) {
      this.friendly(e);
    }
  }

  /**
   * 语音合成 (TTS): 文本 -> 音频流。
   * 对应 voicebox 的 /generate 简化版 (无声音克隆/多版本管理)。
   * body: { text, voice?, speed? }, 返回 audio/wav 二进制。
   */
  @Post("tts")
  async synthesize(@Body() body: { text?: string; voice?: string; speed?: number }) {
    const text = body?.text?.trim();
    if (!text) {
      throw new BadRequestException("Missing text");
    }
    // 阿里云 TTS 单次合成有字数上限，超长会 4xx 报错（且浪费额度）
    if (text.length > 1000) {
      throw new BadRequestException("Text too long (max 1000 chars)");
    }
    try {
      const result = await this.speech.synthesize({
        text,
        voice: body.voice || undefined,
        speed: body.speed,
      });
      return new StreamableFile(result.audio, {
        type: result.mimeType,
        disposition: `inline; filename="tts.wav"`,
      });
    } catch (e) {
      this.friendly(e);
    }
  }
}
