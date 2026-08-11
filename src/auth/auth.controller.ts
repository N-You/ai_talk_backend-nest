import { Controller, Post, Body } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuthService } from "./auth.service";
import { User } from "../user/entities/user.entity";

@Controller("api/auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  @Post("login")
  async login(@Body() body: { code?: string; nickname?: string }) {
    // 微信登录简化：直接用 code 或 nickname 创建/查找用户
    let user = await this.userRepo.findOneBy({ nickname: body.nickname ?? "Learner" });
    if (!user) {
      user = this.userRepo.create({ nickname: body.nickname ?? `User_${Date.now()}` });
      await this.userRepo.save(user);
    }
    const token = this.authService.createToken(user.id);
    return { access_token: token, user: { id: user.id, nickname: user.nickname, level: user.level } };
  }

  @Post("register")
  async register(@Body() body: { nickname: string }) {
    const user = this.userRepo.create({ nickname: body.nickname });
    await this.userRepo.save(user);
    const token = this.authService.createToken(user.id);
    return { access_token: token, user: { id: user.id, nickname: user.nickname, level: user.level } };
  }
}
