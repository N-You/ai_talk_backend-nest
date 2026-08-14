import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
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
import { AiService } from "./ai.service";

/**
 * 原生 WebSocket 网关（H5 优先，协议与 uni.connectSocket 兼容）
 * 协议：客户端发送 {"event":"...","data":{...}}，服务端回 {"event":"...","data":{...}}
 *
 * Streaming 事件协议：
 * - ai_stream: data { delta }      生成中的增量文本（多次）
 * - ai_done:   data { text }       完整文本（结束，前端用于固化消息）
 * - ai_error:  data { message }    生成失败
 */
@WebSocketGateway({ path: "/ws/conversations" })
export class ConversationGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: WsServer;

  private userIds = new WeakMap<WebSocket, number>();
  /** 每个连接当前是否已有正在生成的流，防止并发重复触发 */
  private busy = new WeakSet<WebSocket>();

  constructor(
    private readonly convService: ConversationService,
    private readonly authService: AuthService,
    private readonly aiService: AiService,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Scenario) private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  /**
   * WS 握手认证：从 URL query 取 token 验签。
   * 通过则用 WeakMap 记录「连接 → userId」（连接断开自动 GC，无内存泄漏）；
   * 失败则 close(4001)。
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
    } catch {
      client.close(4001, "Unauthorized");
    }
  }

  /**
   * 加入会话：校验会话归属（where { id, user_id }）后返回 joined 事件。
   * 前端拿到 joined 后即可开始发 text 消息。
   */
  @SubscribeMessage("join")
  async handleJoin(@ConnectedSocket() client: WebSocket, @MessageBody() body: { conversation_id: number }) {
    const userId = this.userIds.get(client);
    if (!userId) return { event: "error", data: { message: "Not authenticated" } };

    const conv = await this.convRepo.findOne({ where: { id: body?.conversation_id, user_id: userId } });
    if (!conv) return { event: "error", data: { message: "Conversation not found" } };

    return { event: "joined", data: { conversation_id: body.conversation_id } };
  }

  /**
   * Streaming 对话入口：收到用户文本 → 流式生成 AI 回复 → 逐块推送。
   *
   * 完整流程：
   * 1. 认证/参数/长度(≤2000)/并发锁(busy) 四重校验
   * 2. 用户消息立即落库（防丢）
   * 3. 取最近 20 条历史（DESC 取最新 + reverse 还原时间序）拼进 LLM 上下文
   * 4. 读取 users.settings（用户自定义 AI 配置，优先于 .env）
   * 5. AbortController 监听客户端 close，断连即中断生成（省 token）
   * 6. for await chatStream 逐 delta 推送 ai_stream；结束用完整文本落库并回 ai_done
   * 7. 异常回 ai_error（透出具体原因，截断 150 字符）
   *
   * 注意：不能用 @SubscribeMessage 的 return（那是一次性响应），
   * 流式必须直接 client.send 逐块推送。
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

    const conv = await this.convRepo.findOne({
      where: { id: conversation_id, user_id: userId },
      relations: ["scenario"],
    });
    if (!conv) return { event: "error", data: { message: "Conversation not found" } };

    // 保存用户消息（立即落库）
    await this.convService.addMessage(conversation_id, "user", content);

    // 获取最近历史消息（取最新的 20 条，再按时间正序送进 LLM）
    const history = await this.msgRepo.find({
      where: { conversation_id },
      order: { created_at: "DESC" },
      take: 20,
    });
    history.reverse();

    // 构建 LLM 消息
    const systemPrompt = conv.scenario?.system_prompt
      ? `${conv.scenario.system_prompt}\n\nYou are an AI English Tutor. Keep responses concise and natural. Support Chinese-English mixed input.`
      : "You are an AI English Tutor. Keep responses concise and natural. Support Chinese-English mixed input.";

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      })),
    ];

    // 读取用户自定义 AI 配置
    const u = await this.userRepo.findOneBy({ id: conv.user_id });
    const settings = u?.settings ?? undefined;

    // 客户端断开时中断生成（AbortController 节省 token）
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
        client.send(JSON.stringify({ event: "ai_stream", data: { delta } }));
      }

      if (!fullText) fullText = "Sorry, I didn't get that.";

      // 流结束：完整文本落库
      await this.convService.addMessage(conversation_id, "assistant", fullText);
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ event: "ai_done", data: { text: fullText } }));
      }
    } catch (err) {
      if (ac.signal.aborted) {
        // 客户端主动断开，不落库、不报错
        return;
      }
      console.error("[gateway] stream error:", (err as Error).message);
      if (client.readyState === WebSocket.OPEN) {
        // 透出具体原因（截断 150 字符，避免长错误刷屏/泄露敏感信息）
        const detail = (err as Error).message.slice(0, 150);
        client.send(
          JSON.stringify({
            event: "ai_error",
            data: { message: `AI 回复失败：${detail || "未知错误"}` },
          }),
        );
      }
    } finally {
      this.busy.delete(client);
      client.off("close", onClose);
    }
  }
}
