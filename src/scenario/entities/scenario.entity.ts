import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from "typeorm";
import { Conversation } from "../../conversation/entities/conversation.entity";

/**
 * 对话场景实体：定义 AI 扮演的角色、用户角色、系统提示词与难度。
 * 系统提示词（system_prompt）在会话网关中被拼进 LLM 消息，决定 AI 的扮演风格。
 */
@Entity("scenarios")
export class Scenario {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 128 })
  name: string;

  @Column({ length: 32 })
  category: string;

  @Column({ type: "text", nullable: true })
  description: string;

  @Column({ default: 1 })
  difficulty: number;

  @Column({ length: 64 })
  role: string;

  @Column({ length: 64, nullable: true })
  user_role: string;

  @Column({ type: "text", nullable: true })
  system_prompt: string;

  @Column({ length: 8, nullable: true })
  icon: string;

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @OneToMany(() => Conversation, (c) => c.scenario)
  conversations: Conversation[];
}
