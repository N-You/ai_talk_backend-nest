import { Module } from "@nestjs/common";
import { SkillService } from "./skill.service";
import { SkillController } from "./skill.controller";
import { KnowledgeModule } from "../knowledge/knowledge.module";

@Module({
  imports: [KnowledgeModule],
  controllers: [SkillController],
  providers: [SkillService],
  exports: [SkillService],
})
export class SkillModule {}
