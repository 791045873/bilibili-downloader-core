import { Module } from "@nestjs/common";
import { DownloadModule } from "../download/download.module.js";
import { AnalysisController } from "./analysis.controller.js";
import { AnalysisTaskController } from "./analysis-task.controller.js";
import { PromptController } from "./prompt.controller.js";
import { PromptService } from "./prompt.service.js";
import { AiSummaryQueryService } from "./ai-summary-query.service.js";
import { AnalysisJobProducer } from "./analysis-job-producer.service.js";

/**
 * cloud 分析模块：触发（作业生产）+ 读查询 + 提示词 CRUD 的 HTTP 面。
 *
 * 物理隔离：**不含** AnalysisEngine / AnalysisVideoResolver / 截图 / 完整性检查执行体
 * （均在 nas-worker）。KnowledgeSearchController 移入独立 KnowledgeModule。
 */
@Module({
  imports: [DownloadModule],
  controllers: [AnalysisController, AnalysisTaskController, PromptController],
  providers: [AiSummaryQueryService, AnalysisJobProducer, PromptService],
  exports: [PromptService],
})
export class AnalysisModule {}
