import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Scenario } from "./entities/scenario.entity";
import { ScenarioController } from "./scenario.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Scenario])],
  controllers: [ScenarioController],
})
export class ScenarioModule {}
