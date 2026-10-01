import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  DatabaseService,
  WorkerService,
  JOB_KIND,
  analyzeContinuationDedupKey,
  createLogMessage,
  type WorkerJobRecord,
} from "@bilibili-downloader/server-common";
import { AnalysisExecutorService } from "./analysis-executor.service.js";
import { SummaryIntegrityService } from "./summary-integrity.service.js";
import { ScreenshotRetryService } from "./screenshot-retry.service.js";
import { DownloadExecutorService } from "../download/download-executor.service.js";
import { DownloadJobHandler } from "../download/download-job-handler.service.js";
import { NotificationService } from "../notification/notification.service.js";

/**
 * nas 侧分析类作业的 handler 宿主（analyze / low_res_download / screenshot_retry / integrity_check）。
 *
 * 构造器注册 handler（先于 WorkerService 轮询）；onModuleInit 做启动对账
 * （reconcileStaleAnalysisState 必须在 nas：只有 nas 推进这些状态）并接上
 * download 完成 → 自动 analyze 入队的 onAnalysisTrigger 钩子。
 */
@Injectable()
export class AnalysisJobHandlers implements OnModuleInit {
  private readonly logger = new Logger(AnalysisJobHandlers.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly worker: WorkerService,
    private readonly executor: AnalysisExecutorService,
    private readonly summaryIntegrity: SummaryIntegrityService,
    private readonly screenshotRetry: ScreenshotRetryService,
    private readonly downloadService: DownloadExecutorService,
    private readonly downloadJobHandler: DownloadJobHandler,
    private readonly notificationService: NotificationService,
  ) {
    this.worker.registerHandler(JOB_KIND.analyze, (job) =>
      this.handleAnalyzeJob(job),
    );
    this.worker.registerHandler(JOB_KIND.lowResDownload, (job) =>
      this.handleLowResDownloadJob(job),
    );
    this.worker.registerHandler(JOB_KIND.screenshotRetry, (job) =>
      this.handleScreenshotRetryJob(job),
    );
    this.worker.registerHandler(JOB_KIND.integrityCheck, (job) =>
      this.handleIntegrityCheckJob(job),
    );

    // download 完成 → 自动 analyze 入队（promptId 全链路解析在 executor）
    this.downloadJobHandler.onAnalysisTrigger = (taskId: number) => {
      this.executor.enqueueAnalyzeForTask(taskId).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          createLogMessage("Automatic analysis enqueue failed", {
            taskId,
            error: message,
          }),
          err instanceof Error ? err.stack : undefined,
        );
      });
    };
  }

  async onModuleInit(): Promise<void> {
    const reconciled = await this.db.reconcileStaleAnalysisState();
    if (reconciled.failedSubTasks > 0 || reconciled.failedSummaryTasks > 0) {
      this.logger.log(
        createLogMessage("Reconciled stale analysis state after restart", {
          failedSubTasks: reconciled.failedSubTasks,
          failedSummaryTasks: reconciled.failedSummaryTasks,
        }),
      );
    }
  }

  private async handleIntegrityCheckJob(_job: WorkerJobRecord): Promise<void> {
    await this.summaryIntegrity.run();
  }

  private async handleScreenshotRetryJob(job: WorkerJobRecord): Promise<void> {
    const payload = (job.payload ?? {}) as { summaryTaskId?: number };
    if (typeof payload.summaryTaskId !== "number") {
      throw new Error("screenshot_retry job payload missing summaryTaskId");
    }
    await this.screenshotRetry.run(payload.summaryTaskId);
  }

  private async handleAnalyzeJob(job: WorkerJobRecord): Promise<void> {
    const payload = (job.payload ?? {}) as {
      taskId?: number;
      promptId?: number;
      continuation?: boolean;
    };
    if (typeof payload.taskId !== "number") {
      throw new Error("analyze job payload missing taskId");
    }
    if (payload.continuation) {
      await this.executor.runAnalysis(payload.taskId, new Date().toISOString());
      return;
    }
    await this.executor.trigger(payload.taskId, { promptId: payload.promptId });
  }

  private async handleLowResDownloadJob(job: WorkerJobRecord): Promise<void> {
    const payload = (job.payload ?? {}) as {
      taskId?: number;
      analysisSubTaskId?: number;
      bvid?: string;
      cid?: number;
      title?: string;
      resourceType?: string;
    };
    if (
      typeof payload.taskId !== "number" ||
      typeof payload.analysisSubTaskId !== "number" ||
      !payload.bvid ||
      typeof payload.cid !== "number"
    ) {
      throw new Error("low_res_download job payload incomplete");
    }
    const { taskId, analysisSubTaskId, bvid, cid } = payload;
    const title = payload.title ?? `${bvid}-${cid}`;
    try {
      const result = await this.downloadService.executeLowResDownload(
        bvid,
        cid,
        title,
        payload.resourceType,
      );
      await this.db.updateAnalysisSubTaskStatus(analysisSubTaskId, {
        status: "completed",
        outputFile: result.outputFile,
        completedAt: new Date().toISOString(),
      });
      await this.db.enqueueJob({
        kind: JOB_KIND.analyze,
        queue: "nas",
        refType: "task",
        refId: taskId,
        dedupKey: analyzeContinuationDedupKey(bvid, cid),
        payload: { taskId, continuation: true },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        createLogMessage("Low resolution analysis download failed", {
          taskId,
          analysisSubTaskId,
          error: message,
        }),
        err instanceof Error ? err.stack : undefined,
      );
      await this.db.updateAnalysisSubTaskStatus(analysisSubTaskId, {
        status: "failed",
        errorMessage: message,
        completedAt: new Date().toISOString(),
      });
      const task = await this.db.getTaskById(taskId);
      if (task) {
        await this.executor.upsertAiSummaryTask(task, {
          status: "failed",
          summaryOutput: "",
          errorMessage: message,
          lastCompletedAt: new Date().toISOString(),
        });
        void this.notificationService.sendSummaryNotification({
          title:
            task.title ||
            (task.bvid && typeof task.cid === "number"
              ? `${task.bvid}-${task.cid}`
              : `任务 ${taskId}`),
          success: false,
          videoUrl: task.bvid
            ? `https://www.bilibili.com/video/${task.bvid}`
            : undefined,
          errorMessage: message,
        });
      }
    }
  }
}
