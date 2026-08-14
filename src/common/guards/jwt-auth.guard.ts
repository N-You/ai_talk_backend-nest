import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * JWT 认证守卫：基于 passport 的 "jwt" 策略。
 * 用法：@UseGuards(JwtAuthGuard)，配合 @CurrentUser() 取用户。
 * 未携带有效 Bearer token 的请求会被 401 拒绝。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}
