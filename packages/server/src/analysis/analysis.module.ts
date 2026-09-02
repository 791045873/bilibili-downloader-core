import { Module } from "@nestjs/common";
import { DownloadModule } from "../download/download.module.js";
import { AnalysisController } from "./analysis.controller.js";
import { AnalysisTaskController } from "./analysis-task.controller.js";
import { AnalysisTriggerService } from "./analysis-trigger.service.js";
import { AnalysisVideoResolver } from "./analysis-video-resolver.js";
import { PromptController } from "./prompt.controller.js";
import { PromptService } from "./prompt.service.js";
import { CosStoreService } from "../knowledge/cos-store.service.js";
import { KnowledgePublisherService } from "../knowledge/knowledge-publisher.service.js";
import { KnowledgeBackfillService } from "../knowledge/knowledge-backfill.service.js";
import { KnowledgeBackfillController } from "../knowledge/knowledge-backfill.controller.js";

@Module({
  imports: [DownloadModule],
  controllers: [
    AnalysisController,
    AnalysisTaskController,
    PromptController,
    KnowledgeBackfillController,
  ],
  providers: [
    AnalysisVideoResolver,
    AnalysisTriggerService,
    PromptService,
    CosStoreService,
    KnowledgePublisherService,
    KnowledgeBackfillService,
  ],
  exports: [
    AnalysisTriggerService,
    PromptService,
    CosStoreService,
    KnowledgePublisherService,
  ],
})
export class AnalysisModule {}
