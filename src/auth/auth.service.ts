import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  /**
   * 签发 JWT：payload 仅含 sub（userId），保持最小化 claims。
   * 过期时间由 JwtModule 的 expiresIn 配置决定（默认 7d）。
   */
  createToken(userId: number): string {
    return this.jwt.sign({ sub: userId });
  }

  /**
   * 验签并解出 payload；任何异常（过期/篡改/格式错误）都返回 null。
   * 供 REST 之外的场景复用（如 WebSocket 握手认证），不抛异常而是返回 null 由调用方决定。
   */
  verifyToken(token: string): { sub: number } | null {
    try {
      return this.jwt.verify<{ sub: number }>(token);
    } catch {
      return null;
    }
  }
}
