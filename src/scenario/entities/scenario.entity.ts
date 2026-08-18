import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from "typeorm";
import { Conversation } from "../../conversation/entities/conversation.entity";

/**
 * 对话场景实体：定义 AI 扮演的角色、用户角色、系统提示词与难度。
 * - system_prompt：场景话题上下文（聊什么）
 * - persona：场景专属人设（AI 是谁、什么语气、怎么回复）——由 KnowledgeService 拼进 PERSONA 段，
 *   比 system_prompt 更靠前、优先级更高；为空时用默认陪练人设
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

  @Column({ type: "text", nullable: true, comment: "场景专属人设（身份/语气/回复习惯/主动性）" })
  persona: string;

  @Column({ length: 64, nullable: true, comment: "关联项目 Skill key（skills/<key>/），运行时加载该技能的人设/指令/专属知识" })
  skill_key: string;

  @Column({ length: 8, nullable: true })
  icon: string;

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @OneToMany(() => Conversation, (c) => c.scenario)
  conversations: Conversation[];
}
