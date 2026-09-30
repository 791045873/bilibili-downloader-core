import { Global, Module } from "@nestjs/common";
import { WorkerService } from "@bilibili-downloader/server-common";
import { WorkerController } from "./worker.controller.js";

@Global()
@Module({
  controllers: [WorkerController],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}
