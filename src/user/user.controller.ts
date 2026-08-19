import { Controller, Get, Put, Body, UseGuards } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UserService } from "./user.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { User } from "./entities/user.entity";
import { UpdateSettingsDto } from "../auth/dto/auth.dto";

@Controller("api/user")
export class UserController {
  constructor(
    private readonly userService: UserService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  /**
   * 获取当前用户资料（含 AI 自定义配置 settings）。
   * 注意：settings.apiKey 当前为明文回显，属已知技术债（建议加密存储 + 脱敏）。
   */
  @Get("profile")
  @UseGuards(JwtAuthGuard)
  async profile(@CurrentUser() user: User) {
    return { id: user.id, nickname: user.nickname, avatar: user.avatar, level: user.level, settings: user.settings };
  }

  @Put("profile")
  @UseGuards(JwtAuthGuard)
  async update(@CurrentUser() user: User, @Body() body: { nickname?: string; avatar?: string }) {
    return this.userService.update(user.id, body);
  }

  @Get("settings")
  @UseGuards(JwtAuthGuard)
  async getSettings(@CurrentUser() user: User) {
    return user.settings ?? {};
  }

  /**
   * 覆盖式保存用户配置：{ apiKey?, apiBase?, model?, dailyWordGoal? } 合并写入 users.settings JSON 列。
   * 采用 merge（读旧值 + 合并新值）而非整体覆盖，避免前端只更新单字段（如 dailyWordGoal）
   * 时把已保存的 apiKey/apiBase/model 清掉。会话网关读取该配置后优先于 .env 默认值。
   */
  @Put("settings")
  @UseGuards(JwtAuthGuard)
  async updateSettings(@CurrentUser() user: User, @Body() body: UpdateSettingsDto) {
    const merged = { ...(user.settings ?? {}), ...body };
    await this.userRepo.update(user.id, { settings: merged });
    return { ok: true };
  }
}
