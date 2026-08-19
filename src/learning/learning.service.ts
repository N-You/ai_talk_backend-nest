import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { MoreThanOrEqual, Repository } from "typeorm";
import { LearningItem, LearningItemType } from "./entities/learning-item.entity";
import { UserLearning } from "./entities/user-learning.entity";
import { ConversationService } from "../conversation/conversation.service";

/**
 * 间隔重复（SM-2 简化）调度规则：
 * - again 忘记：mastery -20，10 分钟后重来
 * - hard  模糊：mastery +5，1 天后
 * - good  认识：mastery +15，3 天后
 * - easy  熟练：mastery +25，7 天后
 */
const REVIEW_RULES: Record<string, { masteryDelta: number; minutes?: number; days?: number }> = {
  again: { masteryDelta: -20, minutes: 10 },
  hard: { masteryDelta: 5, days: 1 },
  good: { masteryDelta: 15, days: 3 },
  easy: { masteryDelta: 25, days: 7 },
};

/** 每日新词目标的默认值 / 上下限 */
const DAILY_GOAL_DEFAULT = 5;
const DAILY_GOAL_MIN = 1;
const DAILY_GOAL_MAX = 50;

/** 每道意思匹配题的选项数（1 正确 + 3 干扰） */
const QUIZ_OPTION_COUNT = 4;

@Injectable()
export class LearningService {
  constructor(
    @InjectRepository(LearningItem) private readonly itemRepo: Repository<LearningItem>,
    @InjectRepository(UserLearning) private readonly ulRepo: Repository<UserLearning>,
    private readonly conversationService: ConversationService,
  ) {}

  /**
   * 分页查询用户学习项：
   * - leftJoin learning_item 联表取内容/释义等
   * - type 过滤类型；status=review 过滤 mastery<80（待复习）、mastered ≥80（已掌握）
   * - search 用 ILIKE 模糊匹配 content/meaning
   * - 按 next_review_at 升序（NULLS LAST），"待复习"的自然浮到最前
   */
  async list(userId: number, page = 1, size = 20, type?: string, status?: string, search?: string) {
    const qb = this.ulRepo
      .createQueryBuilder("ul")
      .leftJoinAndSelect("ul.learning_item", "li")
      .where("ul.user_id = :userId", { userId });

    if (type) qb.andWhere("li.type = :type", { type });
    if (status === "review") qb.andWhere("ul.mastery < 80");
    if (status === "mastered") qb.andWhere("ul.mastery >= 80");
    if (search?.trim()) {
      const kw = `%${search.trim()}%`;
      qb.andWhere("(li.content ILIKE :kw OR li.meaning ILIKE :kw)", { kw });
    }

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

  /**
   * 幂等添加：content 小写化后查重 learning_items（全局字典表），
   * 再查重 user_learning（用户关联表），两处都"存在即复用"，不会产生重复记录。
   * meta 可选：对话中点词加生词本时直接携带 LLM 查到的释义/音标/例句（省一次补全调用）；
   * 无释义的词触发异步 LLM 补全（enrichItem，不阻塞添加主流程）。
   */
  async add(
    userId: number,
    content: string,
    meta?: { meaning?: string; phonetic?: string; example?: string },
  ) {
    content = content.trim().toLowerCase();
    if (!content) throw new BadRequestException("Content is required");
    if (content.length > 500) throw new BadRequestException("Content too long (max 500 chars)");
    let item = await this.itemRepo.findOneBy({ content });
    if (!item) {
      item = this.itemRepo.create({
        content,
        type: LearningItemType.WORD,
        meaning: meta?.meaning || null,
        phonetic: meta?.phonetic || null,
        example: meta?.example || null,
      });
      await this.itemRepo.save(item);
    } else if (meta?.meaning && !item.meaning) {
      // 字典已有该词但释义为空 → 用本次携带的释义回填
      item.meaning = meta.meaning;
      if (meta.phonetic) item.phonetic = meta.phonetic;
      if (meta.example) item.example = meta.example;
      await this.itemRepo.save(item);
    }

    let ul = await this.ulRepo.findOneBy({ user_id: userId, item_id: item.id });
    if (!ul) {
      ul = this.ulRepo.create({ user_id: userId, item_id: item.id });
      await this.ulRepo.save(ul);
    }

    // 无释义 → 异步用 LLM 补全（quiz 出题依赖 meaning；失败静默不影响添加）
    if (!item.meaning) {
      this.enrichItem(userId, item.id).catch((e) =>
        console.warn(`[learning] enrich meaning failed for "${content}": ${e.message}`),
      );
    }

    return { ...ul, ...item };
  }

  /**
   * 异步补全生词释义：复用对话模块 explainWord（LLM 查词），
   * 成功后回写 learning_items 的 meaning/phonetic/example。
   * 已有效释义或 LLM 兜底文案时不覆盖。
   */
  private async enrichItem(userId: number, itemId: number) {
    const item = await this.itemRepo.findOneBy({ id: itemId });
    if (!item || item.meaning) return;
    const info = await this.conversationService.explainWord(userId, item.content);
    if (info.meaning && !info.meaning.includes("暂无法解释")) {
      item.meaning = info.meaning;
      if (info.phonetic) item.phonetic = info.phonetic;
      if (info.example) item.example = info.example;
      await this.itemRepo.save(item);
    }
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

  /**
   * 复习调度：查 REVIEW_RULES 表更新 mastery（clamp 0-100）与 next_review_at。
   * result 非法（不在表中）抛 404。
   */
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

  // ── 每日学习计划（生词本闭环核心）──────────────────────────────

  /** 当日零点（本地时区） */
  private dayStart(now = new Date()) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  /** 下一天零点 */
  private nextDayStart(now = new Date()) {
    return new Date(this.dayStart(now).getTime() + 86400000);
  }

  /** 该用户所有「有学习痕迹」的日期集合（learned_at 或 last_review_at），用于计算连续天数 */
  private async learnDaySet(userId: number): Promise<Set<string>> {
    const rows = await this.ulRepo
      .createQueryBuilder("ul")
      .select("ul.learned_at", "learned_at")
      .addSelect("ul.last_review_at", "last_review_at")
      .where("ul.user_id = :userId", { userId })
      .getRawMany();
    const days = new Set<string>();
    for (const r of rows) {
      if (r.learned_at) days.add(new Date(r.learned_at).toDateString());
      if (r.last_review_at) days.add(new Date(r.last_review_at).toDateString());
    }
    return days;
  }

  /**
   * 今日学习计划总览（首页/生词本/练习页共用一次拉取）：
   * - goal：每日新词目标（users.settings.dailyWordGoal，默认 5）
   * - new_done：今日已学新词数；new_total：今日应学总数（= goal）
   * - reviews_due：今日到期复习数；reviews_done：今日已完成复习数
   * - mastered_total：已掌握生词总数（mastery ≥ 80）
   * - streak_days：连续学习天数（今天或昨天有记录即续上）
   * - today_words：今日已学新词明细（首页"今日生词"列表）
   */
  async getDailyPlan(userId: number, settings?: { dailyWordGoal?: number }) {
    const goal = Math.min(DAILY_GOAL_MAX, Math.max(DAILY_GOAL_MIN, settings?.dailyWordGoal ?? DAILY_GOAL_DEFAULT));
    const now = new Date();
    const start = this.dayStart(now);
    const end = this.nextDayStart(now);

    // 今日已学新词：learned_at 落在今天（含明细）
    const todayNew = await this.ulRepo
      .createQueryBuilder("ul")
      .leftJoinAndSelect("ul.learning_item", "li")
      .where("ul.user_id = :userId", { userId })
      .andWhere("ul.learned_at >= :start", { start })
      .andWhere("ul.learned_at < :end", { end })
      .orderBy("ul.learned_at", "ASC")
      .getMany();

    // 今日到期复习（next_review_at 已到）
    const reviewsDue = await this.ulRepo
      .createQueryBuilder("ul")
      .where("ul.user_id = :userId", { userId })
      .andWhere("ul.next_review_at IS NOT NULL")
      .andWhere("ul.next_review_at <= :now", { now })
      .getCount();

    // 今日已完成复习（last_review_at 落在今天）
    const reviewsDone = await this.ulRepo
      .createQueryBuilder("ul")
      .where("ul.user_id = :userId", { userId })
      .andWhere("ul.last_review_at >= :start", { start })
      .andWhere("ul.last_review_at < :end", { end })
      .getCount();

    const masteredTotal = await this.ulRepo.countBy({ user_id: userId, mastery: MoreThanOrEqual(80) });

    // 连续学习天数：今天没记录则从昨天起算
    const days = await this.learnDaySet(userId);
    let streak = 0;
    const cursor = new Date();
    if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
    while (days.has(cursor.toDateString())) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    return {
      goal,
      new_done: todayNew.length,
      new_total: goal,
      reviews_due: reviewsDue,
      reviews_done: reviewsDone,
      mastered_total: masteredTotal,
      streak_days: streak,
      today_words: todayNew.map((ul) => ({
        id: ul.id,
        content: ul.learning_item?.content,
        phonetic: ul.learning_item?.phonetic,
        meaning: ul.learning_item?.meaning,
        mastery: ul.mastery,
      })),
    };
  }

  /**
   * 完成一个新词学习（每日新词意思匹配答对后调用）：
   * - learned_at 首次写入（当天新词进度 +1）
   * - mastery 保底到 L1（15），不因答对直接跳级
   * - next_review_at 设为明天 → 次日进入复习队列，开启间隔重复
   */
  async learn(userId: number, id: number) {
    const ul = await this.ulRepo.findOne({ where: { id, user_id: userId }, relations: ["learning_item"] });
    if (!ul) throw new NotFoundException();

    const now = new Date();
    ul.learned_at = ul.learned_at ?? now;
    ul.encounter_count += 1;
    ul.mastery = Math.min(100, Math.max(ul.mastery, 15));
    ul.next_review_at = new Date(now.getTime() + 86400000); // 明天开始复习

    await this.ulRepo.save(ul);
    return ul;
  }

  /**
   * 生成「单词-意思匹配」测验（4 选 1）：
   * - type=new 从待学候选（learned_at 为空且未掌握且有释义）抽取；type=review 从到期复习抽取；mixed 复习优先再补新词
   * - 每道题：展示单词 + 音标，4 个释义选项（1 正确 + 3 随机干扰项，干扰项取自全词库其他词释义）
   * - 干扰项不足时按可用数量降级（最少 2 项），词库足够后自动恢复 4 项
   */
  async quiz(userId: number, type: string = "mixed", count = 10) {
    const mode = type === "new" || type === "review" ? type : "mixed";
    const now = new Date();

    // 1) 候选池：新词候选 + 到期复习候选（均需已有释义）
    const pool: UserLearning[] = [];
    const seenItems = new Set<number>();

    const pushPool = (rows: UserLearning[]) => {
      for (const r of rows) {
        if (!r.learning_item?.meaning || seenItems.has(r.learning_item.id)) continue;
        seenItems.add(r.learning_item.id);
        pool.push(r);
      }
    };

    if (mode === "new" || mode === "mixed") {
      pushPool(
        await this.ulRepo
          .createQueryBuilder("ul")
          .leftJoinAndSelect("ul.learning_item", "li")
          .where("ul.user_id = :userId", { userId })
          .andWhere("ul.learned_at IS NULL")
          .andWhere("ul.mastery < 80")
          .andWhere("li.meaning IS NOT NULL")
          .getMany(),
      );
    }
    if (mode === "review" || mode === "mixed") {
      pushPool(
        await this.ulRepo
          .createQueryBuilder("ul")
          .leftJoinAndSelect("ul.learning_item", "li")
          .where("ul.user_id = :userId", { userId })
          .andWhere("ul.next_review_at IS NOT NULL")
          .andWhere("ul.next_review_at <= :now", { now })
          .andWhere("li.meaning IS NOT NULL")
          .getMany(),
      );
    }

    // 2) 随机打乱后截取 count 道
    const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, count);
    if (!picked.length) return { items: [], mode, total: 0 };

    // 3) 干扰项池：全词库中其他词的释义（一次查询复用）
    const raw = await this.itemRepo
      .createQueryBuilder("li")
      .select("li.meaning", "meaning")
      .where("li.meaning IS NOT NULL")
      .getRawMany<{ meaning: string }>();
    const distractors = [...new Set(raw.map((r) => r.meaning.trim()))].filter(Boolean);

    const items = picked.map((ul) => {
      const word = ul.learning_item!;
      const correct = word.meaning!.trim();
      // 与正确释义不同的干扰项，随机取 3 个
      const wrong = distractors.filter((d) => d !== correct).sort(() => Math.random() - 0.5).slice(0, 3);
      // 保证至少 2 个选项可作答；不足 2 个的题目直接跳过
      if (wrong.length < 1) return null;
      const options = [...wrong, correct].sort(() => Math.random() - 0.5);
      return {
        id: ul.id,
        content: word.content,
        phonetic: word.phonetic,
        is_new: !ul.learned_at, // 前端据此决定答对后调 learn 还是 review
        options,
        answer_index: options.indexOf(correct),
      };
    }).filter(Boolean);

    return { items, mode, total: items.length };
  }
}
