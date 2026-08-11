import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { UserModule } from "./user/user.module";
import { ScenarioModule } from "./scenario/scenario.module";
import { ConversationModule } from "./conversation/conversation.module";
import { LearningModule } from "./learning/learning.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    UserModule,
    ScenarioModule,
    ConversationModule,
    LearningModule,
  ],
})
export class AppModule {}
