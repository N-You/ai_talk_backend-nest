import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "../../user/entities/user.entity";
import { LearningItem } from "./learning-item.entity";

/**
 * 用户-学习项关联实体：记录每个用户对某学习项的掌握状态（间隔重复核心状态机）。
 * mastery 0-100、encounter_count 遇到次数、next_review_at 下次复习时间。
 */
@Entity("user_learning")
export class UserLearning {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  user_id: number;

  @Column()
  item_id: number;

  @Column({ type: "float", default: 0 })
  mastery: number;

  @Column({ default: 1 })
  encounter_count: number;

  @Column({ default: 0 })
  review_count: number;

  @Column({ type: "timestamptz", nullable: true })
  last_review_at: Date;

  @Column({ type: "timestamptz", nullable: true })
  next_review_at: Date;

  /** 首次通过「每日新词」完成学习的时间（null = 尚未正式学习，每日新词候选） */
  @Column({ type: "timestamptz", nullable: true })
  learned_at: Date;

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at: Date;

  @ManyToOne(() => User, (u) => u.learning_items, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @ManyToOne(() => LearningItem, (li) => li.user_learnings, { onDelete: "CASCADE" })
  @JoinColumn({ name: "item_id" })
  learning_item: LearningItem;
}
