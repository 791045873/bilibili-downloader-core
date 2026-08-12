import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
    if (!task.bvid || typeof task.cid !== "number") {
      throw new ConflictException("任务缺少 AI 总结所需的视频资源标识");
    }

    const summaryTask = this.databaseService.getAiSummaryTaskByResource(
      task.bvid,
      task.cid,
    );
    if (
      summaryTask &&
      (summaryTask.status === "pending" || summaryTask.status === "analyzing")
    ) {
      throw new ConflictException("当前资源的 AI 总结正在进行中，请勿重复触发");
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

  @Get("/summary-tasks/:id/raw-response")
  getAiSummaryTaskRawResponse(@Param("id") id: string) {
    const summaryTaskId = Number.parseInt(id, 10);
    if (Number.isNaN(summaryTaskId)) {
      this.logger.warn(
        `Get ai summary task raw response rejected due to invalid id: ${id}`,
      );
      throw new BadRequestException("无效的任务 ID");
    }

    const record = this.databaseService.getAiSummaryTaskById(summaryTaskId);
    if (!record) {
      this.logger.warn(
        `Get ai summary task raw response rejected due to not-found: ${summaryTaskId}`,
      );
      throw new NotFoundException("AI 总结任务不存在");
    }

    return { rawResponse: record.rawResponse ?? null };
  }

  @Delete("/summary-tasks/:id")
  deleteAiSummaryTask(@Param("id") id: string) {
    const summaryTaskId = Number.parseInt(id, 10);
    if (Number.isNaN(summaryTaskId)) {
      this.logger.warn(`Delete ai summary task rejected due to invalid id: ${id}`);
      throw new BadRequestException("无效的任务 ID");
    }

    const summaryTask = this.analysisTriggerService.getAiSummaryTaskById(summaryTaskId);
    if (!summaryTask) {
      this.logger.warn(
        `Delete ai summary task rejected due to not-found: ${summaryTaskId}`,
      );
      throw new NotFoundException("AI 总结任务不存在");
    }
    if (summaryTask.status === "pending" || summaryTask.status === "analyzing") {
      throw new ConflictException("进行中的 AI 总结不可删除");
    }

    this.analysisTriggerService.deleteAiSummaryTask(summaryTaskId);
    return { message: "已删除" };
  }

  @Post("/summary-tasks/:id/retrigger")
  @HttpCode(HttpStatus.OK)
  retriggerAiSummaryTask(@Param("id") id: string) {
    const summaryTaskId = Number.parseInt(id, 10);
    if (Number.isNaN(summaryTaskId)) {
      this.logger.warn(
        `Retrigger ai summary task rejected due to invalid id: ${id}`,
      );
      throw new BadRequestException("无效的任务 ID");
    }

    const summaryTask =
      this.analysisTriggerService.getAiSummaryTaskById(summaryTaskId);
    if (!summaryTask) {
      this.logger.warn(
        `Retrigger ai summary task rejected due to not-found: ${summaryTaskId}`,
      );
      throw new NotFoundException("AI 总结任务不存在");
    }
    if (
      summaryTask.status === "pending" ||
      summaryTask.status === "analyzing"
    ) {
      throw new ConflictException("进行中的 AI 总结不可重新触发");
    }

    // 下载任务记录可能已被删除（删除路径独立），按资源查找当前下载任务
    const task = this.databaseService.findLatestTaskByBvidAndCid(
      summaryTask.bvid,
      summaryTask.cid,
    );
    if (!task || typeof task.id !== "number") {
      this.logger.warn(
        `Retrigger ai summary task rejected because no download task exists for summary task ${summaryTaskId} (${summaryTask.bvid}-${summaryTask.cid})`,
      );
      throw new ConflictException("无对应的下载任务，无法重新总结");
    }
    if (task.status !== "success") {
      throw new ConflictException("仅已完成下载任务可触发 AI 总结");
    }

    this.databaseService.updateTaskStatus(task.id, {
      status: task.status,
      autoSummary: 1,
    });

    void this.analysisTriggerService.trigger(task.id).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `AI summary retrigger failed for summary task ${summaryTaskId}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
    });

    return { message: "AI 总结触发中" };
  }

  @Post("/summary-tasks/:id/rebuild")
  @HttpCode(HttpStatus.OK)
  rebuildAiSummaryTask(@Param("id") id: string) {
    const summaryTaskId = Number.parseInt(id, 10);
    if (Number.isNaN(summaryTaskId)) {
      this.logger.warn(
        `Rebuild ai summary task rejected due to invalid id: ${id}`,
      );
      throw new BadRequestException("无效的任务 ID");
    }

    // 校验需要 rawResponse，使用 databaseService 完整记录（service 视图已剥离 rawResponse）
    const record = this.databaseService.getAiSummaryTaskById(summaryTaskId);
    if (!record) {
      this.logger.warn(
        `Rebuild ai summary task rejected due to not-found: ${summaryTaskId}`,
      );
      throw new NotFoundException("AI 总结任务不存在");
    }
    if (record.status !== "completed") {
      throw new ConflictException("仅已完成的 AI 总结可使用存储内容重新构建");
    }
    if (!record.rawResponse) {
      throw new ConflictException("无可用的大模型返回内容，无法重新构建");
    }
    if (!this.analysisTriggerService.tryStartRebuild(summaryTaskId)) {
      throw new ConflictException("正在重新构建中");
    }

    void this.analysisTriggerService
      .runRebuild(summaryTaskId)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `AI summary rebuild failed for summary task ${summaryTaskId}: ${message}`,
          err instanceof Error ? err.stack : undefined,
        );
      });

    return { message: "重新构建已开始" };
  }
}