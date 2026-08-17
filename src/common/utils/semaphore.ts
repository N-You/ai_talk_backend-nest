/**
 * 非阻塞信号量：限制同一时刻进行中的关键操作数（如并发 LLM 请求）。
 * - tryAcquire 立即返回是否拿到许可，不排队 —— 拿不到由调用方决定降级策略
 *   （提示"系统繁忙"），避免请求堆积把上游打爆
 * - 实例级单例（每个 Node 进程一个），多进程/多实例部署时各自限流
 */
export class Semaphore {
  private active = 0;

  constructor(private readonly max: number) {}

  /** 尝试获取一个许可；当前占用已满立即返回 false（不等待） */
  tryAcquire(): boolean {
    if (this.active >= this.max) return false;
    this.active += 1;
    return true;
  }

  /** 释放一个许可（必须与 tryAcquire 成功配对，在 finally 中调用） */
  release(): void {
    if (this.active > 0) this.active -= 1;
  }
}
