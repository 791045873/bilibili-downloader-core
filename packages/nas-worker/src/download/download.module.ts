import { Module } from "@nestjs/common";
import { DownloadExecutorService } from "./download-executor.service.js";
import { DownloadJobHandler } from "./download-job-handler.service.js";

/**
 * nas 下载执行模块：执行面 + download 作业消费宿主。无对外 HTTP（无 controllers）。
 */
@Module({
  providers: [DownloadExecutorService, DownloadJobHandler],
  exports: [DownloadExecutorService, DownloadJobHandler],
})
export class DownloadModule {}
