import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

/**
 * nas-worker 根模块（Phase 3 Stage B-5 骨架）。
 *
 * 作业消费与执行宿主，**无对外 HTTP**。后续子步将迁入下载执行 / 分析引擎 / 截图 /
 * screenshot_retry / 完整性检查 / vision-proxy 客户端 / PathsService / WorkerService（消费端）
 * 等执行类模块，并注册 download/analyze/low_res_download/screenshot_retry/integrity_check handler。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["packages/nas-worker/.env", ".env"],
    }),
  ],
})
export class AppModule {}
