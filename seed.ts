// 种子数据脚本：node -r ts-node/register seed.ts
import "reflect-metadata";
import { DataSource } from "typeorm";
import { User } from "./src/user/entities/user.entity";
import { Scenario } from "./src/scenario/entities/scenario.entity";
import { Conversation } from "./src/conversation/entities/conversation.entity";
import { Message } from "./src/conversation/entities/message.entity";
import { LearningItem } from "./src/learning/entities/learning-item.entity";
import { UserLearning } from "./src/learning/entities/user-learning.entity";

const ds = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST ?? "localhost",
  port: parseInt(process.env.DB_PORT ?? "5432"),
  username: process.env.DB_USERNAME ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "english_tutor",
  entities: [User, Scenario, Conversation, Message, LearningItem, UserLearning],
  synchronize: true,
});

const SEEDS = [
  // 生活
  { name: "Coffee Shop", category: "life", description: "在咖啡店点单和交流", difficulty: 1, role: "barista", user_role: "customer", system_prompt: "You are a friendly barista at a coffee shop.", icon: "☕" },
  { name: "Restaurant", category: "life", description: "餐厅点餐和用餐交流", difficulty: 2, role: "waiter", user_role: "customer", system_prompt: "You are a waiter at a nice restaurant.", icon: "🍽️" },
  { name: "Hotel Check-in", category: "life", description: "酒店办理入住", difficulty: 2, role: "hotel_receptionist", user_role: "guest", system_prompt: "You are a receptionist at a hotel.", icon: "🏨" },
  { name: "Airport Check-in", category: "life", description: "机场办理登机相关表达", difficulty: 2, role: "airport_staff", user_role: "passenger", system_prompt: "You are an airport staff member.", icon: "✈️" },
  { name: "Shopping", category: "life", description: "购物场景交流", difficulty: 1, role: "shop_assistant", user_role: "customer", system_prompt: "You are a helpful shop assistant.", icon: "🛍️" },
  { name: "Daily Chat", category: "life", description: "日常聊天交流", difficulty: 1, role: "friend", user_role: "friend", system_prompt: "You are a friendly person having a casual chat.", icon: "💬" },
  // 职场
  { name: "Job Interview", category: "work", description: "英语面试场景", difficulty: 3, role: "interviewer", user_role: "candidate", system_prompt: "You are a professional interviewer.", icon: "💼" },
  { name: "Meeting", category: "work", description: "工作会议交流", difficulty: 3, role: "colleague", user_role: "team_member", system_prompt: "You are in a business meeting.", icon: "📊" },
  { name: "Presentation", category: "work", description: "工作汇报场景", difficulty: 3, role: "manager", user_role: "presenter", system_prompt: "You are a manager listening to a presentation.", icon: "📈" },
  { name: "Office Chat", category: "work", description: "同事日常交流", difficulty: 2, role: "colleague", user_role: "colleague", system_prompt: "You are a colleague at work.", icon: "💬" },
  // 程序员
  { name: "Daily Standup", category: "programmer", description: "每日站会报告", difficulty: 2, role: "scrum_master", user_role: "developer", system_prompt: "You are a Scrum Master running a daily standup.", icon: "💻" },
  { name: "Code Review", category: "programmer", description: "代码审查交流", difficulty: 3, role: "senior_developer", user_role: "developer", system_prompt: "You are a senior developer conducting a code review.", icon: "🔍" },
  { name: "Technical Interview", category: "programmer", description: "技术面试", difficulty: 4, role: "tech_interviewer", user_role: "candidate", system_prompt: "You are a technical interviewer.", icon: "🎯" },
  { name: "Discuss Architecture", category: "programmer", description: "讨论系统架构", difficulty: 4, role: "tech_lead", user_role: "developer", system_prompt: "You are a Tech Lead discussing architecture.", icon: "🏗️" },
  { name: "Debugging", category: "programmer", description: "调试 Bug 交流", difficulty: 2, role: "pair_programmer", user_role: "developer", system_prompt: "You are pair programming to debug.", icon: "🐛" },
];

async function seed() {
  await ds.initialize();
  const repo = ds.getRepository(Scenario);
  const count = await repo.count();
  if (count > 0) {
    console.log(`Already ${count} scenarios, skipping seed.`);
  } else {
    await repo.save(SEEDS.map((s) => repo.create(s)));
    console.log(`Seeded ${SEEDS.length} scenarios.`);
  }
  await ds.destroy();
}
seed();
