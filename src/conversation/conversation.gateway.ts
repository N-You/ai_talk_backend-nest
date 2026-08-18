import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { OnModuleDestroy } from "@nestjs/common";
import { WebSocketServer as WsServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Conversation } from "./entities/conversation.entity";
import { Message } from "./entities/message.entity";
import { Scenario } from "../scenario/entities/scenario.entity";
import { User } from "../user/entities/user.entity";
import { ConversationService } from "./conversation.service";
import { AuthService } from "../auth/auth.service";
import { AiService, LlmBusyError } from "./ai.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { SkillService } from "../skills/skill.service";

/**
 * 原生 WebSocket 网关（H5 优先，协议与 uni.connectSocket 兼容）
 * 协议：客户端发送 {"event":"...","data":{...}}，服务端回 {"event":"...","data":{...}}
 *
 * 连接健壮性三件套：
 * 1. 心跳检测：服务端每 30s 发协议级 ping 帧，浏览器自动回 pong（RFC6455，JS 无感知），
 *    30s 内未收到 pong 的连接视为死链 terminate()（前端触发 close 自动重连）。
 *    另提供应用层 ping/pong（客户端 25s 主动发 {"event":"ping"}，服务端回 pong），
 *    供前端做"长时间无消息判定假死"的兜底。
 * 2. 房间 Room：按 conversation_id 分组（rooms: convId → Set<client>），
 *    join 时入房、断开自动出房；text/AI 流广播到整个房间 → 同一会话多端实时同步。
 * 3. 断线恢复：连接断开即中断进行中的 AI 生成（AbortController，省 token）并从房间移除；
 *    前端指数退避自动重连成功后重新 join 即可无缝继续。
 *
 * Streaming 事件协议：
 * - ai_stream: data { delta }      生成中的增量文本（多次）
 * - ai_done:   data { text }       完整文本（结束，前端用于固化消息）
 * - ai_error:  data { message }    生成失败
 */
@WebSocketGateway({ path: "/ws/conversations" })
export class ConversationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server!: WsServer;

  /** 连接 → userId（握手认证通过后写入；断开自动 GC） */
  private userIds = new WeakMap<WebSocket, number>();
  /** 连接 → 当前所在房间的 conversation_id（断开时据此出房） */
  private clientRoom = new WeakMap<WebSocket, number>();
  /** 房间表：conversation_id → 该会话的所有在线连接（多端同步） */
  private rooms = new Map<number, Set<WebSocket>>();
  /** 每个连接当前是否已有正在生成的流，防止并发重复触发 */
  private busy = new WeakSet<WebSocket>();
  /** 心跳存活标记：ping 前置 false，收到 pong 置回 true */
  private isAlive = new WeakSet<WebSocket>();
  /** 心跳探测定时器（30s 一轮） */
  private heartbeatTimer: NodeJS.Timeout | null = null;

  /** 每连接发送频率限制：30s 窗口内最多 RATE_MAX 条 text（防单用户高频刷打爆上游） */
  private readonly RATE_WINDOW_MS = 30_000;
  private readonly RATE_MAX = 5;
  private textTimes = new WeakMap<WebSocket, number[]>();

  constructor(
    private readonly convService: ConversationService,
    private readonly authService: AuthService,
    private readonly aiService: AiService,
    private readonly kbService: KnowledgeService,
    private readonly skillService: SkillService,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Scenario) private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  /** 令牌桶限速：滑动窗口内未超限则记录本次并放行；WeakMap 断开自动 GC，无需清理 */
  private allowText(client: WebSocket): boolean {
    const now = Date.now();
    const recent = (this.textTimes.get(client) ?? []).filter((t) => now - t < this.RATE_WINDOW_MS);
    if (recent.length >= this.RATE_MAX) {
      this.textTimes.set(client, recent);
      return false;
    }
    recent.push(now);
    this.textTimes.set(client, recent);
    return true;
  }

  // ── 生命周期 ──────────────────────────────────────

  /** 网关初始化：启动心跳探测（协议级 ping/pong，30s 一轮） */
  afterInit() {
    const HEARTBEAT_INTERVAL_MS = 30_000;
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.server.clients) {
        if (!this.isAlive.has(client)) {
          // 上一轮 ping 后未收到 pong → 死链，踢掉（前端 close 后自动重连）
          console.warn("[gateway] heartbeat timeout, terminating dead connection");
          client.terminate();
          continue;
        }
        this.isAlive.delete(client);
        client.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /** 服务销毁：清理心跳定时器 */
  onModuleDestroy() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * WS 握手认证：从 URL query 取 token 验签。
   * 通过则记录「连接 → userId」并纳入心跳；失败则 close(4001)。
   */
  handleConnection(client: WebSocket, req: IncomingMessage) {
    try {
      const url = new URL(req.url ?? "", "ws://localhost");
      const token = url.searchParams.get("token") ?? "";
      const payload = this.authService.verifyToken(token);
      if (!payload) {
        client.close(4001, "Unauthorized");
        return;
      }
      this.userIds.set(client, payload.sub);
      this.isAlive.add(client);
      client.on("pong", () => this.isAlive.add(client));
    } catch {
      client.close(4001, "Unauthorized");
    }
  }

  /**
   * 连接断开：从所在房间移除（房间自动清理空组），
   * userIds/busy 由 WeakMap/WeakSet 自动 GC；进行中的 AI 流由 handleText 内 onClose 中断。
   */
  handleDisconnect(client: WebSocket) {
    const convId = this.clientRoom.get(client);
    if (convId !== undefined) {
      this.leaveRoom(convId, client);
      this.clientRoom.delete(client);
    }
    this.isAlive.delete(client);
  }

  // ── 房间 Room ─────────────────────────────────────

  private joinRoom(convId: number, client: WebSocket) {
    let room = this.rooms.get(convId);
    if (!room) {
      room = new Set();
      this.rooms.set(convId, room);
    }
    room.add(client);
    this.clientRoom.set(client, convId);
  }

  private leaveRoom(convId: number, client: WebSocket) {
    const room = this.rooms.get(convId);
    if (!room) return;
    room.delete(client);
    if (room.size === 0) this.rooms.delete(convId);
  }

  /**
   * 向房间广播（exclude 可排除指定连接，如消息发送者自己）。
   * 仅向 OPEN 状态连接发送，避免向已关闭连接写入报错。
   */
  private broadcastToRoom(convId: number, event: string, data: unknown, exclude?: WebSocket) {
    const room = this.rooms.get(convId);
    if (!room) return;
    const payload = JSON.stringify({ event, data });
    for (const c of room) {
      if (c !== exclude && c.readyState === WebSocket.OPEN) {
        c.send(payload);
      }
    }
  }

  // ── 事件 ──────────────────────────────────────────

  /**
   * 加入会话：校验会话归属（where { id, user_id }）后入房并返回 joined 事件。
   * 前端拿到 joined 后即可开始发 text 消息；重连成功后重新 join 即恢复。
   */
  @SubscribeMessage("join")
  async handleJoin(@ConnectedSocket() client: WebSocket, @MessageBody() body: { conversation_id: number }) {
    const userId = this.userIds.get(client);
    if (!userId) return { event: "error", data: { message: "Not authenticated" } };

    const conv = await this.convRepo.findOne({ where: { id: body?.conversation_id, user_id: userId } });
    if (!conv) return { event: "error", data: { message: "Conversation not found" } };

    this.joinRoom(body.conversation_id, client);
    return { event: "joined", data: { conversation_id: body.conversation_id } };
  }

  /** 应用层心跳：客户端定时 ping，服务端回 pong（供前端假死检测兜底） */
  @SubscribeMessage("ping")
  handlePing(@ConnectedSocket() client: WebSocket) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ event: "pong", data: { t: Date.now() } }));
    }
  }

  /**
   * Streaming 对话入口：收到用户文本 → 流式生成 AI 回复 → 逐块推送（房间广播，多端同步）。
   * 校验通过后委托 respond() 执行统一回复链路。
   */
  @SubscribeMessage("text")
  async handleText(@ConnectedSocket() client: WebSocket, @MessageBody() body: { conversation_id: number; content: string }) {
    const userId = this.userIds.get(client);
    if (!userId) return { event: "error", data: { message: "Not authenticated" } };

    const conversation_id = body?.conversation_id;
    const content = body?.content;
    if (!conversation_id || !content) {
      return { event: "error", data: { message: "Bad payload" } };
    }
    // 防止超长消息拖垮 LLM 上下文与数据库
    if (typeof content !== "string" || content.length > 2000) {
      return { event: "error", data: { message: "Message too long (max 2000 chars)" } };
    }
    // 并发保护：同一连接存在进行中的生成时，忽略新的 text 事件
    if (this.busy.has(client)) {
      return { event: "error", data: { message: "AI is still responding, please wait" } };
    }
    // 频率限制：单连接 30s 窗口最多 RATE_MAX 条，防单用户高频刷打爆上游
    if (!this.allowText(client)) {
      return { event: "error", data: { message: "发送太频繁，请稍候再试" } };
    }

    const conv = await this.convRepo.findOne({
      where: { id: conversation_id, user_id: userId },
      relations: ["scenario"],
    });
    if (!conv) return { event: "error", data: { message: "Conversation not found" } };

    await this.respond(client, conv, content);
  }

  /**
   * 统一回复链路（纯文本口语练习）：
   * 1. 用户消息落库 + 房间广播
   * 2. 并行查询历史（最近 30 条）+ 用户（AI 配置 + 长期画像）
   * 3. 知识库检索：错误类型启发式 → top-4 chunks；画像 → 摘要
   * 4. system prompt = 场景人设 + 角色 + 场景上下文 + 画像 + 纠错规则 + <knowledge>
   * 5. 流式生成 → ai_stream / ai_done；异常 → ai_error
   * 6. 异步更新用户画像（不阻塞回复）
   */
  private async respond(client: WebSocket, conv: Conversation, content: string) {
    const conversation_id = conv.id;
    const userId = conv.user_id;

    // 1) 落库 + 广播用户消息（发送端本地已乐观渲染，故 exclude）
    await this.convService.addMessage(conversation_id, "user", content);
    this.broadcastToRoom(conversation_id, "user_message", { content }, client);

    // 2) 历史 + 用户（settings / error_profile）并行查询
    const [history, u] = await Promise.all([
      this.msgRepo.find({ where: { conversation_id }, order: { created_at: "DESC" }, take: 30 }),
      this.userRepo.findOneBy({ id: userId }),
    ]);
    history.reverse();
    const settings = u?.settings ?? undefined;
    const profile = u?.error_profile ?? null;

    // 3) 项目 Skill + 知识库检索 + 画像摘要：
    //    - 按 conversation.scenario.skill_key 取项目 Skill（skills/<key>/skill.json）：
    //      人设 persona / 行为指令 instructions / 话题 system_prompt 以技能为准，DB 列为 seed 同步副本（fallback）
    //    - 检索 = 技能专属知识（加权优先） + 全局知识库
    const skillKey = conv.scenario?.skill_key ?? null;
    const skill = skillKey ? this.skillService.getSkill(skillKey) : undefined;
    const sceneSystemPrompt = skill?.system_prompt ?? conv.scenario?.system_prompt ?? null;
    const scenePersona = skill?.persona ?? conv.scenario?.persona ?? null;

    const hints = this.kbService.detectErrorHints(content);
    const kbChunks = this.kbService.retrieve(content, hints, 4, "", this.skillService.getChunks(skillKey ?? ""));
    const profileSummary = this.kbService.buildLearnerProfileSummary(profile);
    // 技能存在 → 按技能组装（人设+指令+话题+画像+知识）；否则回落通用 tutor prompt（默认人设）
    const systemPrompt = skill
      ? this.skillService.buildSystemPrompt(skill, kbChunks, profileSummary)
      : this.kbService.buildTutorSystemPrompt(sceneSystemPrompt, kbChunks, profileSummary, scenePersona);

    // 4) 组装 LLM 消息（纯文本）
    const messages: { role: string; content: string }[] = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      })),
      { role: "user", content },
    ];

    // 5) 客户端断开时中断生成（AbortController 节省 token）
    const ac = new AbortController();
    const onClose = () => ac.abort();
    client.on("close", onClose);

    let fullText = "";
    this.busy.add(client);
    try {
      for await (const delta of this.aiService.chatStream(messages, settings, ac.signal)) {
        fullText += delta;
        // 客户端可能已断开：发送前检测，避免向已关闭连接写入
        if (client.readyState !== WebSocket.OPEN) return;
        this.broadcastToRoom(conversation_id, "ai_stream", { delta });
      }

      if (!fullText) fullText = "Sorry, I didn't get that.";

      // 流结束：完整文本落库
      await this.convService.addMessage(conversation_id, "assistant", fullText);
      this.broadcastToRoom(conversation_id, "ai_done", { text: fullText });
    } catch (err) {
      if (ac.signal.aborted) {
        // 客户端主动断开，不落库、不报错
        return;
      }
      // 全局 LLM 并发已满（信号量未拿到许可）：明确提示"繁忙"，不当作 LLM 失败
      if (err instanceof LlmBusyError) {
        if (client.readyState === WebSocket.OPEN) {
          this.broadcastToRoom(conversation_id, "ai_error", { message: "当前使用人数较多，请稍后再试" });
        }
        return;
      }
      console.error("[gateway] stream error:", (err as Error).message);
      if (client.readyState === WebSocket.OPEN) {
        // 透出具体原因（截断 150 字符，避免长错误刷屏/泄露敏感信息）
        const detail = (err as Error).message.slice(0, 150);
        this.broadcastToRoom(conversation_id, "ai_error", { message: `AI 回复失败：${detail || "未知错误"}` });
      }
    } finally {
      this.busy.delete(client);
      client.off("close", onClose);
    }

    // 6) 异步更新学习者画像（不阻塞回复；失败仅告警）
    this.updateProfile(userId, hints, conv.scenario?.name).catch(() => {});
  }

  /** 把本轮错误提示累计进用户长期画像（error_profile），并记录近期场景话题 */
  private async updateProfile(userId: number, hints: string[], topicName?: string) {
    try {
      const u = await this.userRepo.findOneBy({ id: userId });
      if (!u) return;
      const next = KnowledgeService.mergeErrorHints(u.error_profile, hints);
      if (topicName) {
        next.last_seen_topics = [...(next.last_seen_topics ?? []), topicName].slice(-5);
      }
      await this.userRepo.update(userId, { error_profile: next });
    } catch (e) {
      console.warn("[gateway] profile update failed:", (e as Error).message);
    }
  }
}
