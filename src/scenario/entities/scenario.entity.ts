import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from "typeorm";
import { Conversation } from "../../conversation/entities/conversation.entity";

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
