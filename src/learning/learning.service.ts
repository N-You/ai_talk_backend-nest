import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { LearningItem, LearningItemType } from "./entities/learning-item.entity";
import { UserLearning } from "./entities/user-learning.entity";

const REVIEW_RULES: Record<string, { masteryDelta: number; minutes?: number; days?: number }> = {
  again: { masteryDelta: -20, minutes: 10 },
  hard: { masteryDelta: 5, days: 1 },
  good: { masteryDelta: 15, days: 3 },
  easy: { masteryDelta: 25, days: 7 },
};

@Injectable()
export class LearningService {
  constructor(
    @InjectRepository(LearningItem) private readonly itemRepo: Repository<LearningItem>,
    @InjectRepository(UserLearning) private readonly ulRepo: Repository<UserLearning>,
  ) {}

  async list(userId: number, page = 1, size = 20, type?: string, status?: string) {
    const qb = this.ulRepo
      .createQueryBuilder("ul")
      .leftJoinAndSelect("ul.learning_item", "li")
      .where("ul.user_id = :userId", { userId });

    if (type) qb.andWhere("li.type = :type", { type });
    if (status === "review") qb.andWhere("ul.mastery < 80");
    if (status === "mastered") qb.andWhere("ul.mastery >= 80");

    qb.orderBy("ul.next_review_at", "ASC", "NULLS LAST");

    const total = await qb.getCount();
    const rows = await qb
      .offset((page - 1) * size)
      .limit(size)
      .getMany();

    const items = rows.map((ul) => ({
      id: ul.id,
      content: ul.learning_item?.content,
      type: ul.learning_item?.type,
      meaning: ul.learning_item?.meaning,
      phonetic: ul.learning_item?.phonetic,
      example: ul.learning_item?.example,
      audio_url: ul.learning_item?.audio_url,
      mastery: ul.mastery,
      encounter_count: ul.encounter_count,
      review_count: ul.review_count,
      next_review_at: ul.next_review_at,
      created_at: ul.created_at,
    }));

    return {
      items,
      total,
      page,
      size,
      pages: Math.ceil(total / size),
    };
  }

  async add(userId: number, content: string) {
    content = content.trim().toLowerCase();
    let item = await this.itemRepo.findOneBy({ content });
    if (!item) {
      item = this.itemRepo.create({ content, type: LearningItemType.WORD });
      await this.itemRepo.save(item);
    }

    let ul = await this.ulRepo.findOneBy({ user_id: userId, item_id: item.id });
    if (!ul) {
      ul = this.ulRepo.create({ user_id: userId, item_id: item.id });
      await this.ulRepo.save(ul);
    }

    return { ...ul, ...item };
  }

  async detail(userId: number, id: number) {
    const ul = await this.ulRepo.findOne({ where: { id, user_id: userId }, relations: ["learning_item"] });
    if (!ul) throw new NotFoundException();
    return ul;
  }

  async remove(userId: number, id: number) {
    const ul = await this.ulRepo.findOneBy({ id, user_id: userId });
    if (!ul) throw new NotFoundException();
    await this.ulRepo.remove(ul);
  }

  async review(userId: number, id: number, result: string) {
    const rule = REVIEW_RULES[result];
    if (!rule) throw new NotFoundException("Invalid review result");

    const ul = await this.ulRepo.findOne({ where: { id, user_id: userId }, relations: ["learning_item"] });
    if (!ul) throw new NotFoundException();

    ul.review_count += 1;
    ul.mastery = Math.min(100, Math.max(0, ul.mastery + rule.masteryDelta));

    const now = new Date();
    ul.last_review_at = now;
    if (rule.minutes) {
      ul.next_review_at = new Date(now.getTime() + rule.minutes * 60000);
    } else if (rule.days) {
      ul.next_review_at = new Date(now.getTime() + rule.days * 86400000);
    }

    await this.ulRepo.save(ul);
    return ul;
  }
}
