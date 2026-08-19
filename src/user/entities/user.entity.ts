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

/**
 * 用户实体：昵称唯一（H5 免注册的登录凭据）。
 * settings 为 JSON 列，存用户自定义 AI 配置 { apiKey?, apiBase?, model? }。
 * error_profile 为 JSON 列，存学习者长期画像（错误类型计数/轮次/近期话题，见 KnowledgeService.LearnerProfile）。
 */
@Entity("users")
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 64, unique: true })
  nickname: string;

  @Column({ length: 512, nullable: true })
  avatar: string;

  @Column({ length: 32, default: "beginner" })
  level: string;

  @Column({ type: "json", nullable: true })
  settings: {
    apiKey?: string;
    apiBase?: string;
    model?: string;
    dailyWordGoal?: number;
    speed?: number;
    temperature?: number;
  } | null;

  @Column({ type: "json", nullable: true })
  error_profile: {
    error_counts?: Record<string, number>;
    total_turns?: number;
    last_seen_topics?: string[];
  } | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at: Date;

  @OneToMany(() => Conversation, (c) => c.user)
  conversations: Conversation[];

  @OneToMany(() => UserLearning, (ul) => ul.user)
  learning_items: UserLearning[];
}
