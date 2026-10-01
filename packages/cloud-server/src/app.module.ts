import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

/**
 * cloud-server 根模块（Phase 3 Stage B-5 骨架）。
 *
 * 对外 HTTP API 的宿主。后续子步将迁入 parse / download(创建读取) / analysis(触发查询) /
 * chat-RAG / knowledge / prompt / settings / auth / 作业生产 等云端模块。
 * **不** provide WorkerService（队列消费是 nas-worker 的职责）。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["packages/cloud-server/.env", ".env"],
    }),
  ],
})
export class AppModule {}
