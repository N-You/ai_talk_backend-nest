import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LearningItem } from "./entities/learning-item.entity";
import { UserLearning } from "./entities/user-learning.entity";
import { LearningController } from "./learning.controller";
import { LearningService } from "./learning.service";
import { ConversationModule } from "../conversation/conversation.module";

@Module({
  // ConversationModule：复用 explainWord 给新添加的生词异步补全释义（quiz 出题依赖 meaning）
  imports: [TypeOrmModule.forFeature([LearningItem, UserLearning]), ConversationModule],
  controllers: [LearningController],
  providers: [LearningService],
})
export class LearningModule {}
