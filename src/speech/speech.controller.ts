import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  PayloadTooLargeException,
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
import { ChunkStoreService } from "./chunk-store.service";

/**
 * 语音转写端点。
 * - 直传（≤7MB）：音频直接进内存（multer memoryStorage），云端 API 原生支持
 *   webm/ogg 等格式，无需落盘与转码
 * - 分片（>7MB）：POST /api/speech/transcribe-chunked，前端按 1MB/片顺序上传，
 *   末片到达后服务端拼接转写；分片内存暂存（ChunkStoreService，10 分钟 TTL），
 *   单片失败只需重传单片
 * - 直传守卫：原始音频 ≤7MB（DashScope base64 10MB 硬上限，见 aliyun-asr.backend.ts），
 *   超长音频 413 明确报错，不再裸 4xx/500
 */

/** 直传原始音频上限 (字节): base64 膨胀后约 1.37 倍, 需 < DashScope 10MB 硬限 */
const MAX_DIRECT_BYTES = 7 * 1024 * 1024;

@Controller("api/speech")
@UseGuards(JwtAuthGuard)
export class SpeechController {
  constructor(
    private readonly speech: SpeechService,
    private readonly chunkStore: ChunkStoreService,
  ) {}

  /** 把 provider 抛出的"配置缺失"错误转成 503 + 可读信息，避免裸 500 堆栈 */
  private friendly(e: unknown): never {
    if (e instanceof Error && e.message.includes("not configured")) {
      throw new ServiceUnavailableException(
        "语音服务未配置：请在后端 .env 中填写 DASHSCOPE_API_KEY（阿里云百炼）后重启",
      );
    }
    // 音频过大：转成 413 而非 500，前端可据此提示用户缩短录音
    if (e instanceof Error && e.message.includes("音频过大")) {
      throw new PayloadTooLargeException(e.message);
    }
    throw e;
  }

  /** 解析 multipart 里的 string 字段（multer 以字符串形式传入） */
  private str(v: string | undefined): string | undefined {
    const s = v?.trim();
    return s ? s : undefined;
  }

  private int(v: string | undefined): number | undefined {
    const n = v === undefined ? NaN : Number(v);
    return Number.isInteger(n) ? n : undefined;
  }

  /** 按文件内容/扩展名兜底推断 MIME（octet-stream 时） */
  private inferMime(mimetype: string, originalname?: string): string {
    if (mimetype.startsWith("audio/")) return mimetype;
    const ext = (originalname ?? "").split(".").pop()?.toLowerCase() ?? "";
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
    return extToMime[ext] ?? mimetype;
  }

  /**
   * 语音转写（ASR）：multipart 上传 ≤7MB 音频 → 文本。
   * - 直传模式：整段一次上传（前端 ≤1MB 走这里，见 utils/chunkedUpload.ts）
   * - mime 兜底：octet-stream 按扩展名推断，避免误杀合法录音
   * - 超过 7MB 直接 413：DashScope base64 上限 10MB，超长请用分片接口或缩短录音
   */
  @Post("transcribe")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 8 * 1024 * 1024 } }))
  async transcribe(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("language") language?: string,
    @Body("model") model?: string,
  ) {
    if (!file) {
      throw new BadRequestException("Missing audio file (form field name: file)");
    }
    if (file.buffer.length > MAX_DIRECT_BYTES) {
      throw new PayloadTooLargeException(
        `音频过大 (${(file.buffer.length / 1024 / 1024).toFixed(1)}MB > 7MB 上限)：` +
          `DashScope base64 直传限制 10MB，请缩短录音或改用分片上传`,
      );
    }

    const mimeType = this.inferMime(file.mimetype, file.originalname);
    if (!mimeType.startsWith("audio/")) {
      throw new BadRequestException(`Unsupported content type: ${file.mimetype}`);
    }

    try {
      return await this.speech.transcribe({
        audio: file.buffer,
        mimeType,
        language: this.str(language),
        model: this.str(model),
      });
    } catch (e) {
      this.friendly(e);
    }
  }

  /**
   * 语音转写 - 分片上传模式（分片上传策略优化）。
   *
   * 协议（multipart 字段）：
   * - file: 单片音频（≤2MB）
   * - uploadId: 本次上传会话 ID（前端生成）
   * - index: 片序号（0 起）
   * - total: 总分片数
   * - mimeType: 音频 MIME（任一片携带即可，末片为准）
   * - language / model: 可选，透传给 ASR
   *
   * 语义：分片顺序到达（前端顺序传 + 单片重试），除末片外不返回识别结果；
   * 末片到达且所有分片齐全时 → 拼接 → 转写 → 返回 { text }，并释放内存。
   * 分片缺失/会话过期由 ChunkStoreService TTL 兜底。
   */
  @Post("transcribe-chunked")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 2 * 1024 * 1024 } }))
  async transcribeChunked(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("uploadId") uploadId?: string,
    @Body("index") index?: string,
    @Body("total") total?: string,
    @Body("mimeType") mimeType?: string,
    @Body("language") language?: string,
    @Body("model") model?: string,
  ) {
    if (!file) {
      throw new BadRequestException("Missing audio chunk (form field name: file)");
    }
    const id = this.str(uploadId);
    const idx = this.int(index);
    const ttl = this.int(total);
    if (!id || idx === undefined || ttl === undefined) {
      throw new BadRequestException("Missing or invalid uploadId/index/total");
    }

    try {
      const mime = this.inferMime(file.mimetype || "", this.str(mimeType) || file.originalname);
      const complete = this.chunkStore.put(id, idx, ttl, file.buffer, mime);

      // 非末片：直接确认收到（前端继续传下一片）
      if (!complete) return { uploadId: id, received: idx };

      // 末片且分片齐全：拼接 → 转写 → 释放内存
      const audio = this.chunkStore.assemble(id);
      const mimeFinal = this.chunkStore.mimeOf(id) || mime;
      this.chunkStore.remove(id); // 无论成败都释放，防内存滞留
      if (!audio) {
        throw new BadRequestException("分片不完整，请重试");
      }
      return await this.speech.transcribe({
        audio,
        mimeType: mimeFinal,
        language: this.str(language),
        model: this.str(model),
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.friendly(e);
    }
  }

  /**
   * 语音合成 (TTS): 文本 -> 音频流。
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
