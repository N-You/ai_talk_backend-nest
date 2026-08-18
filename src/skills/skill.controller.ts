import { Controller, Get, Post, Param, Body, NotFoundException } from "@nestjs/common";
import { SkillService } from "./skill.service";
import { KnowledgeService } from "../knowledge/knowledge.service";

/**
 * 项目 Skill 调用接口：
 * - GET  /api/skills                    技能列表
 * - GET  /api/skills/:key               技能详情（人设/指令/话题/知识统计）
 * - POST /api/skills/:key/preview       执行预览：输入一句用户话 → 返回该技能实际注入的
 *                                        system prompt 摘要 + 命中的知识（用于验证/调试调用）
 */
@Controller("api/skills")
export class SkillController {
  constructor(
    private readonly skills: SkillService,
    private readonly kb: KnowledgeService,
  ) {}

  @Get()
  list() {
    return this.skills.listSkills();
  }

  @Get(":key")
  detail(@Param("key") key: string) {
    const skill = this.skills.getSkill(key);
    if (!skill) throw new NotFoundException(`Skill not found: ${key}`);
    return {
      key: skill.key,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      icon: skill.icon,
      difficulty: skill.difficulty,
      role: skill.role,
      user_role: skill.user_role,
      trigger: skill.trigger,
      persona: skill.persona,
      instructions: skill.instructions,
      system_prompt: skill.system_prompt,
      tools: skill.tools ?? [],
      knowledge_count: skill.chunks.length,
    };
  }

  /** 执行预览：模拟一次该技能下的对话注入，返回组装好的 system prompt 与命中知识 */
  @Post(":key/preview")
  preview(@Param("key") key: string, @Body() body: { content?: string }) {
    const skill = this.skills.getSkill(key);
    if (!skill) throw new NotFoundException(`Skill not found: ${key}`);

    const content = typeof body?.content === "string" ? body.content.slice(0, 2000) : "";
    const hints = content ? this.kb.detectErrorHints(content) : [];
    const kbChunks = content
      ? this.kb.retrieve(content, hints, 4, "", this.skills.getChunks(key))
      : [];
    const systemPrompt = this.skills.buildSystemPrompt(skill, kbChunks, "");

    return {
      skill: key,
      input: content || "(empty)",
      hints,
      retrieved: kbChunks.map((c) => ({ id: c.id, topic: c.topic, scene: c.scene })),
      systemPrompt,
    };
  }
}
