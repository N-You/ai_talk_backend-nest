import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { UserModule } from "./user/user.module";
import { ScenarioModule } from "./scenario/scenario.module";
import { ConversationModule } from "./conversation/conversation.module";
import { LearningModule } from "./learning/learning.module";
import { SpeechModule } from "./speech/speech.module";

// ConfigModule 全局注册（含 .env 加载与配置工厂）见 DatabaseModule
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    UserModule,
    ScenarioModule,
    ConversationModule,
    LearningModule,
    SpeechModule,
  ],
})
export class AppModule {}
