import { Module, Global } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import config from "../config/config";

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [config], envFilePath: ".env" }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: "postgres",
        host: cfg.get("database.host"),
        port: cfg.get("database.port"),
        username: cfg.get("database.username"),
        password: cfg.get("database.password"),
        database: cfg.get("database.database"),
        autoLoadEntities: true,
        synchronize: true, // 开发环境，生产用 migration
      }),
    }),
  ],
})
export class DatabaseModule {}
