import { Module } from "@nestjs/common";
import { DownloadModule } from "../download/download.module.js";
import { AnalysisController } from "./analysis.controller.js";
import { DefaultScreenshotSourceResolver } from "./screenshot-source-resolver.js";

@Module({
  imports: [DownloadModule],
  controllers: [AnalysisController],
  providers: [DefaultScreenshotSourceResolver],
})
export class AnalysisModule {}
