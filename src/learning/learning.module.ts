import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LearningItem } from "./entities/learning-item.entity";
import { UserLearning } from "./entities/user-learning.entity";
import { LearningController } from "./learning.controller";
import { LearningService } from "./learning.service";

@Module({
  imports: [TypeOrmModule.forFeature([LearningItem, UserLearning])],
  controllers: [LearningController],
  providers: [LearningService],
})
export class LearningModule {}
