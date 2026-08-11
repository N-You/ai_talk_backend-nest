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

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Message, Scenario, User]), AuthModule],
  controllers: [ConversationController],
  providers: [ConversationService, ConversationGateway, AiService],
})
export class ConversationModule {}
