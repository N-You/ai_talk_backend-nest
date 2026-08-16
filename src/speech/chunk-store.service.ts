import { Injectable } from "@nestjs/common";

/**
 * 分片上传的临时分片暂存（内存实现）。
 *
 * 设计约束（分片上传策略优化）：
 * - 音频分片天然"只在一个请求的生命周期内有用"，不需要落盘/Redis，
 *   内存 Map + TTL 足够，实现最简单且零外部依赖。
 * - 安全上限：
 *   * 单 uploadId 总分片数 ≤ MAX_CHUNKS（防恶意塞大量分片）
 *   * 单 uploadId 累计字节 ≤ MAX_TOTAL_BYTES（防内存被打爆；同时兜住
 *     DashScope base64 10MB 上限 —— 见 aliyun-asr.backend.ts 注释）
 *   * TTL 10 分钟：客户端中途放弃时自动回收，防内存泄漏
 * - 懒清理：每次读写时顺带清理过期会话，不引入定时器
 */

interface Session {
  chunks: Map<number, Buffer>; // index -> 分片内容
  total: number; // 声明的总分片数
  mimeType: string; // 音频 MIME（末片为准）
  createdAt: number; // 会话创建时间（毫秒时间戳）
}

/** 会话有效期（毫秒） */
const TTL_MS = 10 * 60_000;
/** 单会话最多分片数 */
const MAX_CHUNKS = 32;
/** 单会话累计字节上限（≈DashScope base64 10MB 上限的原始音频侧） */
const MAX_TOTAL_BYTES = 7 * 1024 * 1024;

@Injectable()
export class ChunkStoreService {
  private sessions = new Map<string, Session>();

  /** 追加一个分片；返回是否满足"可以拼接"（全部分片已到齐） */
  put(uploadId: string, index: number, total: number, data: Buffer, mimeType: string): boolean {
    this.cleanup(); // 顺带回收过期会话
    if (index < 0 || index >= total || total > MAX_CHUNKS) {
      throw new Error(`非法分片参数: index=${index} total=${total}`);
    }
    if (data.length > 2 * 1024 * 1024) {
      throw new Error("单片大小超过 2MB 上限");
    }

    let session = this.sessions.get(uploadId);
    if (!session) {
      session = { chunks: new Map(), total, mimeType, createdAt: Date.now() };
      this.sessions.set(uploadId, session);
    }
    // 单会话累计大小守卫（跨分片累加）
    let size = data.length;
    session.chunks.forEach((c) => (size += c.length));
    if (size > MAX_TOTAL_BYTES) {
      throw new Error(`音频累计超过 ${Math.floor(MAX_TOTAL_BYTES / 1024 / 1024)}MB 上限`);
    }

    session.chunks.set(index, data);
    session.mimeType = mimeType || session.mimeType;
    return session.chunks.size === total;
  }

  /** 取全部已收分片并按 index 升序拼接；缺片返回 null */
  assemble(uploadId: string): Buffer | null {
    const session = this.sessions.get(uploadId);
    if (!session || session.chunks.size !== session.total) return null;
    const parts: Buffer[] = [];
    for (let i = 0; i < session.total; i++) {
      const c = session.chunks.get(i);
      if (!c) return null; // 防御：理论上不会发生
      parts.push(c);
    }
    return Buffer.concat(parts);
  }

  /** 取会话记录的 MIME（末片为准） */
  mimeOf(uploadId: string): string {
    return this.sessions.get(uploadId)?.mimeType ?? "audio/webm";
  }

  /** 删除会话（拼接完成后必须调用，否则占内存到 TTL） */
  remove(uploadId: string): void {
    this.sessions.delete(uploadId);
  }

  /** 懒清理：移除超期会话 */
  private cleanup(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.createdAt > TTL_MS) this.sessions.delete(id);
    }
  }
}
