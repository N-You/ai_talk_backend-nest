import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Conversation } from "./entities/conversation.entity";
import { Message } from "./entities/message.entity";
import { Scenario } from "../scenario/entities/scenario.entity";
import { User } from "../user/entities/user.entity";
import { ConversationController } from "./conversation.controller";
import { ConversationService } from "./conversation.service";
import { ConversationGateway } from "./conversation.gateway";
import { AiService } from "./ai.service";
import { AuthModule } from "../auth/auth.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { SkillModule } from "../skills/skill.module";

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Message, Scenario, User]), AuthModule, KnowledgeModule, SkillModule],
  controllers: [ConversationController],
  providers: [ConversationService, ConversationGateway, AiService],
  // 导出 ConversationService：learning 模块复用 explainWord 做生词释义异步补全
  exports: [ConversationService],
})
export class ConversationModule {}
