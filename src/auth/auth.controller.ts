import { Controller, Post, Body, ConflictException, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuthService } from "./auth.service";
import { User } from "../user/entities/user.entity";
import { LoginDto, RegisterDto } from "./dto/auth.dto";

@Controller("api/auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * 昵称登录（H5 免注册模式）：
   * 查不到该昵称则自动创建用户（隐式注册），返回 JWT + 用户信息。
   * 注意：昵称即身份，无密码校验，属原型设计（多人使用需接微信 code）。
   */
  @Post("login")
  async login(@Body() body: LoginDto) {
    // 微信登录简化：昵称即身份（H5 免注册模式），已存在则直接登录
    let user = await this.userRepo.findOneBy({ nickname: body.nickname });
    if (!user) {
      user = this.userRepo.create({ nickname: body.nickname });
      await this.userRepo.save(user);
    }
    const token = this.authService.createToken(user.id);
    return { access_token: token, user: { id: user.id, nickname: user.nickname, level: user.level } };
  }

  /**
   * 显式注册：先查重（昵称存在抛 409），再创建并签发 token。
   * 与 login 的区别：login 允许"存在即登录"，register 严格拒绝重名。
   */
  @Post("register")
  async register(@Body() body: RegisterDto) {
    const exists = await this.userRepo.findOneBy({ nickname: body.nickname });
    if (exists) {
      throw new ConflictException("Nickname already registered");
    }
    const user = this.userRepo.create({ nickname: body.nickname });
    await this.userRepo.save(user);
    const token = this.authService.createToken(user.id);
    return { access_token: token, user: { id: user.id, nickname: user.nickname, level: user.level } };
  }
}
