import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import {
  DatabaseModule,
  PrismaModule,
} from "@bilibili-downloader/server-common";
import { PathsModule } from "./paths/paths.module.js";
import { NotificationModule } from "./notification/notification.module.js";
import { WorkerModule } from "./worker/worker.module.js";
import { DownloadModule } from "./download/download.module.js";
import { AnalysisModule } from "./analysis/analysis.module.js";

/**
 * nas-worker 根模块：作业消费与执行宿主，**无对外 HTTP**。
 *
 * provide WorkerService（消费端）+ 注册 download/analyze/low_res_download/
 * screenshot_retry/integrity_check handler；保留 PathsService / NotificationService
 * （SMTP 出站）。无 UserAuth / Chat / Parse / interceptor。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["packages/nas-worker/.env", ".env"],
    }),
    DatabaseModule,
    PrismaModule,
    PathsModule,
    NotificationModule,
    WorkerModule,
    DownloadModule,
    AnalysisModule,
  ],
})
export class AppModule {}
