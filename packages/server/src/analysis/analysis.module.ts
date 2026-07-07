import { Module } from "@nestjs/common";
import { AnalysisController } from "./analysis.controller.js";

@Module({
  controllers: [AnalysisController],
})
export class AnalysisModule {}
