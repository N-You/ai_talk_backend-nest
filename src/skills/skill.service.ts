import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { KnowledgeChunk, KnowledgeService } from "../knowledge/knowledge.service";

/**
 * 项目 Skill 定义（skills/<key>/skill.json）：
 * - persona：人设（身份/语气/回复习惯/主动性，四要素）
 * - instructions：行为指令（逐条规则，注入 system prompt 的 INSTRUCTIONS 段）
 * - system_prompt：话题上下文（聊什么/场景流程）
 * - knowledge：专属知识文件（knowledge.jsonl，chunks 带 scene 标记）
 * - tools：预留工具声明（function calling 扩展位）
 */
export interface ProjectSkill {
  key: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  difficulty?: number;
  role?: string;
  user_role?: string;
  trigger?: string;
  persona?: string;
  instructions?: string[];
  system_prompt?: string;
  tools?: string[];
  chunks: KnowledgeChunk[];
}

/**
 * 项目 Skill 服务：扫描并加载 backend-nest/skills/<key>/（skill.json + knowledge.jsonl）。
 *
 * 与 WorkBuddy 对话环境的 Skill 机制不同，这里是**项目运行时可直接调用**的能力包：
 * - getSkill / listSkills：查询已加载技能
 * - getChunks：取技能专属知识（注入 KnowledgeService.retrieve 做加权检索）
 * - buildSystemPrompt：把技能的人设 + 指令 + 话题 + 画像 + 检索知识组装成 system prompt
 *
 * 调用方（ConversationGateway）：按 conversation.scenario.skill_key 取技能 → 注入对话；
 * 调试接口（SkillController）：GET /api/skills、GET /api/skills/:key、POST /api/skills/:key/preview。
 *
 * 路径解析：dev npm start（cwd=backend-nest）；prod Docker WORKDIR=/app（COPY . . 带入 skills）
 */
@Injectable()
export class SkillService implements OnModuleInit {
  private readonly logger = new Logger(SkillService.name);
  private static readonly SKILL_DIRS: string[] = [
    join(process.cwd(), "skills"),
    join(__dirname, "..", "..", "..", "skills"),
  ];

  private skills = new Map<string, ProjectSkill>();

  onModuleInit() {
    this.load();
  }

  private load() {
    const dir = SkillService.SKILL_DIRS.find((p) => existsSync(p));
    if (!dir) {
      this.logger.warn(`技能目录未找到（尝试: ${SkillService.SKILL_DIRS.join(", ")}），对话将使用默认人设`);
      return;
    }
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillDir = join(dir, entry.name);
        const skillFile = join(skillDir, "skill.json");
        if (!existsSync(skillFile)) continue;
        try {
          const meta = JSON.parse(readFileSync(skillFile, "utf-8"));
          const key = meta.key ?? entry.name;
          const kbFile = join(skillDir, meta.knowledge ?? "knowledge.jsonl");
          const chunks = existsSync(kbFile) ? KnowledgeService.parseJsonl(readFileSync(kbFile, "utf-8")) : [];
          this.skills.set(key, { ...meta, key, chunks });
          this.logger.log(
            `Skill 加载成功: ${key} (${chunks.length} chunks, persona=${meta.persona ? "yes" : "no"}, instructions=${meta.instructions?.length ?? 0})`,
          );
        } catch (e) {
          this.logger.warn(`Skill 解析失败，已跳过: ${entry.name} (${(e as Error).message})`);
        }
      }
    } catch (e) {
      this.logger.warn(`技能目录读取失败: ${(e as Error).message}`);
    }
  }

  // ── 查询 ──────────────────────────────────────

  getSkill(key: string): ProjectSkill | undefined {
    return this.skills.get(key);
  }

  hasSkill(key: string): boolean {
    return this.skills.has(key);
  }

  /** 技能列表（元信息，不含 chunks） */
  listSkills(): { key: string; name: string; category?: string; icon?: string; description?: string; chunks: number }[] {
    return Array.from(this.skills.values()).map((s) => ({
      key: s.key,
      name: s.name,
      category: s.category,
      icon: s.icon,
      description: s.description,
      chunks: s.chunks.length,
    }));
  }

  /** 取技能专属知识（供 KnowledgeService.retrieve 注入） */
  getChunks(key: string): KnowledgeChunk[] {
    return this.skills.get(key)?.chunks ?? [];
  }

  // ── 执行（组装可注入的 system prompt）──

  /**
   * 按技能组装 system prompt：
   * PERSONA（技能人设）→ INSTRUCTIONS（行为指令）→ SCENARIO（话题/流程）→
   * LEARNER PROFILE（画像，可空）→ <knowledge>（检索结果，可空）
   * 人设/指令缺失时回落默认陪练人设与默认规则。
   */
  buildSystemPrompt(skill: ProjectSkill, kbChunks: KnowledgeChunk[], profileSummary: string = ""): string {
    const persona = skill.persona?.trim()
      ? `## PERSONA (who you are — follow this above all)\n${skill.persona.trim()}`
      : [
          "## PERSONA (who you are — follow this above all)",
          "You are Alex, the learner's AI speaking partner — the friend who happens to speak great English. You are NOT a teacher, NOT a customer-service bot, NOT a grammar textbook.",
          "Tone: warm, relaxed, upbeat. Sound like a friend texting: everyday spoken English, short sentences, natural contractions.",
          "Reply habits: keep it SHORT — 2 to 4 sentences per turn. Always end with ONE question or 2-3 quick options.",
          "Be proactive: if something is unclear, ask a quick clarifying question; offer help and choices naturally.",
        ].join("\n");

    const instructions =
      (skill.instructions?.length ?? 0) > 0
        ? `## INSTRUCTIONS\n${skill.instructions.join("\n")}`
        : [
            "## INSTRUCTIONS",
            "Reply in ENGLISH only, even when the learner types or speaks Chinese — model the natural sentence, then keep going in English.",
            "Praise what is correct first, then fix ONE main error per turn with the SMALLEST change; prefer a natural 'recast' over grammar lectures.",
            "Explain rules in plain words, not jargon: one short clause + one example. If unsure, say so honestly — never invent rules.",
            "Use the <knowledge> chunks as your grammar authority when relevant.",
            "Do not over-correct valid informal spoken English; preserve the learner's meaning and voice.",
            "Keep replies short (2-4 sentences) and end with one question or 2-3 options so the conversation keeps moving.",
          ].join("\n");

    const scenario = skill.system_prompt?.trim() ? `## SCENARIO\n${skill.system_prompt.trim()}` : "";
    const profile = profileSummary ? `## LEARNER PROFILE (from past sessions, may be imperfect)\n${profileSummary}` : "";
    const kb = KnowledgeService.buildKnowledgeBlock(kbChunks);

    return [persona, instructions, scenario, profile, kb].filter((s) => s.length > 0).join("\n\n");
  }
}
