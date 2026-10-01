import { Module } from "@nestjs/common";
import { DownloadController } from "./download.controller.js";
import { DownloadTaskService } from "./download-task.service.js";
import { DownloadScheduler } from "./download-scheduler.js";
import { VideoController } from "../video/video.controller.js";
import { AuthController } from "../auth/auth.controller.js";

@Module({
  controllers: [DownloadController, VideoController, AuthController],
  providers: [DownloadTaskService, DownloadScheduler],
  exports: [DownloadTaskService, DownloadScheduler],
})
export class DownloadModule {}
