import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { UserLearning } from "./user-learning.entity";

/** 学习内容类型（对话中"记录表达"按此归类） */
export enum LearningItemType {
  WORD = "WORD",
  PHRASE = "PHRASE",
  SENTENCE = "SENTENCE",
  EXPRESSION = "EXPRESSION",
}

/**
 * 学习内容字典实体：全局共享的单词/短语/句子/表达，与用户通过 user_learning 多对多关联。
 * 一个 content 只在字典里存一份，避免每用户冗余。
 */
@Entity("learning_items")
export class LearningItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 512 })
  content: string;

  @Column({ type: "enum", enum: LearningItemType, default: LearningItemType.WORD })
  type: LearningItemType;

  @Column({ type: "text", nullable: true })
  meaning: string;

  @Column({ length: 256, nullable: true })
  phonetic: string;

  @Column({ type: "text", nullable: true })
  example: string;

  @Column({ length: 512, nullable: true })
  audio_url: string;

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at: Date;

  @OneToMany(() => UserLearning, (ul) => ul.learning_item)
  user_learnings: UserLearning[];
}
