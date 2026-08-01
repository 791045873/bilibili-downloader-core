import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import isNil from "lodash";
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
        this.logger.error(
          `自动触发分析失败: task=${taskId}, ${(err as Error).message}`,
        );
      });
    };

    this.downloadScheduler.onLowResFinished = (
      taskId,
      analysisSubTaskId,
      result,
    ) => {
      if (result.success) {
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
          this.logger.error(
            `低清下载完成后重新触发分析失败: task=${taskId}, ${(err as Error).message}`,
          );
        });
      } else {
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
    const task = this.db.getTaskById(taskId);
    if (!task) return;
    if (!task.autoSummary) return;
    if (task.status !== TaskStatus.Success) return;

    this.db.updateTaskStatus(taskId, {
      status: task.status,
      summaryStatus: "pending",
    });

    const lowResSubTask = this.db
      .getAnalysisSubTasksByTaskId(taskId)
      .find((s) => s.status !== "failed");

    if (lowResSubTask && lowResSubTask.status !== "completed") {
      return;
    }
    const a = isNil(task.outputFile);
    const b = isNil(task.bvid);
    if (a || b) {
      this.db.updateTaskStatus(taskId, {
        status: task.status,
        summaryStatus: "failed",
        summaryOutput: "任务缺少分析所需字段",
      });
      return;
    }

    const highResPath = task.outputFile;
    const taskBvid = task.bvid;
    const taskCid = task.cid;
    let llmVideoPath = highResPath;
    const screenshotVideoPath = highResPath;

    const reuseHighRes = await this.shouldReuseDownloadedVideo(task);

    if (!reuseHighRes) {
      if (lowResSubTask?.status === "completed" && lowResSubTask.outputFile) {
        llmVideoPath = lowResSubTask.outputFile;
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
        await rm(llmVideoPath, { force: true }).catch(() => undefined);
      }
    }
  }

  private async shouldReuseDownloadedVideo(task: TaskRecord): Promise<boolean> {
    if (!task.bvid || !task.cid) return true;
    const parsed = await this.downloadService.parseVideo(task.bvid, task.cid);
    const qualityIds = parsed.videoQualityList
      .map((q) => q.id)
      .sort((a, b) => a - b);
    if (qualityIds.length <= 1) return true;

    const downloadedQuality = task.quality ?? qualityIds[qualityIds.length - 1];
    return downloadedQuality <= qualityIds[0];
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
