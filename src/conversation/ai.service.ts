import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

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

  async chat(
    messages: { role: string; content: string }[],
    userSettings?: { apiKey?: string; apiBase?: string; model?: string },
  ): Promise<string> {
    const key = userSettings?.apiKey || this.apiKey;
    const base = userSettings?.apiBase || this.apiBase;
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
      }),
    });

    if (!res.ok) {
      console.error("[AI] API error:", res.status, await res.text().catch(() => ""));
      return this.fallback(messages[messages.length - 1]?.content ?? "");
    }

    const json: any = await res.json();
    return json.choices[0]?.message?.content ?? "Sorry, I didn't get that.";
  }

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
