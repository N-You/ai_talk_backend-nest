import { Controller, Get, Param, ParseIntPipe, Query, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Scenario } from "./entities/scenario.entity";

@Controller("api/scenarios")
export class ScenarioController {
  constructor(
    @InjectRepository(Scenario)
    private readonly repo: Repository<Scenario>,
  ) {}

  /** 场景列表：可选按 category 过滤，按难度升序返回 */
  @Get()
  async list(@Query("category") category?: string) {
    const where: any = {};
    if (category) where.category = category;
    return this.repo.find({ where, order: { difficulty: "ASC" } });
  }

  /** 场景详情：ParseIntPipe 保证非数字 ID 返回 400 而非 500 */
  @Get(":id")
  async detail(@Param("id", ParseIntPipe) id: number) {
    const s = await this.repo.findOneBy({ id });
    if (!s) throw new NotFoundException("Scenario not found");
    return s;
  }
}
