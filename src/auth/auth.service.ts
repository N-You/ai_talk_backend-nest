import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  createToken(userId: number): string {
    return this.jwt.sign({ sub: userId });
  }

  verifyToken(token: string): { sub: number } | null {
    try {
      return this.jwt.verify<{ sub: number }>(token);
    } catch {
      return null;
    }
  }
}
