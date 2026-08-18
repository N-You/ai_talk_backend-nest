import { Module } from "@nestjs/common";
import { KnowledgeService } from "./knowledge.service";
import { KnowledgeController } from "./knowledge.controller";

/**
 * 知识库模块：加载 english_knowledge_base.jsonl 并提供本地 RAG 检索。
 * - 导出 KnowledgeService 供 ConversationGateway 注入（检索 → 注入 <knowledge>）
 * - 提供 GET /knowledge/search 供调试与学习页展示
 */
@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
