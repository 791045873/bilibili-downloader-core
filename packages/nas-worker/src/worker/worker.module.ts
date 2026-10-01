import { Global, Module } from "@nestjs/common";
import { WorkerService } from "@bilibili-downloader/server-common";

/**
 * nas-worker 的队列消费宿主：provide WorkerService（轮询 + handler 执行）。
 * 与 cloud-server 的 WorkerModule（仅 controller，不 provide）互斥。
 */
@Global()
@Module({
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}
