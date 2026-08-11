import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { Conversation } from "../../conversation/entities/conversation.entity";
import { UserLearning } from "../../learning/entities/user-learning.entity";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 64 })
  nickname: string;

  @Column({ length: 512, nullable: true })
  avatar: string;

  @Column({ length: 32, default: "beginner" })
  level: string;

  @Column({ type: "json", nullable: true })
  settings: { apiKey?: string; apiBase?: string; model?: string } | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at: Date;

  @OneToMany(() => Conversation, (c) => c.user)
  conversations: Conversation[];

  @OneToMany(() => UserLearning, (ul) => ul.user)
  learning_items: UserLearning[];
}
