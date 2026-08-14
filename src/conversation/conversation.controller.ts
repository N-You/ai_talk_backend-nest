import { Controller, Get, Post, Put, Param, ParseIntPipe, Body, UseGuards, NotFoundException } from "@nestjs/common";
import { ConversationService } from "./conversation.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { User } from "../user/entities/user.entity";

@Controller("api/conversations")
@UseGuards(JwtAuthGuard)
export class ConversationController {
  constructor(private readonly service: ConversationService) {}

  /** 创建会话：需指定场景，返回会话 + 场景名（供前端聊天页头部展示） */
  @Post()
  async create(@CurrentUser() user: User, @Body() body: { scenario_id: number }) {
    return this.service.create(user.id, body.scenario_id);
  }

  /** 当前用户会话列表（最近 50 条，按开始时间倒序） */
  @Get()
  async list(@CurrentUser() user: User) {
    return this.service.listByUser(user.id);
  }

  /** 会话详情（含消息与场景）；归属校验在 service 的 where 条件里完成，防越权 */
  @Get(":id")
  async detail(@CurrentUser() user: User, @Param("id", ParseIntPipe) id: number) {
    return this.service.detail(id, user.id);
  }

  /** 结束会话：记录结束时间、时长（秒）、可选评分与英语使用率 */
  @Put(":id/end")
  async end(
    @CurrentUser() user: User,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: { score?: number; english_ratio?: number },
  ) {
    return this.service.end(id, user.id, body.score, body.english_ratio);
  }

  /**
   * 单词释义查询：对话中点击任意英文单词，返回 { word, phonetic, meaning, example }。
   * 供前端弹窗展示；"加入生词本"由前端调 learningApi.add 完成。
   */
  @Post("explain-word")
  async explainWord(@CurrentUser() user: User, @Body() body: { word: string }) {
    return this.service.explainWord(user.id, body.word);
  }
}
