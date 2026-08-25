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

@Module({
  imports: [DownloadModule],
  controllers: [AnalysisController, AnalysisTaskController, PromptController],
  providers: [
    AnalysisVideoResolver,
    AnalysisTriggerService,
    PromptService,
    CosStoreService,
    KnowledgePublisherService,
  ],
  exports: [
    AnalysisTriggerService,
    PromptService,
    CosStoreService,
    KnowledgePublisherService,
  ],
})
export class AnalysisModule {}
