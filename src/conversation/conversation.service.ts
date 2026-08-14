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

  /** 某用户最近 50 条会话（倒序） */
  async listByUser(userId: number) {
    return this.convRepo.find({
      where: { user_id: userId },
      order: { started_at: "DESC" },
      take: 50,
    });
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
   * 复用 AiService.chat 让 LLM 返回结构化 JSON（词/音标/中文释义/例句），
   * 解析失败或 LLM 无 key 时兜底返回"暂无法解释"，不抛错打断体验。
   */
  async explainWord(userId: number, word: string) {
    const w = word.trim().toLowerCase().slice(0, 60);
    if (!w) throw new BadRequestException("word is required");

    // 与对话一致：优先使用用户自定义 AI 配置（若已保存）
    const u = await this.userRepo.findOneBy({ id: userId });
    const settings = u?.settings ?? undefined;

    const system = [
      "You are an English-Chinese dictionary.",
      "Reply with ONLY a JSON object, no markdown, with exactly these keys:",
      '{"word":"...","phonetic":"/.../","meaning":"中文释义","example":"英文例句（含中文翻译）"}',
      "Keep meaning concise (one line).",
    ].join("\n");

    try {
      const raw = await this.ai.chat(
        [
          { role: "system", content: system },
          { role: "user", content: w },
        ],
        settings,
      );
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const j = JSON.parse(cleaned);
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
}
