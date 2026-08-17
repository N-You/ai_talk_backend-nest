import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Semaphore } from "../common/utils/semaphore";

/** 全局 LLM 并发已满（信号量拿不到许可）时抛出，由网关转成"系统繁忙"提示 */
export class LlmBusyError extends Error {
  constructor() {
    super("LLM concurrency limit reached");
    this.name = "LlmBusyError";
  }
}

/**
 * LLM 调用层：封装 OpenAI 兼容 chat/completions 协议。
 * - 用户自定义配置（userSettings）优先，回落 .env 默认（构造时注入）
 * - 无 Key 时走 fallback 模板回复（"聊天可编"降级策略）
 * - 智谱端点自动关闭思考模式（thinking.disabled），省 token 提速
 * - 并发防护：全局信号量限制同时进行的 LLM 请求数（AI_MAX_CONCURRENT，默认 20），
 *   超限抛 LlmBusyError（由网关提示"系统繁忙"），防止多用户瞬时请求打爆上游限流
 * - 健壮性：请求阶段首包 60s 超时 + 429/5xx 指数退避重试（最多 2 次，对齐 ASR 后端）；
 *   流式解析阶段 60s 无数据空闲超时；外部 AbortSignal（客户端断连）全程贯穿
 */
@Injectable()
export class AiService {
  private apiKey: string;
  private apiBase: string;
  private model: string;
  private readonly semaphore: Semaphore;

  /** 首包超时（毫秒）：发出请求后 60s 内未收到响应头视为失败 */
  private readonly FIRST_CHUNK_TIMEOUT_MS = 60_000;
  /** 流式解析空闲超时（毫秒）：60s 内没有读到任何新数据视为卡死 */
  private readonly STREAM_IDLE_TIMEOUT_MS = 60_000;
  /** 可重试状态码：服务端错误 / 限流 */
  private readonly RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
  /** 最多重试次数（指数退避 0.5s×2^n + 抖动，与 ASR 后端一致） */
  private readonly MAX_RETRY = 2;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>("ai.apiKey") ?? "";
    this.apiBase = this.config.get<string>("ai.apiBase") ?? "";
    this.model = this.config.get<string>("ai.model") ?? "gpt-4o-mini";
    const maxConcurrent = this.config.get<number>("ai.maxConcurrent") ?? 20;
    this.semaphore = new Semaphore(Math.max(1, maxConcurrent));
  }

  /**
   * 非流式调用（保留：TTS / 其他一次性场景，如 explainWord）。
   * 并发满时抛 LlmBusyError，由调用方降级。
   */
  async chat(
    messages: { role: string; content: string }[],
    userSettings?: { apiKey?: string; apiBase?: string; model?: string },
  ): Promise<string> {
    const key = userSettings?.apiKey || this.apiKey;
    const base = (userSettings?.apiBase || this.apiBase).replace(/\/$/, "");
    const model = userSettings?.model || this.model;

    if (!key) {
      return this.fallback(messages[messages.length - 1]?.content ?? "");
    }
    // 并发防护：拿不到许可直接抛错（不排队），由上层转"系统繁忙"
    if (!this.semaphore.tryAcquire()) throw new LlmBusyError();

    try {
      const res = await this.requestChat(
        `${base}/chat/completions`,
        this.buildBody(base, model, messages, { max_tokens: 256 }),
        key,
        new AbortController(),
      );

      if (!res.ok) {
        console.error("[AI] API error:", res.status, await res.text().catch(() => ""));
        return this.fallback(messages[messages.length - 1]?.content ?? "");
      }

      const json: any = await res.json();
      return json.choices[0]?.message?.content ?? "Sorry, I didn't get that.";
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * 流式调用：async generator，逐块 yield 增量文本。
   *
   * 关键设计：
   * - OpenAI 兼容接口 `stream: true`，用 fetch ReadableStream 逐块解析 SSE
   * - 无 Key 时直接 yield 一条 fallback 回复（体验一致，不抛错）
   * - 并发满时抛 LlmBusyError；请求阶段有首包超时 + 可重试错误指数退避；
   *   解析阶段 60s 无数据判空转超时中断；均抛异常由调用方降级
   * - 支持 AbortSignal：客户端断开时中断生成，节省 token
   */
  async *chatStream(
    messages: { role: string; content: string }[],
    userSettings?: { apiKey?: string; apiBase?: string; model?: string },
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const key = userSettings?.apiKey || this.apiKey;
    const base = (userSettings?.apiBase || this.apiBase).replace(/\/$/, "");
    const model = userSettings?.model || this.model;

    if (!key) {
      yield this.fallback(messages[messages.length - 1]?.content ?? "");
      return;
    }
    if (!this.semaphore.tryAcquire()) throw new LlmBusyError();

    // 外部取消（客户端断连）贯穿请求 + 解析全程
    const ac = new AbortController();
    const onOuterAbort = () => ac.abort();
    signal?.addEventListener("abort", onOuterAbort, { once: true });

    try {
      const res = await this.requestChat(
        `${base}/chat/completions`,
        this.buildBody(base, model, messages, { max_tokens: 256, stream: true }),
        key,
        ac,
      );

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`LLM stream error ${res.status}: ${detail.slice(0, 200)}`);
      }
      if (!res.body) {
        throw new Error("LLM stream: no response body");
      }

      // 逐块解析 SSE：data: {...}\n\n，结束标记 data: [DONE]
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let idleTimer: NodeJS.Timeout | null = null;

      // 空闲超时：60s 无任何新数据 → 中断（防上游挂起悬挂连接）
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => ac.abort(), this.STREAM_IDLE_TIMEOUT_MS);
      };
      resetIdleTimer();

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          resetIdleTimer(); // 收到数据即视为存活，重置空闲计时

          buffer += decoder.decode(value, { stream: true });
          // 按行切分；保留最后一段不完整的行
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") return;
            try {
              const json: any = JSON.parse(data);
              const delta: string | undefined = json?.choices?.[0]?.delta?.content;
              if (delta) yield delta;
            } catch {
              // 忽略无法解析的行
            }
          }
        }
      } catch (err) {
        // 空闲超时（ac 被本方法中断且外部未取消）→ 明确报错，不裸抛 AbortError
        if (ac.signal.aborted && !signal?.aborted) {
          throw new Error("LLM stream idle timeout (no data in 60s)");
        }
        throw err;
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        reader.releaseLock();
      }
    } finally {
      signal?.removeEventListener("abort", onOuterAbort);
      this.semaphore.release();
    }
  }

  /** 组装请求体（智谱端点关闭思考模式，理由见类注释） */
  private buildBody(
    base: string,
    model: string,
    messages: { role: string; content: string }[],
    extra: { max_tokens: number; stream?: boolean },
  ): Record<string, unknown> {
    return {
      model,
      messages,
      max_tokens: extra.max_tokens,
      temperature: 0.7,
      ...(extra.stream ? { stream: true } : {}),
      // 智谱推理模型默认先输出思维链(reasoning_content)，会挤占 max_tokens 且拖慢首字
      // 仅对智谱端点关闭思考模式；OpenAI 官方 API 不识别该参数，不能无条件携带
      ...(base.includes("bigmodel.cn") ? { thinking: { type: "disabled" } } : {}),
    };
  }

  /**
   * 发起请求并拿到 ok 的响应（含首包超时 + 可重试错误指数退避）：
   * - 首包 60s 超时 / 外部取消 → 不重试，直接抛（超时转明确错误）
   * - 429 / 5xx / 网络错误 → 指数退避重试（最多 MAX_RETRY 次）
   * - 其余 4xx → 不重试，立即抛
   */
  private async requestChat(
    url: string,
    body: Record<string, unknown>,
    apiKey: string,
    outerAc: AbortController,
  ): Promise<Response> {
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt <= this.MAX_RETRY; attempt++) {
      const attemptAc = new AbortController();
      const relay = () => attemptAc.abort();
      outerAc.signal.addEventListener("abort", relay, { once: true });
      const timer = setTimeout(() => attemptAc.abort(), this.FIRST_CHUNK_TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: attemptAc.signal,
        });
        clearTimeout(timer);
        outerAc.signal.removeEventListener("abort", relay);
        if (res.ok) return res;

        const detail = await res.text().catch(() => "");
        const err = new Error(`LLM error ${res.status}: ${detail.slice(0, 200)}`);
        if (!this.RETRYABLE_STATUS.has(res.status)) throw err; // 4xx（非 429）不重试
        lastErr = err;
      } catch (err) {
        clearTimeout(timer);
        outerAc.signal.removeEventListener("abort", relay);
        const e = err as Error;
        // 中断原因：外部取消（客户端断连）或首包超时 —— 均不重试
        if (e.name === "AbortError") {
          if (outerAc.signal.aborted) throw e;
          throw new Error("LLM request timeout (no response in 60s)");
        }
        if (attempt >= this.MAX_RETRY) throw e;
        lastErr = e;
      }

      // 指数退避 + 抖动，避免并发重试踩踏（与 ASR 后端一致）
      const delay = 500 * 2 ** attempt * (0.7 + Math.random() * 0.6);
      console.warn(`[AI] 请求失败，${Math.round(delay)}ms 后重试 (${attempt + 1}/${this.MAX_RETRY}): ${lastErr?.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
    throw lastErr ?? new Error("LLM request failed");
  }

  /**
   * 内置兜底回复：无 Key 或 API 失败时随机返回一条模板英文。
   * 与语音模块"宁错不编"不同——对话是练习场景，编造温和回复无害，
   * 保证体验不中断。
   */
  private fallback(userMsg: string): string {
    const replies = [
      "That's interesting! Can you tell me more?",
      "I see. Let me help you with that.",
      "Good! Keep practicing your English.",
      "Could you rephrase that in English?",
      "Great effort! Let's continue the conversation.",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }
}
