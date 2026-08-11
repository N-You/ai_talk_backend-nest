import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Conversation } from "./entities/conversation.entity";
import { Message } from "./entities/message.entity";
import { Scenario } from "../scenario/entities/scenario.entity";

@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Scenario) private readonly scenarioRepo: Repository<Scenario>,
  ) {}

  async create(userId: number, scenarioId: number) {
    const scenario = await this.scenarioRepo.findOneBy({ id: scenarioId });
    if (!scenario) throw new NotFoundException("Scenario not found");

    const conv = this.convRepo.create({ user_id: userId, scenario_id: scenarioId });
    const saved = await this.convRepo.save(conv);
    return { ...saved, scenario_name: scenario.name };
  }

  async listByUser(userId: number) {
    return this.convRepo.find({
      where: { user_id: userId },
      order: { started_at: "DESC" },
      take: 50,
    });
  }

  async detail(id: number, userId: number) {
    const conv = await this.convRepo.findOne({
      where: { id, user_id: userId },
      relations: ["messages", "scenario"],
    });
    if (!conv) throw new NotFoundException("Conversation not found");
    return conv;
  }

  async end(id: number, userId: number, score?: number, englishRatio?: number) {
    const conv = await this.convRepo.findOneBy({ id, user_id: userId });
    if (!conv) throw new NotFoundException();

    conv.ended_at = new Date();
    if (conv.started_at) conv.duration = Math.round((conv.ended_at.getTime() - conv.started_at.getTime()) / 1000);
    if (score !== undefined) conv.score = score;
    if (englishRatio !== undefined) conv.english_ratio = englishRatio;
    return this.convRepo.save(conv);
  }

  async addMessage(conversationId: number, role: string, content: string) {
    const msg = this.msgRepo.create({ conversation_id: conversationId, role, content });
    return this.msgRepo.save(msg);
  }
}
