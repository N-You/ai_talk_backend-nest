import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * LLM 调用层：封装 OpenAI 兼容 chat/completions 协议。
 * - 用户自定义配置（userSettings）优先，回落 .env 默认（构造时注入）
 * - 无 Key 时走 fallback 模板回复（"聊天可编"降级策略）
 * - 智谱端点自动关闭思考模式（thinking.disabled），省 token 提速
 */
@Injectable()
export class AiService {
  private apiKey: string;
  private apiBase: string;
  private model: string;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>("ai.apiKey") ?? "";
    this.apiBase = this.config.get<string>("ai.apiBase") ?? "";
    this.model = this.config.get<string>("ai.model") ?? "gpt-4o-mini";
  }

  /**
   * 非流式调用（保留：TTS / 其他一次性场景）。
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

    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 256,
        temperature: 0.7,
        // 智谱推理模型默认先输出思维链(reasoning_content)，会挤占 max_tokens 且拖慢首字
        // 仅对智谱端点关闭思考模式；OpenAI 官方 API 不识别该参数，不能无条件携带
        ...(base.includes("bigmodel.cn") ? { thinking: { type: "disabled" } } : {}),
      }),
    });

    if (!res.ok) {
      console.error("[AI] API error:", res.status, await res.text().catch(() => ""));
      return this.fallback(messages[messages.length - 1]?.content ?? "");
    }

    const json: any = await res.json();
    return json.choices[0]?.message?.content ?? "Sorry, I didn't get that.";
  }

  /**
   * 流式调用：async generator，逐块 yield 增量文本。
   *
   * 关键设计：
   * - OpenAI 兼容接口 `stream: true`，用 fetch ReadableStream 逐块解析 SSE
   * - 无 Key 时直接 yield 一条 fallback 回复（体验一致，不抛错）
   * - 网络/接口错误时抛异常，由调用方决定降级策略
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

    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 256,
        temperature: 0.7,
        stream: true,
        // 仅智谱端点关闭思考模式（理由同 chat 方法）
        ...(base.includes("bigmodel.cn") ? { thinking: { type: "disabled" } } : {}),
      }),
    });

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

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

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
    } finally {
      reader.releaseLock();
    }
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
