import { Controller, Get, Query } from "@nestjs/common";
import { KnowledgeService } from "./knowledge.service";

/**
 * 全局知识库查询接口（调试 / 学习页可选接入）：
 * - GET /knowledge/stats                    模块/级别分布
 * - GET /knowledge/search?q=...&level=A2&k=5  检索全局知识 chunks
 * 项目 Skill 的查询/预览走 /api/skills（含技能专属知识加权检索）。
 */
@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly kb: KnowledgeService) {}

  @Get("stats")
  stats() {
    return this.kb.stats();
  }

  @Get("search")
  search(@Query("q") q = "", @Query("level") level = "", @Query("k") k = "5") {
    const hints = this.kb.detectErrorHints(q);
    const kNum = Math.min(Math.max(parseInt(k, 10) || 5, 1), 20);
    const chunks = this.kb.retrieve(q, hints, kNum, level);
    return {
      total: chunks.length,
      hints,
      chunks: chunks.map((c) => ({
        id: c.id,
        category: c.category,
        topic: c.topic,
        level: c.level,
        tags: c.tags,
        rule: c.rule,
      })),
    };
  }
}
