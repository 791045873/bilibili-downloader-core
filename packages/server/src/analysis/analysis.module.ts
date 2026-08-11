import { Module } from "@nestjs/common";
import { DownloadModule } from "../download/download.module.js";
import { AnalysisController } from "./analysis.controller.js";
import { AnalysisTaskController } from "./analysis-task.controller.js";
import { AnalysisTriggerService } from "./analysis-trigger.service.js";
import { AnalysisVideoResolver } from "./analysis-video-resolver.js";

@Module({
  imports: [DownloadModule],
  controllers: [AnalysisController, AnalysisTaskController],
  providers: [AnalysisVideoResolver, AnalysisTriggerService],
  exports: [AnalysisTriggerService],
})
export class AnalysisModule {}
