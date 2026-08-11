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
 * 原生 WebSocket 网关（兼容 H5 / 微信小程序 / App）
 * 协议：客户端发送 {"event":"...","data":{...}}，服务端回 {"event":"...","data":{...}}
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

    // 保存用户消息
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

    // 读取用户自定义 AI 配置，调用模型
    const u = await this.userRepo.findOneBy({ id: conv.user_id });
    const aiResponse = await this.aiService.chat(messages, u?.settings ?? undefined);

    // 保存 AI 消息
    await this.convService.addMessage(conversation_id, "assistant", aiResponse);

    return { event: "ai_response", data: { text: aiResponse } };
  }
}
