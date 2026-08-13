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

  constructor(
    private readonly convService: ConversationService,
    private readonly authService: AuthService,
    private readonly aiService: AiService,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Scenario) private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

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

  @SubscribeMessage("join")
  async handleJoin(@ConnectedSocket() client: WebSocket, @MessageBody() body: { conversation_id: number }) {
    const userId = this.userIds.get(client);
    if (!userId) return { event: "error", data: { message: "Not authenticated" } };

    const conv = await this.convRepo.findOne({ where: { id: body?.conversation_id, user_id: userId } });
    if (!conv) return { event: "error", data: { message: "Conversation not found" } };

    return { event: "joined", data: { conversation_id: body.conversation_id } };
  }

  /**
   * Streaming 对话入口。
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

    const conv = await this.convRepo.findOne({
      where: { id: conversation_id, user_id: userId },
      relations: ["scenario"],
    });
    if (!conv) return { event: "error", data: { message: "Conversation not found" } };

    // 保存用户消息（立即落库）
    await this.convService.addMessage(conversation_id, "user", content);

    // 获取最近历史消息
    const history = await this.msgRepo.find({
      where: { conversation_id },
      order: { created_at: "ASC" },
      take: 20,
    });

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
        client.send(
          JSON.stringify({ event: "ai_error", data: { message: "AI 回复失败，请重试" } }),
        );
      }
    } finally {
      client.off("close", onClose);
    }
  }
}
