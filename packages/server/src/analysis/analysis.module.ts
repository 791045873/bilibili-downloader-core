import { Module } from "@nestjs/common";
import { DownloadModule } from "../download/download.module.js";
import { AnalysisController } from "./analysis.controller.js";
import { AnalysisTaskController } from "./analysis-task.controller.js";
import { AnalysisTriggerService } from "./analysis-trigger.service.js";
import { DefaultScreenshotSourceResolver } from "./screenshot-source-resolver.js";

@Module({
  imports: [DownloadModule],
  controllers: [AnalysisController, AnalysisTaskController],
  providers: [DefaultScreenshotSourceResolver, AnalysisTriggerService],
  exports: [AnalysisTriggerService],
})
export class AnalysisModule {}
