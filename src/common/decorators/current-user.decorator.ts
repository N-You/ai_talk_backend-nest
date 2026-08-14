import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { User } from "../../user/entities/user.entity";

/**
 * 参数装饰器：从请求对象中取出已认证的当前用户（由 JwtStrategy.validate 挂载）。
 * 用法：async profile(@CurrentUser() user: User)
 * 省去每个接口重复从 req 解析用户的操作。
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): User => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
