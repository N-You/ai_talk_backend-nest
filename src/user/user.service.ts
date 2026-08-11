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

  findById(id: number) {
    return this.userRepo.findOneBy({ id });
  }

  async update(id: number, data: Partial<Pick<User, "nickname" | "avatar">>) {
    await this.userRepo.update(id, data);
    return this.findById(id);
  }
}
