export enum LearningItemType {
  WORD = "WORD",
  PHRASE = "PHRASE",
  SENTENCE = "SENTENCE",
  EXPRESSION = "EXPRESSION",
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { UserLearning } from "./user-learning.entity";

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
