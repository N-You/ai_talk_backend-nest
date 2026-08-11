import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ConfigService } from "@nestjs/config";
import { WsAdapter } from "@nestjs/platform-ws";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS
  app.enableCors({ origin: "*", credentials: true });

  // 原生 WebSocket（兼容小程序）
  app.useWebSocketAdapter(new WsAdapter(app));

  // 全局前缀
  app.setGlobalPrefix("", { exclude: [] });

  const config = app.get(ConfigService);
  const port = config.get("port") ?? 8000;

  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}`);
}
bootstrap();
