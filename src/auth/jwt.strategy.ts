import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "../user/entities/user.entity";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>("jwt.secret") ?? "dev-secret",
    });
  }

  /**
   * passport-jwt 回调：token 验签通过后执行。
   * 用 payload.sub 查库换取完整 User，挂到 req.user 供 @CurrentUser() 注入。
   * 用户不存在（已删除）时抛 401，保证令牌即时失效。
   */
  async validate(payload: { sub: number }): Promise<User> {
    const user = await this.userRepo.findOneBy({ id: payload.sub });
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
