import { Module } from "@nestjs/common";
import { DownloadModule } from "../download/download.module.js";
import { AnalysisExecutorService } from "./analysis-executor.service.js";
import { AnalysisJobHandlers } from "./analysis-job-handlers.service.js";
import { AnalysisVideoResolver } from "./analysis-video-resolver.js";
import { SummaryIntegrityService } from "./summary-integrity.service.js";
import { ScreenshotRetryService } from "./screenshot-retry.service.js";
import { KnowledgePublisherService } from "../knowledge/knowledge-publisher.service.js";
import { CosStoreService } from "../knowledge/cos-store.service.js";
import { EmbeddingService } from "../knowledge/embedding.service.js";

/**
 * nas 分析模块：作业执行体 + handler 注册宿主。无对外 HTTP（无 controllers）。
 *
 * 物理隔离的执行侧：AnalysisEngine（经 executor new）/ FfmpegScreenshot / QwenClient /
 * PathsService / 媒体路径 join 均在此侧。
 */
@Module({
  imports: [DownloadModule],
  providers: [
    AnalysisVideoResolver,
    AnalysisExecutorService,
    AnalysisJobHandlers,
    SummaryIntegrityService,
    ScreenshotRetryService,
    KnowledgePublisherService,
    CosStoreService,
    EmbeddingService,
  ],
  exports: [AnalysisVideoResolver],
})
export class AnalysisModule {}
