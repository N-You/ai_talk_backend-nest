import { Module, Global } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import config from "../config/config";

/**
 * 全局数据库模块：
 * - ConfigModule 加载 .env 并注册配置工厂（isGlobal，全应用可用）
 * - TypeORM 连接 PostgreSQL；autoLoadEntities 让各业务模块的实体随 forFeature 自动注册
 * - synchronize 仅开发/测试开启（生产必须用 migration，避免改表风险）
 */
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
        // 仅开发/测试环境自动同步表结构；生产必须用 migration 管理
        synchronize: process.env.NODE_ENV !== "production",
      }),
    }),
  ],
})
export class DatabaseModule {}
