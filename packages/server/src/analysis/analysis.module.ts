import { Module } from "@nestjs/common";
import { DownloadModule } from "../download/download.module.js";
import { AnalysisController } from "./analysis.controller.js";
import { AnalysisTaskController } from "./analysis-task.controller.js";
import { AnalysisTriggerService } from "./analysis-trigger.service.js";
import { ScreenshotRetryService } from "./screenshot-retry.service.js";
import { SummaryIntegrityService } from "./summary-integrity.service.js";
import { AnalysisVideoResolver } from "./analysis-video-resolver.js";
import { PromptController } from "./prompt.controller.js";
import { PromptService } from "./prompt.service.js";
import { CosStoreService } from "../knowledge/cos-store.service.js";
import { KnowledgePublisherService } from "../knowledge/knowledge-publisher.service.js";
import { EmbeddingService } from "../knowledge/embedding.service.js";
import { KnowledgeSearchController } from "../knowledge/knowledge-search.controller.js";

@Module({
  imports: [DownloadModule],
  controllers: [
    AnalysisController,
    AnalysisTaskController,
    PromptController,
    KnowledgeSearchController,
  ],
  providers: [
    AnalysisVideoResolver,
    AnalysisTriggerService,
    SummaryIntegrityService,
    ScreenshotRetryService,
    PromptService,
    CosStoreService,
    KnowledgePublisherService,
    EmbeddingService,
  ],
  exports: [
    AnalysisTriggerService,
    PromptService,
    CosStoreService,
    KnowledgePublisherService,
    EmbeddingService,
  ],
})
export class AnalysisModule {}
