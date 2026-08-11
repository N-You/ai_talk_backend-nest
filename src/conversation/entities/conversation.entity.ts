import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from "typeorm";
import { User } from "../../user/entities/user.entity";
import { Scenario } from "../../scenario/entities/scenario.entity";
import { Message } from "./message.entity";

@Entity("conversations")
export class Conversation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  user_id: number;

  @Column({ nullable: true })
  scenario_id: number;

  @CreateDateColumn({ type: "timestamptz" })
  started_at: Date;

  @Column({ type: "timestamptz", nullable: true })
  ended_at: Date;

  @Column({ nullable: true })
  duration: number;

  @Column({ type: "float", nullable: true })
  score: number;

  @Column({ type: "float", nullable: true, comment: "英语使用率" })
  english_ratio: number;

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @ManyToOne(() => User, (u) => u.conversations, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @ManyToOne(() => Scenario, (s) => s.conversations, { onDelete: "SET NULL" })
  @JoinColumn({ name: "scenario_id" })
  scenario: Scenario;

  @OneToMany(() => Message, (m) => m.conversation)
  messages: Message[];
}
