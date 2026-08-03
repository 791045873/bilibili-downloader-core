import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { DownloadService } from "../download/download.service.js";
import { AnalysisTriggerService } from "./analysis-trigger.service.js";

@Controller("api")
export class AnalysisTaskController {
  private readonly logger = new Logger(AnalysisTaskController.name);

  constructor(
    private readonly analysisTriggerService: AnalysisTriggerService,
    private readonly databaseService: DatabaseService,
    private readonly downloadService: DownloadService,
  ) {}

  @Post("/tasks/:id/summary")
  async triggerTaskAiSummary(@Param("id") id: string) {
    const taskId = Number.parseInt(id, 10);
    if (Number.isNaN(taskId)) {
      throw new BadRequestException("无效的任务 ID");
    }

    const task = this.downloadService.getTaskById(taskId);
    if (!task) {
      throw new NotFoundException("任务不存在");
    }
    if (task.status !== "success") {
      throw new ConflictException("仅已完成下载任务可触发 AI 总结");
    }

    this.databaseService.updateTaskStatus(taskId, {
      status: task.status,
      autoSummary: 1,
    });

    void this.analysisTriggerService.trigger(taskId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Task-level AI summary trigger failed for task ${taskId}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
    });

    return { message: "AI 总结触发中" };
  }

  @Get("/summary-tasks")
  getAiSummaryTasks() {
    return this.analysisTriggerService.getAiSummaryTasks();
  }
}