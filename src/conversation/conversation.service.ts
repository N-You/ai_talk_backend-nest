import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Conversation } from "./entities/conversation.entity";
import { Message } from "./entities/message.entity";
import { Scenario } from "../scenario/entities/scenario.entity";
import { User } from "../user/entities/user.entity";
import { AiService } from "./ai.service";

@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Scenario) private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly ai: AiService,
  ) {}

  /** 创建会话：校验场景存在后建记录，附带场景名方便前端展示 */
  async create(userId: number, scenarioId: number) {
    const scenario = await this.scenarioRepo.findOneBy({ id: scenarioId });
    if (!scenario) throw new NotFoundException("Scenario not found");

    const conv = this.convRepo.create({ user_id: userId, scenario_id: scenarioId });
    const saved = await this.convRepo.save(conv);
    return { ...saved, scenario_name: scenario.name };
  }

  /** 某用户最近 50 条会话（倒序，附带场景名供首页"继续练习"展示） */
  async listByUser(userId: number) {
    const rows = await this.convRepo.find({
      where: { user_id: userId },
      relations: ["scenario"],
      order: { started_at: "DESC" },
      take: 50,
    });
    return rows.map((c) => ({
      id: c.id,
      scenario_id: c.scenario_id,
      scenario_name: c.scenario?.name ?? "历史对话",
      started_at: c.started_at,
      ended_at: c.ended_at,
      duration: c.duration,
      score: c.score,
      english_ratio: c.english_ratio,
    }));
  }

  /**
   * 删除会话：归属校验内嵌在 delete 条件 { id, user_id } 中（防越权）。
   * messages 通过外键级联删除（onDelete: CASCADE），无需手动清理。
   */
  async remove(id: number, userId: number) {
    const result = await this.convRepo.delete({ id, user_id: userId });
    if (!result.affected) throw new NotFoundException("Conversation not found");
    return { ok: true };
  }

  /**
   * 会话详情。归属校验内嵌在 where { id, user_id } 中：
   * 查不到即 404，天然阻止访问他人会话（防越权）。
   */
  async detail(id: number, userId: number) {
    const conv = await this.convRepo.findOne({
      where: { id, user_id: userId },
      relations: ["messages", "scenario"],
    });
    if (!conv) throw new NotFoundException("Conversation not found");
    return conv;
  }

  /** 结束会话：写 ended_at、按起止时间算 duration 秒数、可选写入评分与英语使用率 */
  async end(id: number, userId: number, score?: number, englishRatio?: number) {
    const conv = await this.convRepo.findOneBy({ id, user_id: userId });
    if (!conv) throw new NotFoundException();

    conv.ended_at = new Date();
    if (conv.started_at) conv.duration = Math.round((conv.ended_at.getTime() - conv.started_at.getTime()) / 1000);
    if (score !== undefined) conv.score = score;
    if (englishRatio !== undefined) conv.english_ratio = englishRatio;
    return this.convRepo.save(conv);
  }

  /** 消息落库：user 消息在生成前写入，assistant 消息在流结束后写入 */
  async addMessage(conversationId: number, role: string, content: string) {
    const msg = this.msgRepo.create({ conversation_id: conversationId, role, content });
    return this.msgRepo.save(msg);
  }

  /**
   * 单词释义查询（对话中点击单词弹窗用）：
   * 复用 AiService.chat 让 LLM 返回结构化 JSON（词/音标/中文释义/例句）。
   * 健壮性：max_tokens 提到 512 防截断；prompt 强约束 JSON 合法性与引号转义；
   * 解析采用「整体 parse → 提取 {...} 片段 parse」容错，仍失败才兜底返回。
   */
  async explainWord(userId: number, word: string) {
    const w = word.trim().toLowerCase().slice(0, 60);
    if (!w) throw new BadRequestException("word is required");

    // 与对话一致：优先使用用户自定义 AI 配置（若已保存）
    const u = await this.userRepo.findOneBy({ id: userId });
    const settings = u?.settings ?? undefined;

    const system = [
      "You are an English-Chinese dictionary.",
      "Reply with ONLY ONE JSON object — no markdown, no code fences, no text before or after:",
      '{"word":"...","phonetic":"/.../","meaning":"中文释义","example":"英文例句（含中文翻译）"}',
      "RULES:",
      "- Escape every double quote inside a value with a backslash (e.g. He said \\\"hi\\\").",
      "- meaning: one concise line of Chinese.",
      "- example: one complete English sentence with its Chinese translation in parentheses.",
      "- Output valid JSON only.",
    ].join("\n");

    try {
      const raw = await this.ai.chat(
        [
          { role: "system", content: system },
          { role: "user", content: w },
        ],
        settings,
        512, // 4 个字段的 JSON：256 容易被截断导致解析失败
        true, // jsonMode：response_format=json_object 强制合法 JSON
      );
      const j = this.parseLlmJson(raw);
      if (!j) {
        console.warn(`[explainWord] LLM 输出无法解析为 JSON: ${raw.slice(0, 120)}`);
        return { word: w, phonetic: "", meaning: "暂无法解释该词，请稍后再试", example: "" };
      }
      return {
        word: typeof j.word === "string" && j.word ? j.word : w,
        phonetic: typeof j.phonetic === "string" ? j.phonetic : "",
        meaning: typeof j.meaning === "string" ? j.meaning : "",
        example: typeof j.example === "string" ? j.example : "",
      };
    } catch {
      return { word: w, phonetic: "", meaning: "暂无法解释该词，请稍后再试", example: "" };
    }
  }

  /**
   * 从 LLM 输出中尽力提取 JSON 对象（容错三连）：
   * 1) 清理 markdown 代码块后整体 parse
   * 2) 提取第一个 { 到最后一个 } 的片段再 parse（兼容多余前后缀文本）
   * 3) 均失败返回 null（调用方兜底）
   */
  private parseLlmJson(raw: string): any | null {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // ignore, fall through to fragment extraction
    }
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // ignore
      }
    }
    return null;
  }
}
