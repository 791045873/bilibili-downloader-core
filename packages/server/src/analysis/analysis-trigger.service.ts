import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import isNil from "lodash/isNil.js";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import { type LlmConfig } from "@bilibili-downloader/adapters/llm";
import { AnalysisEngine, type AnalysisInput } from "./analysis-engine.js";
import {
  DatabaseService,
  type TaskRecord,
} from "../database/database.service.js";
import { DownloadScheduler } from "../download/download-scheduler.js";
import { DownloadService } from "../download/download.service.js";
import { NotificationService } from "../notification/notification.service.js";
import { createLogMessage } from "../logging/server-log.util.js";

@Injectable()
export class AnalysisTriggerService implements OnModuleInit {
  private readonly logger = new Logger(AnalysisTriggerService.name);
  private readonly llmVideoDir: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly downloadScheduler: DownloadScheduler,
    private readonly downloadService: DownloadService,
    private readonly notificationService: NotificationService,
  ) {
    this.llmVideoDir = process.env.ANALYSIS_LLM_VIDEO_DIR
      ? resolve(process.env.ANALYSIS_LLM_VIDEO_DIR)
      : join(
          resolve(process.env.OUTPUT_DIR ?? join(process.cwd(), "downloads")),
          ".analysis-llm",
        );
  }

  onModuleInit(): void {
    this.downloadScheduler.onAnalysisTrigger = (taskId: number) => {
      this.trigger(taskId).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          createLogMessage("Automatic analysis trigger failed", {
            taskId,
            error: message,
          }),
          err instanceof Error ? err.stack : undefined,
        );
      });
    };

    this.downloadScheduler.onLowResFinished = (
      taskId,
      analysisSubTaskId,
      result,
    ) => {
      if (result.success) {
        this.logger.log(
          createLogMessage("Low resolution analysis download finished", {
            taskId,
            analysisSubTaskId,
            outputFile: result.outputFile,
            quality: result.quality,
          }),
        );
        this.db.updateAnalysisSubTaskStatus(analysisSubTaskId, {
          status: "completed",
          outputFile: result.outputFile,
          completedAt: new Date().toISOString(),
        });
        const task = this.db.getTaskById(taskId);
        if (task) {
          this.db.updateTaskStatus(taskId, {
            status: task.status,
            summaryStatus: "pending",
          });
        }
        this.trigger(taskId).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            createLogMessage(
              "Analysis retrigger after low resolution download failed",
              {
                taskId,
                analysisSubTaskId,
                error: message,
              },
            ),
            err instanceof Error ? err.stack : undefined,
          );
        });
      } else {
        this.logger.error(
          createLogMessage("Low resolution analysis download failed", {
            taskId,
            analysisSubTaskId,
            error: result.error,
          }),
        );
        this.db.updateAnalysisSubTaskStatus(analysisSubTaskId, {
          status: "failed",
          errorMessage: result.error,
          completedAt: new Date().toISOString(),
        });
        const task = this.db.getTaskById(taskId);
        if (task) {
          this.db.updateTaskStatus(taskId, {
            status: task.status,
            summaryStatus: "failed",
            summaryOutput: result.error,
          });
        }
      }
    };
  }

  async trigger(taskId: number): Promise<void> {
    this.logger.log(
      createLogMessage("Analysis trigger started", {
        taskId,
      }),
    );

    const task = this.db.getTaskById(taskId);
    if (!task) {
      this.logger.warn(
        createLogMessage(
          "Analysis trigger skipped because task was not found",
          {
            taskId,
          },
        ),
      );
      return;
    }
    if (!task.autoSummary) {
      this.logger.log(
        createLogMessage(
          "Analysis trigger skipped because auto summary is disabled",
          {
            taskId,
            bvid: task.bvid,
            cid: task.cid,
            status: task.status,
          },
        ),
      );
      return;
    }
    if (task.status !== TaskStatus.Success) {
      this.logger.log(
        createLogMessage(
          "Analysis trigger skipped because download task is not successful",
          {
            taskId,
            bvid: task.bvid,
            cid: task.cid,
            status: task.status,
          },
        ),
      );
      return;
    }

    this.db.updateTaskStatus(taskId, {
      status: task.status,
      summaryStatus: "pending",
    });

    const lowResSubTask = this.db
      .getAnalysisSubTasksByTaskId(taskId)
      .find((s) => s.status !== "failed");

    if (lowResSubTask && lowResSubTask.status !== "completed") {
      this.logger.log(
        createLogMessage(
          "Analysis trigger waiting for low resolution sub task",
          {
            taskId,
            analysisSubTaskId: lowResSubTask.id,
            status: lowResSubTask.status,
          },
        ),
      );
      return;
    }

    const effectiveTask = this.resolveTaskForAnalysis(taskId, task);

    const a = isNil(effectiveTask.outputFile);
    const b = isNil(effectiveTask.bvid);
    if (a || b) {
      this.logger.error(
        createLogMessage(
          "Analysis trigger failed because required task fields are missing",
          {
            taskId,
            bvid: effectiveTask.bvid,
            cid: effectiveTask.cid,
            reason: "missing-analysis-fields",
          },
        ),
      );
      this.db.updateTaskStatus(taskId, {
        status: task.status,
        summaryStatus: "failed",
        summaryOutput: "任务缺少分析所需字段",
      });
      return;
    }

    const highResPath = effectiveTask.outputFile;
    const taskBvid = effectiveTask.bvid;
    const taskCid = effectiveTask.cid;
    let llmVideoPath = highResPath;
    const screenshotVideoPath = highResPath;

    const reuseDecision = await this.shouldReuseDownloadedVideo(effectiveTask);
    const reuseHighRes = reuseDecision.reuseHighRes;

    this.logger.log(
      createLogMessage("Analysis video source decision made", {
        taskId,
        bvid: taskBvid,
        cid: taskCid,
        reuseHighRes,
        downloadedQuality: reuseDecision.downloadedQuality,
        availableQualityCount: reuseDecision.availableQualityCount,
      }),
    );

    if (!reuseHighRes) {
      if (lowResSubTask?.status === "completed" && lowResSubTask.outputFile) {
        llmVideoPath = lowResSubTask.outputFile;
        this.logger.log(
          createLogMessage("Analysis reusing completed low resolution video", {
            taskId,
            analysisSubTaskId: lowResSubTask.id,
            bvid: taskBvid,
            cid: taskCid,
            outputFile: lowResSubTask.outputFile,
          }),
        );
      } else {
        await mkdir(this.llmVideoDir, { recursive: true });
        const subTaskId = this.db.insertAnalysisSubTask({
          taskId,
          bvid: taskBvid,
          cid: taskCid,
          quality: 0,
          status: "created",
          createdAt: new Date().toISOString(),
        });
        this.downloadScheduler.scheduleLowResDownload({
          taskId,
          analysisSubTaskId: subTaskId,
          bvid: taskBvid!,
          cid: taskCid!,
          title: task.title ?? `${taskBvid}-${taskCid}`,
        });
        this.logger.log(
          createLogMessage("Analysis scheduled low resolution video download", {
            taskId,
            analysisSubTaskId: subTaskId,
            bvid: taskBvid,
            cid: taskCid,
            outputPath: this.llmVideoDir,
          }),
        );
        return;
      }
    }

    const summaryDir = this.resolveSummaryDir(task);
    const metadataVideoUrl = `https://www.bilibili.com/video/${taskBvid}`;

    const input: AnalysisInput = {
      videoPath: llmVideoPath!,
      screenshotVideoPath,
      subtitlePath: undefined,
      summaryDir,
      videoTitle: task.title || `${taskBvid}-${taskCid}`,
      metadata: {
        type: "bilibili",
        videoUrl: metadataVideoUrl,
        bvid: taskBvid,
        cid: taskCid,
      },
    };

    const engine = new AnalysisEngine(this.getLlmConfig());

    try {
      const result = await engine.analyze(input);
      this.logger.log(
        createLogMessage("Analysis completed successfully", {
          taskId,
          bvid: taskBvid,
          cid: taskCid,
          summaryPath: result.summaryPath,
          segmentCount: result.segmentCount,
          emptySummary: result.emptySummary,
        }),
      );
      this.db.updateTaskStatus(taskId, {
        status: task.status,
        summaryStatus: "completed",
        summaryOutput: result.summaryPath,
      });
      await this.notificationService.sendSummaryNotification({
        title: input.videoTitle,
        success: true,
        videoUrl: input.metadata.videoUrl,
        markdownPath: result.summaryPath,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        createLogMessage("Analysis failed", {
          taskId,
          bvid: taskBvid,
          cid: taskCid,
          error: msg,
        }),
        err instanceof Error ? err.stack : undefined,
      );
      this.db.updateTaskStatus(taskId, {
        status: task.status,
        summaryStatus: "failed",
        summaryOutput: msg,
      });
      await this.notificationService.sendSummaryNotification({
        title: task.title || `${taskBvid}-${taskCid}`,
        success: false,
        videoUrl: metadataVideoUrl,
        errorMessage: msg,
      });
    } finally {
      if (llmVideoPath && llmVideoPath.startsWith(this.llmVideoDir)) {
        await rm(llmVideoPath, { force: true })
          .then(() => {
            this.logger.log(
              createLogMessage("Removed temporary analysis video", {
                taskId,
                bvid: taskBvid,
                cid: taskCid,
                videoPath: llmVideoPath,
                cleanup: "removed",
              }),
            );
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              createLogMessage("Failed to remove temporary analysis video", {
                taskId,
                bvid: taskBvid,
                cid: taskCid,
                videoPath: llmVideoPath,
                cleanup: "remove-failed",
                error: message,
              }),
            );
          });
      }
    }
  }

  private resolveTaskForAnalysis(taskId: number, task: TaskRecord): TaskRecord {
    const latestTask = this.db.getTaskById(taskId) ?? task;
    if (!isNil(latestTask.outputFile) && !isNil(latestTask.bvid)) {
      return latestTask;
    }

    if (!task.bvid || !task.cid) {
      return latestTask;
    }

    const completedTask =
      this.db.findCompletedTaskByBvidAndCid(task.bvid, task.cid) ?? latestTask;

    if (
      completedTask.id !== latestTask.id ||
      completedTask.outputFile !== latestTask.outputFile
    ) {
      this.logger.warn(
        createLogMessage(
          "Analysis trigger reloaded task fields from latest completed task",
          {
            taskId,
            bvid: completedTask.bvid,
            cid: completedTask.cid,
            outputFile: completedTask.outputFile,
            status: completedTask.status,
          },
        ),
      );
    }

    return completedTask;
  }

  private async shouldReuseDownloadedVideo(task: TaskRecord): Promise<{
    reuseHighRes: boolean;
    downloadedQuality?: number;
    availableQualityCount: number;
  }> {
    if (!task.bvid || !task.cid) {
      return { reuseHighRes: true, availableQualityCount: 0 };
    }
    const parsed = await this.downloadService.parseVideo(task.bvid, task.cid);
    const qualityIds = parsed.videoQualityList
      .map((q) => q.id)
      .sort((a, b) => a - b);
    if (qualityIds.length <= 1) {
      return {
        reuseHighRes: true,
        downloadedQuality: task.quality,
        availableQualityCount: qualityIds.length,
      };
    }

    const downloadedQuality = task.quality ?? qualityIds[qualityIds.length - 1];
    return {
      reuseHighRes: downloadedQuality <= qualityIds[0],
      downloadedQuality,
      availableQualityCount: qualityIds.length,
    };
  }

  private resolveSummaryDir(task: TaskRecord): string {
    const base = resolve(process.cwd(), "summaryDir");
    const safeTitle = (task.title ?? `${task.bvid}-${task.cid}`)
      .replace(/[<>:"/\\|?*]/g, "_")
      .slice(0, 120);
    return join(base, safeTitle || "analysis");
  }

  private getLlmConfig(): LlmConfig {
    const apiKey = process.env.QWEN_API_KEY;
    const baseUrl = process.env.QWEN_API_BASE;
    const modelName = process.env.QWEN_MODEL;
    const visionProxyUrl = process.env.QWEN_VISION_PROXY_URL;
    const visionModelName = process.env.QWEN_VISION_MODEL;

    if (!apiKey || !baseUrl || !modelName) {
      throw new Error("缺少 LLM 配置：QWEN_API_KEY/QWEN_API_BASE/QWEN_MODEL");
    }

    return {
      apiKey,
      baseUrl,
      modelName,
      visionProxyUrl,
      visionModelName,
    };
  }
}
