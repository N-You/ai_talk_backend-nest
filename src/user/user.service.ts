import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "./entities/user.entity";

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** 按主键查用户（不存在返回 null） */
  findById(id: number) {
    return this.userRepo.findOneBy({ id });
  }

  /** 更新昵称/头像，返回更新后的完整用户 */
  async update(id: number, data: Partial<Pick<User, "nickname" | "avatar">>) {
    await this.userRepo.update(id, data);
    return this.findById(id);
  }
}
