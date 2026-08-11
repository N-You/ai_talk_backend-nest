import { Controller, Get, Param, Query, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Scenario } from "./entities/scenario.entity";

@Controller("api/scenarios")
export class ScenarioController {
  constructor(
    @InjectRepository(Scenario)
    private readonly repo: Repository<Scenario>,
  ) {}

  @Get()
  async list(@Query("category") category?: string) {
    const where: any = {};
    if (category) where.category = category;
    return this.repo.find({ where, order: { difficulty: "ASC" } });
  }

  @Get(":id")
  async detail(@Param("id") id: number) {
    const s = await this.repo.findOneBy({ id });
    if (!s) throw new NotFoundException("Scenario not found");
    return s;
  }
}
