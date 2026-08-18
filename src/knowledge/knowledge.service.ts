import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * 知识库 Chunk 结构（与 english_knowledge_base.jsonl 一行一一对应）。
 * scene: 归属标记——全局知识库条目无此字段，项目 Skill 的专属知识条目标记为 skill key（如 "shopping"）。
 */
export interface KnowledgeChunk {
  id: string;
  category: string;
  topic: string;
  level: string;
  rule: string;
  examples: { text: string; note?: string }[];
  common_errors: { error: string; fix: string; explanation?: string }[];
  tags: string[];
  scene?: string;
}

/**
 * 学习者长期画像（存于 users.error_profile，随会话逐步累积）：
 * - error_counts: 每类错误被检测到的累计次数（tense/article/chinglish-*...）
 * - total_turns: 已统计的对话轮次
 * - last_seen_topics: 最近出现的话题（供场景延续）
 */
export interface LearnerProfile {
  error_counts?: Record<string, number>;
  total_turns?: number;
  last_seen_topics?: string[];
}

/**
 * 轻量 RAG 检索服务（无需外部向量库）：
 * - 启动时加载 assets/english_knowledge_base.jsonl（394 chunks，7 大模块）到内存
 * - 项目 Skill 的专属知识由 SkillService 加载（skills/<key>/knowledge.jsonl），
 *   通过 retrieve(query, hints, k, level, sceneChunks) 注入本服务做「场景加权检索」
 * - detectErrorHints: 正则启发式检测用户句子疑似错误类型（tense/article/chinglish...）
 * - retrieve: 基于「错误提示 + 关键词 + 标签 + 技能知识」打分（同一 topic 只保留最相关 1 条）
 * - buildKnowledgeBlock: 把命中的 chunks 拼成 <knowledge>...</knowledge> 注入 system prompt
 *
 * 文件缺失/解析失败时降级为空库（检索返回 []），不影响对话主流程。
 * 路径解析：dev: npm start（cwd=backend-nest）；prod: Docker WORKDIR=/app（COPY . . 带入 assets）
 */
@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name);
  /** 知识库默认加载路径候选（按顺序尝试） */
  private static readonly KB_PATHS: string[] = [
    join(process.cwd(), "assets", "english_knowledge_base.jsonl"),
    join(__dirname, "..", "..", "..", "assets", "english_knowledge_base.jsonl"),
  ];

  private chunks: KnowledgeChunk[] = [];
  /** tag → chunks 倒排索引（检索加速） */
  private tagIndex = new Map<string, KnowledgeChunk[]>();
  private loaded = false;

  // ── 生命周期 ──────────────────────────────────────

  onModuleInit() {
    this.load();
  }

  /** 解析 JSONL 文本为 chunks（逐行 parse，忽略空行与坏行）——供本服务与 SkillService 复用 */
  static parseJsonl(raw: string): KnowledgeChunk[] {
    const out: KnowledgeChunk[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const c = JSON.parse(t);
        out.push({
          id: c.id,
          category: c.category,
          topic: c.topic,
          level: c.level,
          rule: c.rule,
          examples: c.examples ?? [],
          common_errors: c.common_errors ?? [],
          tags: c.tags ?? [],
          scene: c.scene,
        });
      } catch {
        // 跳过坏行
      }
    }
    return out;
  }

  /** 加载全局 JSONL：逐行 parse + 构建 tag 倒排索引；任一步失败都降级为空库 */
  private load() {
    const path = KnowledgeService.KB_PATHS.find((p) => existsSync(p));
    if (!path) {
      this.logger.warn(
        `知识库文件未找到（尝试: ${KnowledgeService.KB_PATHS.join(", ")}），知识检索功能不可用（对话不受影响）`,
      );
      return;
    }
    try {
      this.chunks = [];
      this.tagIndex.clear();
      for (const chunk of KnowledgeService.parseJsonl(readFileSync(path, "utf-8"))) {
        this.chunks.push(chunk);
        for (const tag of chunk.tags) {
          const key = tag.toLowerCase();
          const list = this.tagIndex.get(key) ?? [];
          list.push(chunk);
          this.tagIndex.set(key, list);
        }
      }
      this.loaded = true;
      this.logger.log(`知识库加载成功: ${this.chunks.length} chunks (${path})`);
    } catch (e) {
      this.logger.warn(`知识库解析失败，已降级为空库: ${(e as Error).message}`);
      this.chunks = [];
      this.tagIndex.clear();
    }
  }

  // ── 公开 API ──────────────────────────────────────

  get isLoaded(): boolean {
    return this.loaded;
  }

  get size(): number {
    return this.chunks.length;
  }

  /** 模块分布统计（调试 / 学习页展示用） */
  stats() {
    const byCategory: Record<string, number> = {};
    const byLevel: Record<string, number> = {};
    for (const c of this.chunks) {
      byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
      byLevel[c.level] = (byLevel[c.level] ?? 0) + 1;
    }
    return {
      total: this.chunks.length,
      byCategory,
      byLevel,
      loaded: this.loaded,
    };
  }

  /**
   * 启发式错误类型检测：正则扫描用户句子，返回疑似错误提示（供检索加权）。
   * 仅作检索的候选信号，最终判断由 LLM 结合 knowledge 块完成。
   */
  detectErrorHints(text: string): string[] {
    const t = text ?? "";
    const hints = new Set<string>();
    const check = (pattern: RegExp, hint: string) => {
      if (pattern.test(t)) hints.add(hint);
    };

    // 时态：过去时间词 + 高频动词原形共现（go/see/eat 等）
    check(/\b(yesterday|ago|last\s+\w+)\b[\s\S]{0,60}\b(go|goes|see|sees|eat|eats|buy|buys|take|takes|have|has|do|does|is|are|like|likes|watch|watches)\b/i, "tense");
    // 一般现在时三单：he/she/it + 动词原形
    check(/\b(he|she|it)\b[\s\S]{0,40}\b(go|like|want|have|do|play|work|eat|watch)\b/i, "subject-verb-agreement");
    // 冠词：可数单数名词裸用（"I bought book / I saw movie"，排除已带限定词与介词的情形）
    check(
      /\bi\s+(bought|saw)\s+(?!(the|my|a|an|this|that|your|our|their|his|her|its|to|for|with|from|at|in|on|it|him|them|me|us)\b)\w+\b/i,
      "article",
    );
    // 中式直译高频模式
    check(/\bvery\s+(like|enjoy|miss|want|agree)\b/i, "chinglish-very");
    check(/\b(open|close)\s+(the\s+)?(light|lights|computer|tv|phone)\b/i, "chinglish-open");
    check(/\bhow\s+to\s+say\b/i, "chinglish-how-to-say");
    check(/\bmy\s+english\s+is\s+poor\b/i, "chinglish-poor");
    check(/\bmake\s+friend\b/i, "chinglish-plural");
    check(/\bdrink\s+soup\b/i, "chinglish-soup");
    check(/\bwash\s+(your\s+)?hand\b/i, "chinglish-plural");
    check(/\bwait\s+(me|him|her|them)\b/i, "chinglish-wait-for");
    check(/\bmarry\s+with\b/i, "chinglish-marry");
    check(/\bdiscuss\s+about\b/i, "chinglish-discuss");
    check(/\bi'?m\s+boring\b/i, "chinglish-bored");
    check(/\bi\s+think\s+\w+\s+can'?t\b/i, "chinglish-negation");
    check(/\b(listen\s+music|listen\s+the\s+music)\b/i, "chinglish-listen-to");
    check(/\b(play\s+your?\s+phone|play\s+phone)\b/i, "chinglish-phone");
    check(/\bsay\s+english\b/i, "chinglish-speak");

    return Array.from(hints);
  }

  /**
   * 本地检索：按「错误提示权重 > 技能知识匹配 > 关键词命中 > 标签命中 > 级别匹配」打分取 top-k。
   * - sceneChunks 注入（项目 Skill 的专属知识）时：这些 chunk 获得 +3 高权重（技能知识优先于全局库），
   *   且检索范围 = 技能知识 + 全局知识；未注入时仅全局检索
   * - 同一 topic 只保留得分最高的 1 条（避免相似 chunk 互相稀释）
   * - level 非空时优先同级别 chunk（不硬过滤，避免冷启动无结果）
   * - 无结果返回 []（调用方走无 knowledge 的 fallback prompt）
   */
  retrieve(query: string, hints: string[] = [], k = 4, level = "", sceneChunks: KnowledgeChunk[] = []): KnowledgeChunk[] {
    const skillChunks = sceneChunks ?? [];
    if (!this.chunks.length && !skillChunks.length) return [];

    const words = (query ?? "")
      .toLowerCase()
      .split(/[^a-z']+/i)
      .filter((w) => w.length >= 3);
    const hintSet = new Set(hints.map((h) => h.toLowerCase()));
    const scored: { chunk: KnowledgeChunk; score: number }[] = [];
    // 技能知识优先参与候选（Set 用于 O(1) 判定技能归属）
    const skillSet = new Set(skillChunks);
    const candidates = skillChunks.length ? [...skillChunks, ...this.chunks] : this.chunks;

    for (const chunk of candidates) {
      let score = 0;

      // 0) 技能知识匹配：当前 Skill 的专属知识优先（它是该场景的主战场）
      if (skillSet.has(chunk)) score += 3;

      // 1) 错误提示权重：命中 tag 或属中式错误模块 → 高分
      if (hintSet.size) {
        const tagHit = chunk.tags.some((tag) => hintSet.has(tag.toLowerCase()));
        if (tagHit) score += 4;
        // 中式错误提示命中时，05_chinglish 模块获得最高优先（精确纠正 > 泛化语法）
        if (chunk.category === "05_chinglish" && [...hintSet].some((h) => h.startsWith("chinglish"))) score += 5;
        if (chunk.category === "04_natural_english" && [...hintSet].some((h) => h.startsWith("chinglish"))) score += 1;
        // 泛化语法提示（tense/article/sv-agreement）命中语法模块
        if (chunk.category === "01_grammar" && [...hintSet].some((h) => h === "tense" || h === "article" || h === "subject-verb-agreement")) score += 2;
      }

      // 2) 关键词命中：查询词出现在 rule / examples / tags 中
      const haystack = [
        chunk.rule,
        ...chunk.examples.map((e) => e.text),
        ...chunk.tags,
      ]
        .join(" ")
        .toLowerCase();
      for (const w of words) {
        if (haystack.includes(w)) score += 1;
      }
      // topic 命中权重更高
      if (chunk.topic && words.some((w) => chunk.topic.toLowerCase().includes(w))) score += 2;

      // 3) level 匹配：有指定级别时同级别 +1（软偏好）
      if (level && chunk.level === level.toUpperCase()) score += 1;

      if (score > 0) scored.push({ chunk, score });
    }

    // 同一 topic 只保留最高分 1 条（技能知识与全局库同 topic 时，技能版本胜出）
    const bestByTopic = new Map<string, { chunk: KnowledgeChunk; score: number }>();
    for (const item of scored) {
      const cur = bestByTopic.get(item.chunk.topic);
      if (!cur || item.score > cur.score) bestByTopic.set(item.chunk.topic, item);
    }

    return Array.from(bestByTopic.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((item) => item.chunk);
  }

  /** 把 chunks 拼成 <knowledge> 块（每条含 id/category/topic/level/rule/examples/errors） */
  static buildKnowledgeBlock(chunks: KnowledgeChunk[]): string {
    if (!chunks.length) return "";
    const parts = chunks.map((c) => {
      const ex = c.examples
        .map((e) => `- ${e.text}${e.note ? ` (${e.note})` : ""}`)
        .join("\n");
      const err = c.common_errors.map((e) => `- ${e.error} -> ${e.fix}`).join("\n");
      return [
        `<chunk id="${c.id}" category="${c.category}" topic="${c.topic}" level="${c.level}">`,
        c.rule,
        ex ? `examples:\n${ex}` : "",
        err ? `common_errors:\n${err}` : "",
        `</chunk>`,
      ]
        .filter((s) => s.length > 0)
        .join("\n");
    });
    return `<knowledge>\n${parts.join("\n\n")}\n</knowledge>`;
  }

  /**
   * 组装 AI 英语口语陪练的 system prompt（人设优先）：
   *
   * 结构（从高到低优先级）：
   * 1. PERSONA 人设 —— 场景专属人设（scenario.persona）优先，其次默认 Alex 陪练人设；
   *    包含身份 / 语气 / 回复习惯 / 主动性（90% 的"松弛感"来自这里）
   * 2. 角色目标（一段话锁定"陪练伙伴"而非"老师/客服"）
   * 3. 场景上下文（当前场景，决定话题）
   * 4. 学习者画像（长期记忆摘要，可空）
   * 5. 纠错规则（知识库 07 AI Rules 落地版）
   * 6. <knowledge> 检索块（本轮依据，可空）
   *
   * 无画像 / 无知识块 / 无场景人设时均可降级运行。
   */
  buildTutorSystemPrompt(
    scenarioPrompt: string | null,
    chunks: KnowledgeChunk[],
    profileSummary: string = "",
    scenePersona: string | null = null,
  ): string {
    // 场景人设优先：每个场景在 scenarios.persona 定义自己的身份/语气/主动性；
    // 未配置（如旧数据）时回落到默认陪练人设
    const persona = scenePersona?.trim()
      ? `## PERSONA (who you are — follow this above all)\n${scenePersona.trim()}`
      : [
          "## PERSONA (who you are — follow this above all)",
          "You are Alex, the learner's AI speaking partner — the friend who happens to speak great English. You are NOT a teacher, NOT a customer-service bot, NOT a grammar textbook.",
          "Tone: warm, relaxed, upbeat. Sound like a friend texting: use everyday spoken English (cool, nice, got it, by the way, honestly, kind of), short sentences, natural contractions. Never sound corporate or robotic.",
          "Reply habits: keep it SHORT — 2 to 4 sentences per turn. Always end with ONE question or 2-3 quick options ('Want me to...? / How about...? / A or B?') so the conversation keeps moving.",
          "Be proactive: if something is unclear, ask a quick clarifying question instead of guessing. Offer help and choices naturally ('Do you want to try again?', 'I can give you a hint if you want.').",
        ].join("\n");

    const goal = [
      "## ROLE",
      "You are an AI English speaking companion for a Chinese learner. This is a DAILY SPOKEN ENGLISH PRACTICE session.",
      "Reply in ENGLISH only, even when the learner types or speaks Chinese — model the natural English sentence for them, then keep going in English.",
      "Learning is the goal, but conversation is the vehicle: never let a grammar lecture kill the chat.",
    ].join("\n");

    const scenario = scenarioPrompt ? `## SCENARIO\n${scenarioPrompt}` : "";
    const profile = profileSummary ? `## LEARNER PROFILE (from past sessions, may be imperfect)\n${profileSummary}` : "";

    const rules = [
      "## CORRECTION RULES",
      "Praise what is correct first, then fix ONE main error per turn with the SMALLEST change; prefer a natural 'recast' (quietly model the correct sentence) over grammar lectures.",
      "Explain rules in plain words, not jargon: one short clause + one example. If unsure, say so honestly — never invent rules.",
      "Use the <knowledge> chunks as your grammar authority when relevant.",
      "Do not over-correct valid informal spoken English; preserve the learner's meaning and voice; never judge the person, only the sentence.",
      "Anchor teaching to the current scenario; after correcting, invite a retry or a follow-up so the learner keeps speaking.",
    ].join("\n");

    const kb = KnowledgeService.buildKnowledgeBlock(chunks);
    return [persona, goal, scenario, profile, rules, kb].filter((s) => s.length > 0).join("\n\n");
  }

  /**
   * 把学习者画像渲染成 system prompt 里的一段摘要（无内容返回空串）。
   * 优先展示：高频错误（按次数 top-3）→ 累积轮次 → 近期话题。
   */
  buildLearnerProfileSummary(profile: LearnerProfile | null | undefined): string {
    if (!profile) return "";
    const counts = profile.error_counts ?? {};
    const entries = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (!entries.length && !profile.total_turns) return "";

    const lines: string[] = [];
    if (entries.length) {
      lines.push(
        `frequent error types (detected by a heuristic, take with a grain of salt): ${entries
          .map(([k, n]) => `${this.errorHintLabel(k)} (${n})`)
          .join(", ")}`,
      );
    }
    if (profile.total_turns) lines.push(`has practiced ~${profile.total_turns} turns in past sessions`);
    const topics = (profile.last_seen_topics ?? []).slice(-3);
    if (topics.length) lines.push(`recent topics: ${topics.join(", ")}`);
    return lines.join("; ") + ".";
  }

  /** 错误提示 → 可读标签（未识别时返回原文） */
  private errorHintLabel(hint: string): string {
    const map: Record<string, string> = {
      tense: "past tense",
      article: "missing article",
      "subject-verb-agreement": "third-person -s",
      "chinglish-very": "'very + verb' misuse",
      "chinglish-open": "'open/close' vs 'turn on/off'",
      "chinglish-how-to-say": "'how to say' structure",
      "chinglish-plural": "plural misuse",
      "chinglish-soup": "'drink soup'",
      "chinglish-negation": "'I think I can't'",
      "chinglish-listen-to": "'listen music'",
      "chinglish-speak": "'say English'",
      "chinglish-wait-for": "'wait me'",
      "chinglish-marry": "'marry with'",
      "chinglish-discuss": "'discuss about'",
      "chinglish-bored": "'I'm boring'",
      "chinglish-poor": "'my English is poor'",
      "chinglish-phone": "'play phone'",
    };
    return map[hint] ?? hint;
  }

  /** 把本轮检测到的错误提示累加进画像（原地修改并返回，供调用方落库） */
  static mergeErrorHints(profile: LearnerProfile | null | undefined, hints: string[]): LearnerProfile {
    const p: LearnerProfile = { ...(profile ?? {}), error_counts: { ...(profile?.error_counts ?? {}) } };
    for (const h of hints) {
      p.error_counts![h] = (p.error_counts![h] ?? 0) + 1;
    }
    p.total_turns = (p.total_turns ?? 0) + 1;
    return p;
  }
}
