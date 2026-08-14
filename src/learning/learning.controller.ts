import { Controller, Get, Post, Delete, Param, ParseIntPipe, Body, Query, UseGuards } from "@nestjs/common";
import { LearningService } from "./learning.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { User } from "../user/entities/user.entity";

@Controller("api/learning-items")
@UseGuards(JwtAuthGuard)
export class LearningController {
  constructor(private readonly service: LearningService) {}

  /**
   * 学习项分页列表：支持 type（单词/短语…）、status（review/mastered）、search 关键字过滤。
   * 返回 { items, total, page, size, pages }。
   */
  @Get()
  async list(
    @CurrentUser() user: User,
    @Query("page") page = 1,
    @Query("size") size = 20,
    @Query("type") type?: string,
    @Query("status") status?: string,
    @Query("search") search?: string,
  ) {
    return this.service.list(user.id, +page, +size, type, status, search);
  }

  /** 添加学习内容（对话中"记录表达"、学习库手动添加共用） */
  @Post()
  async add(@CurrentUser() user: User, @Body() body: { content: string }) {
    return this.service.add(user.id, body.content);
  }

  @Get(":id")
  async detail(@CurrentUser() user: User, @Param("id", ParseIntPipe) id: number) {
    return this.service.detail(user.id, id);
  }

  @Delete(":id")
  async remove(@CurrentUser() user: User, @Param("id", ParseIntPipe) id: number) {
    await this.service.remove(user.id, id);
    return { ok: true };
  }

  /**
   * 复习提交：result ∈ again/hard/good/easy，返回更新后的 mastery 与 next_review_at。
   * 前端用返回值局部更新列表，无需整页刷新。
   */
  @Post(":id/review")
  async review(
    @CurrentUser() user: User,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: { result: string },
  ) {
    return this.service.review(user.id, id, body.result);
  }
}
