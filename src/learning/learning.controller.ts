import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards } from "@nestjs/common";
import { LearningService } from "./learning.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { User } from "../user/entities/user.entity";

@Controller("api/learning-items")
@UseGuards(JwtAuthGuard)
export class LearningController {
  constructor(private readonly service: LearningService) {}

  @Get()
  async list(
    @CurrentUser() user: User,
    @Query("page") page = 1,
    @Query("size") size = 20,
    @Query("type") type?: string,
    @Query("status") status?: string,
  ) {
    return this.service.list(user.id, +page, +size, type, status);
  }

  @Post()
  async add(@CurrentUser() user: User, @Body() body: { content: string }) {
    return this.service.add(user.id, body.content);
  }

  @Get(":id")
  async detail(@CurrentUser() user: User, @Param("id") id: number) {
    return this.service.detail(user.id, id);
  }

  @Delete(":id")
  async remove(@CurrentUser() user: User, @Param("id") id: number) {
    await this.service.remove(user.id, id);
    return { ok: true };
  }

  @Post(":id/review")
  async review(
    @CurrentUser() user: User,
    @Param("id") id: number,
    @Body() body: { result: string },
  ) {
    return this.service.review(user.id, id, body.result);
  }
}
