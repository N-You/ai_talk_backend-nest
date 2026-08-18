# 项目 Skill 机制说明（Knowledge + Skill Module）

本项目把「英语口语陪练」能力拆成**项目内可加载、可执行的 Skill 工具文件**：
`backend-nest/skills/<key>/`（skill.json 人设/指令 + knowledge.jsonl 专属知识），
由后端 `SkillService` 启动时扫描加载，对话时按 `scenario.skill_key` 调用对应技能；
全局语法/纠错知识仍在 `KnowledgeService`（assets/english_knowledge_base.jsonl）。

> 与 WorkBuddy 对话环境的 Skill 机制无关——这里是**后端运行时直接调用**的项目技能。

## 目录结构

```
backend-nest/
├── assets/
│   └── english_knowledge_base.jsonl   ← 全局知识库（394 chunks，通用语法/纠错）
├── skills/                             ← 项目 Skill 工具文件（后端运行时加载）
│   ├── daily_chat/
│   │   ├── skill.json                 ← 技能定义：persona 人设 + instructions 指令 + system_prompt 话题
│   │   └── knowledge.jsonl            ← 技能专属知识（17 chunks，scene=daily_chat）
│   └── shopping/
│       ├── skill.json                 ← Mia 店员人设 + 购物流程指令
│       └── knowledge.jsonl            ← 购物专属知识（11 chunks）
├── scripts/
│   └── build_scene_kb.py              ← 技能知识生成器（从全局库提取 + 技能补充条目）
└── src/
    ├── skills/                        ← SkillService：加载 skills/、getSkill、buildSystemPrompt
    │   ├── skill.service.ts
    │   ├── skill.controller.ts        ← GET /api/skills、/:key、POST /:key/preview
    │   └── skill.module.ts
    └── knowledge/                     ← KnowledgeService：全局库检索 + 错误检测 + <knowledge> 块
```

## Skill 文件格式（skill.json）

```json
{
  "key": "shopping",          // 技能唯一标识，也是 scenario.skill_key
  "name": "Shopping",         // 场景展示名（前端场景列表）
  "description": "购物场景：逛店、试穿、问价、折扣、结账",
  "icon": "🛍️",
  "difficulty": 1,
  "role": "shop_assistant",   // AI 角色
  "user_role": "customer",    // 用户角色
  "trigger": "用户选择「购物」场景进入对话时自动启用",
  "persona": "人设（身份/语气/回复习惯/主动性，四要素）",
  "instructions": ["行为指令1", "指令2", "..."],
  "system_prompt": "话题上下文：这个场景聊什么、流程是什么",
  "knowledge": "knowledge.jsonl",
  "tools": []                 // 预留：工具声明（function calling 扩展位）
}
```

## 如何调用（三种方式）

1. **对话自动调用（主路径）**：用户选择场景进入对话 →
   `conversation.scenario.skill_key` → `SkillService.getSkill(key)` →
   `buildSystemPrompt`（人设 + 指令 + 话题 + 画像 + 知识）注入 system prompt → 流式回复。
2. **REST 接口调用**：
   - `GET  /api/skills`              技能列表（含知识条数）
   - `GET  /api/skills/:key`         技能详情（persona/instructions/system_prompt/tools）
   - `POST /api/skills/:key/preview` 执行预览：传用户句子 → 返回该技能实际注入的 system prompt + 命中知识
3. **代码内调用**：`skillService.getSkill(key)` / `skillService.getChunks(key)` /
   `skillService.buildSystemPrompt(skill, kbChunks, profileSummary)`。

## 运行时链路（ConversationGateway.respond）

```
skillKey = conv.scenario.skill_key
skill    = skillService.getSkill(skillKey)                    // 技能不存在 → 回落默认人设
kbChunks = kb.retrieve(content, hints, 4, "", skillService.getChunks(skillKey))  // 技能知识加权优先
systemPrompt = skillService.buildSystemPrompt(skill, kbChunks, profileSummary)
→ 随历史 30 条发给 LLM（AiService.chatStream 流式）
```

## 新增一个 Skill（零代码改动）

1. 新建 `skills/<key>/skill.json`（persona 四要素 + instructions + system_prompt）
2. 生成知识：在 `scripts/build_scene_kb.py` 的 `SCENE_TOPICS`/`SCENE_EXTRA` 登记 →
   `python scripts/build_scene_kb.py`；或手写 `knowledge.jsonl`（每条带 `"scene": "<key>"`）
3. `npm run seed` 同步 `scenarios` 表 → 重启后端生效

## 约定与坑

- **id 唯一稳定**：技能知识 id = `<key>_NNNN`（生成器幂等）；手写保持前缀一致。
- **scene 标记**：技能知识必须带 `"scene": "<key>"`；`SkillService.getChunks` 注入后由
  `retrieve` 加权（+3，技能知识优先于全局库，同 topic 技能版本胜出）。
- **不破坏全局库**：技能只放该场景高频表达/错误，通用语法留在全局库。
- **降级安全**：skill.json/knowledge.jsonl 缺失 → 回落默认人设 + 全局检索，对话不断。
- **改技能后需重启后端**（启动时加载）。

## 更新知识库

- 全局库：独立仓库 `english-ai-knowledge-base/build/` 重新生成后复制回 `assets/`。
- 技能知识：改 `scripts/build_scene_kb.py` 后重跑；技能人设/指令：直接改 `skills/<key>/skill.json`。
