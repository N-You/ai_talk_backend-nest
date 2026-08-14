import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Conversation } from "./conversation.entity";

/**
 * 消息实体：对话中的单条 user/assistant 消息。
 * 随会话级联删除；language 标记语种（en/zh/mix，供后续统计）。
 */
@Entity("messages")
export class Message {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  conversation_id: number;

  @Column({ length: 16, comment: "user / assistant" })
  role: string;

  @Column({ type: "text" })
  content: string;

  @Column({ length: 512, nullable: true })
  audio_url: string;

  @Column({ length: 16, nullable: true, comment: "en / zh / mix" })
  language: string;

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: "CASCADE" })
  @JoinColumn({ name: "conversation_id" })
  conversation: Conversation;
}
