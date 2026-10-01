import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_INTERCEPTOR } from "@nestjs/core";
import {
  DatabaseModule,
  PrismaModule,
  RequestLoggingInterceptor,
} from "@bilibili-downloader/server-common";
import { DownloadModule } from "./download/download.module.js";
import { AnalysisModule } from "./analysis/analysis.module.js";
import { KnowledgeModule } from "./knowledge/knowledge.module.js";
import { ParseModule } from "./parse/parse.module.js";
import { ChatModule } from "./chat/chat.module.js";
import { WorkerModule } from "./worker/worker.module.js";
import { UserAuthModule } from "./user-auth/user-auth.module.js";

/**
 * cloud-server 根模块：对外 HTTP API 宿主。
 *
 * 物理隔离：无 PathsModule（媒体路径仅 nas）、无 NotificationModule（SMTP 出站归 nas）、
 * WorkerModule 仅 controller（不 provide WorkerService）。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["packages/cloud-server/.env", ".env"],
    }),
    DatabaseModule,
    PrismaModule,
    DownloadModule,
    AnalysisModule,
    KnowledgeModule,
    ParseModule,
    ChatModule,
    WorkerModule,
    UserAuthModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor,
    },
  ],
})
export class AppModule {}
