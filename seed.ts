// 种子数据脚本：node -r ts-node/register seed.ts
// 说明：场景数据以项目 Skill（skills/<key>/skill.json）为唯一数据源（人设 persona + 指令 instructions +
// 话题 system_prompt + 元数据），本脚本把技能「同步」到 scenarios 表：
//   - 技能对应场景 → upsert（同名更新字段，保留 conversation 关联）
//   - 不在任何技能内的旧场景 → 删除（连同其会话，避免外键约束失败）
// 新增场景 = 新建 skills/<key>/（skill.json + knowledge.jsonl）→ 重跑 seed。
import "reflect-metadata";
import { DataSource } from "typeorm";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
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

/** 项目 Skill 根目录：ts-node 运行时 __dirname = backend-nest */
const SKILLS_DIR = join(__dirname, "skills");

interface SkillJson {
  key: string;
  name: string;
  category?: string;
  description?: string;
  difficulty?: number;
  role?: string;
  user_role?: string;
  icon?: string;
  system_prompt?: string;
  persona?: string;
  instructions?: string[];
}

/** 读取 skills/<key>/skill.json */
function loadSkills(): SkillJson[] {
  const skills: SkillJson[] = [];
  if (!existsSync(SKILLS_DIR)) {
    console.warn(`技能目录不存在: ${SKILLS_DIR}`);
    return skills;
  }
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(SKILLS_DIR, entry.name, "skill.json");
    if (!existsSync(skillFile)) continue;
    try {
      const skill = JSON.parse(readFileSync(skillFile, "utf-8")) as SkillJson;
      if (skill.key && skill.name) skills.push(skill);
      else console.warn(`跳过无效技能（缺 key/name）: ${entry.name}`);
    } catch (e) {
      console.warn(`技能解析失败，跳过: ${entry.name} (${(e as Error).message})`);
    }
  }
  return skills;
}

async function seed() {
  await ds.initialize();
  const repo = ds.getRepository(Scenario);

  const skills = loadSkills();
  const existing = await repo.find();
  const keepKeys = new Set(skills.map((s) => s.key));

  // 1) 删除不属于任何技能的场景（skill_key 为空或不在技能列表；先清关联会话，避免外键约束失败）
  for (const sc of existing) {
    const keep = sc.skill_key ? keepKeys.has(sc.skill_key) : false;
    if (!keep) {
      await ds.query(`DELETE FROM conversations WHERE scenario_id = $1`, [sc.id]);
      await repo.delete(sc.id);
      console.log(`Removed scenario: ${sc.name} (${sc.skill_key ?? "no-skill"})`);
    }
  }

  // 2) upsert 技能对应场景（按 skill_key 匹配；同名更新字段，保留 conversation 关联）
  for (const s of skills) {
    const found = existing.find((e) => e.skill_key === s.key);
    const row = {
      name: s.name,
      category: s.category ?? "life",
      description: s.description ?? "",
      difficulty: s.difficulty ?? 1,
      role: s.role ?? "ai",
      user_role: s.user_role ?? null,
      system_prompt: s.system_prompt ?? null,
      persona: s.persona ?? null,
      skill_key: s.key,
      icon: s.icon ?? null,
    };
    if (found) {
      await repo.update(found.id, row);
      console.log(`Updated scenario: ${s.name} (${s.key})`);
    } else {
      await repo.save(repo.create(row));
      console.log(`Created scenario: ${s.name} (${s.key})`);
    }
  }

  const after = await repo.find();
  console.log(`Scenarios now: ${after.map((s) => `${s.name}(${s.skill_key})`).join(", ")}`);
  await ds.destroy();
}
seed();
