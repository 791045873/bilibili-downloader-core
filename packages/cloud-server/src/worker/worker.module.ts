import { Module } from "@nestjs/common";
import { WorkerController } from "./worker.controller.js";

/**
 * cloud worker 模块：仅 worker_job 只读/取消 HTTP 面。
 * **不** provide WorkerService —— 队列消费（轮询 + handler）是 nas-worker 的职责；
 * cloud 若 provide 会抢 nas 作业并因无 handler 全判失败。
 */
@Module({
  controllers: [WorkerController],
})
export class WorkerModule {}
