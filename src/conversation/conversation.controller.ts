import { Controller, Get, Post, Put, Param, Body, UseGuards, NotFoundException } from "@nestjs/common";
import { ConversationService } from "./conversation.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { User } from "../user/entities/user.entity";

@Controller("api/conversations")
@UseGuards(JwtAuthGuard)
export class ConversationController {
  constructor(private readonly service: ConversationService) {}

  @Post()
  async create(@CurrentUser() user: User, @Body() body: { scenario_id: number }) {
    return this.service.create(user.id, body.scenario_id);
  }

  @Get()
  async list(@CurrentUser() user: User) {
    return this.service.listByUser(user.id);
  }

  @Get(":id")
  async detail(@CurrentUser() user: User, @Param("id") id: number) {
    return this.service.detail(id, user.id);
  }

  @Put(":id/end")
  async end(
    @CurrentUser() user: User,
    @Param("id") id: number,
    @Body() body: { score?: number; english_ratio?: number },
  ) {
    return this.service.end(id, user.id, body.score, body.english_ratio);
  }
}
