import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { ConfigService } from "@nestjs/config";
import { WsAdapter } from "@nestjs/platform-ws";

/**
 * 应用入口 bootstrap：
 * 1. 创建 Nest 应用
 * 2. CORS：origin 反射请求源（配合 Bearer token，无需 cookie）
 * 3. 全局 ValidationPipe：DTO 参数校验 + 类型转换（transform）
 * 4. 原生 ws 适配器（协议级 ping/pong 心跳 + 应用层房间广播，见 ConversationGateway）
 * 5. 启动前校验关键密钥，缺失打印警告（不阻断启动，便于本地开发）
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS：origin 反射请求源（浏览器规范不允许 "*" 与 credentials 同用）
  app.enableCors({ origin: true, credentials: true });

  // 全局参数校验与转换（DTO 使用 class-validator；未定义 DTO 的接口不受影响）
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false }));

  // 原生 WebSocket（协议级心跳 + 应用层房间广播，见 ConversationGateway）
  app.useWebSocketAdapter(new WsAdapter(app));

  const config = app.get(ConfigService);
  const port = config.get("port") ?? 8002;

  // 启动时校验关键配置，缺 key 立即告警（不阻断启动，方便开发）
  if (!config.get("speech.dashscopeApiKey")) {
    console.warn("⚠️  DASHSCOPE_API_KEY 未配置：语音识别/朗读功能将不可用（聊天不受影响）。");
  }
  if (!config.get("ai.apiKey")) {
    console.warn("⚠️  OPENAI_API_KEY 未配置：AI 对话将使用内置 fallback 回复。");
  }

  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}`);
}
bootstrap();
