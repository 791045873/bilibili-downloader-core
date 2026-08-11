import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import isNil from "lodash/isNil.js";
import { readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import { type LlmConfig } from "@bilibili-downloader/adapters/llm";
import { AnalysisEngine, type AnalysisInput } from "./analysis-engine.js";
import { AnalysisVideoResolver } from "./analysis-video-resolver.js";
import {
  DatabaseService,
  type AiSummaryTaskRecord,
  type AnalysisSubTaskRecord,
  type TaskRecord,
} from "../database/database.service.js";
import { DownloadScheduler } from "../download/download-scheduler.js";
import { DownloadService } from "../download/download.service.js";
import { NotificationService } from "../notification/notification.service.js";
import { sanitizeFileName } from "../download/file-naming.js";
import { createLogMessage } from "../logging/server-log.util.js";

/** AI 总结任务执行耗时明细 */
export interface AiSummaryExecutionTiming {
  llmMs: number;
  screenshotMs: number;
  totalMs: number;
}

/** AI 总结任务对外视图：executionTiming 解析为对象 */
export interface AiSummaryTaskView
  extends Omit<AiSummaryTaskRecord, "executionTiming"> {
  executionTiming?: AiSummaryExecutionTiming;
}

@Injectable()
export class AnalysisTriggerService implements OnModuleInit {
  private readonly logger = new Logger(AnalysisTriggerService.name);
  private readonly llmVideoDir: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly downloadScheduler: DownloadScheduler,
    private readonly downloadService: DownloadService,
    private readonly notificationService: NotificationService,
    private readonly analysisVideoResolver: AnalysisVideoResolver,
  ) {
    this.llmVideoDir = process.env.ANALYSIS_LLM_VIDEO_DIR
      ? resolve(process.env.ANALYSIS_LLM_VIDEO_DIR)
      : join(
          resolve(process.env.OUTPUT_DIR ?? join(process.cwd(), "downloads")),
          ".analysis-llm",
        );
  }

  onModuleInit(): void {
    // 启动对账：低清队列为内存态，重启后遗留子任务/卡死总结标 failed，避免永久等待
    const reconciled = this.db.reconcileStaleAnalysisState();
    if (reconciled.failedSubTasks > 0 || reconciled.failedSummaryTasks > 0) {
      this.logger.log(
        createLogMessage("Reconciled stale analysis state after restart", {
          failedSubTasks: reconciled.failedSubTasks,
          failedSummaryTasks: reconciled.failedSummaryTasks,
        }),
      );
    }

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
        // 低清已就绪，直接续跑分析（认领保持进行中，避免重走认领被拒）
        this.runAnalysis(taskId, new Date().toISOString()).catch(
          (err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(
              createLogMessage(
                "Analysis continuation after low resolution download failed",
                {
                  taskId,
                  analysisSubTaskId,
                  error: message,
                },
              ),
              err instanceof Error ? err.stack : undefined,
            );
          },
        );
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
          this.upsertAiSummaryTask(task, {
            status: "failed",
            summaryOutput: "",
            errorMessage: result.error,
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
            errorMessage: result.error,
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
    if (!task.bvid || typeof task.cid !== "number") {
      this.logger.warn(
        createLogMessage(
          "Analysis trigger skipped because task lacks video resource identity",
          {
            taskId,
            bvid: task.bvid,
            cid: task.cid,
          },
        ),
      );
      return;
    }

    // 原子认领：pending/analyzing 进行中直接拒绝，防并发双跑
    const claim = this.db.claimAiSummaryTask({
      bvid: task.bvid,
      cid: task.cid,
      title: task.title,
      sourceTaskId: task.id,
    });
    if (!claim.claimed) {
      this.logger.log(
        createLogMessage(
          "Analysis trigger skipped because summary already in progress",
          {
            taskId,
            bvid: task.bvid,
            cid: task.cid,
            summaryStatus: claim.record?.status,
          },
        ),
      );
      return;
    }

    // 认领已完成，ai_summary_task 已置 pending（唯一权威），无需再写 task 镜像

    // 低清未就绪则等待（认领保持进行中，续跑由 onLowResFinished 驱动 runAnalysis）
    const lowResSubTask = this.db
      .getAnalysisSubTasks(task.bvid, task.cid)
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

    await this.runAnalysis(taskId, new Date().toISOString());
  }

  private async runAnalysis(taskId: number, now: string): Promise<void> {
    const task = this.db.getTaskById(taskId);
    if (!task) {
      return;
    }

    const taskBvid = task.bvid ?? "";
    const taskCid = task.cid;
    const lowResSubTask =
      task.bvid && typeof task.cid === "number"
        ? (this.db
            .getAnalysisSubTasks(task.bvid, task.cid)
            .find((s) => s.status !== "failed") as
            | AnalysisSubTaskRecord
            | undefined)
        : undefined;
    let llmVideoPath: string | undefined;
    let isTempVideo = false;

    try {
      this.upsertAiSummaryTask(task, {
        status: "analyzing",
        summaryOutput: "",
        errorMessage: "",
        lastTriggeredAt: now,
      });

      const effectiveTask = await this.resolveTaskForAnalysis(taskId, task);
      if (isNil(effectiveTask.bvid) || isNil(effectiveTask.cid)) {
        throw new Error("任务缺少分析所需字段");
      }
      const effectiveBvid = effectiveTask.bvid;
      const effectiveCid = effectiveTask.cid;
      const highResPath = effectiveTask.outputFile;

      // LLM 分析视频决策统一走资产层：低清子任务文件 → 高清任务文件，缺失时调度重下
      const video = await this.analysisVideoResolver.resolveAnalysisVideo({
        taskId,
        bvid: effectiveBvid,
        cid: effectiveCid,
        title: task.title,
        preferredLowResPath:
          lowResSubTask?.status === "completed"
            ? lowResSubTask.outputFile
            : undefined,
        highResPath,
        llmVideoDir: this.llmVideoDir,
      });

      if (video.status === "downloading") {
        return;
      }
      llmVideoPath = video.path;
      isTempVideo = video.isTemp;
      this.logger.log(
        createLogMessage("Analysis video source resolved", {
          taskId,
          bvid: effectiveBvid,
          cid: effectiveCid,
          videoPath: llmVideoPath,
          sourceIsTemp: isTempVideo,
        }),
      );

      const screenshotVideoPath =
        highResPath && (await this.downloadService.fileExists(highResPath))
          ? highResPath
          : undefined;

      const summaryDir = this.resolveSummaryDir(task);
      const metadataVideoUrl = `https://www.bilibili.com/video/${effectiveBvid}`;

      const input: AnalysisInput = {
        videoPath: llmVideoPath,
        screenshotVideoPath,
        subtitlePath: undefined,
        summaryDir,
        videoTitle: task.title || `${effectiveBvid}-${effectiveCid}`,
        metadata: {
          type: "bilibili",
          videoUrl: metadataVideoUrl,
          bvid: effectiveBvid,
          cid: effectiveCid,
        },
      };

      const engine = new AnalysisEngine(
        this.getLlmConfig(),
        undefined,
        this.analysisVideoResolver,
      );
      const result = await engine.analyze(input);

      this.logger.log(
        createLogMessage("Analysis completed successfully", {
          taskId,
          bvid: effectiveBvid,
          cid: effectiveCid,
          summaryPath: result.summaryPath,
          segmentCount: result.segmentCount,
          emptySummary: result.emptySummary,
        }),
      );
      this.upsertAiSummaryTask(task, {
        status: "completed",
        summaryOutput: result.summaryPath,
        errorMessage: "",
        executionTiming: JSON.stringify(result.timing),
        lastTriggeredAt: now,
        lastCompletedAt: new Date().toISOString(),
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
      this.upsertAiSummaryTask(task, {
        status: "failed",
        summaryOutput: "",
        errorMessage: msg,
        lastTriggeredAt: now,
        lastCompletedAt: new Date().toISOString(),
      });
      await this.notificationService.sendSummaryNotification({
        title: task.title || `${taskBvid}-${taskCid}`,
        success: false,
        videoUrl: `https://www.bilibili.com/video/${taskBvid}`,
        errorMessage: msg,
      });
    } finally {
      if (llmVideoPath && isTempVideo && llmVideoPath.startsWith(this.llmVideoDir)) {
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

  private async resolveTaskForAnalysis(
    taskId: number,
    task: TaskRecord,
  ): Promise<TaskRecord> {
    const latestTask = this.db.getTaskById(taskId) ?? task;
    if (!isNil(latestTask.outputFile) && !isNil(latestTask.bvid)) {
      return latestTask;
    }

    if (!task.bvid || !task.cid) {
      return latestTask;
    }

    const completedTask =
      this.db.findCompletedTaskByBvidAndCid(task.bvid, task.cid) ?? latestTask;

    // 磁盘校验：重载文件已不存在时回退当前任务，交由下游低清恢复
    if (
      completedTask.outputFile &&
      !(await this.downloadService.fileExists(completedTask.outputFile))
    ) {
      this.logger.warn(
        createLogMessage(
          "Reloaded analysis task output file is missing on disk, falling back to current task",
          {
            taskId,
            bvid: completedTask.bvid,
            cid: completedTask.cid,
            outputFile: completedTask.outputFile,
          },
        ),
      );
      return latestTask;
    }

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

  private resolveSummaryDir(task: TaskRecord): string {
    const base = resolve(process.cwd(), "summaryDir");
    const bvid = task.bvid;
    const cid = task.cid;
    if (!bvid || typeof cid !== "number") {
      return join(base, "analysis");
    }

    // 命名：{标题}-{bvid}-{cid}（标题完整不截断，非法字符清洗）
    const titleBase = (task.title ?? "").trim();
    const titlePart = titleBase ? sanitizeFileName(titleBase) : "";
    const candidateName = titlePart
      ? `${titlePart}-${bvid}-${cid}`
      : `${bvid}-${cid}`;
    const suffix = `-${bvid}-${cid}`;

    // 同资源已存在 summary 目录则复用（标题变化不产生孤儿目录），优先精确匹配候选名
    let existingDir: string | undefined;
    try {
      existingDir = readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort((a, b) => {
          const aExact = a === candidateName ? -1 : 0;
          const bExact = b === candidateName ? -1 : 0;
          return aExact - bExact || a.localeCompare(b);
        })
        .find(
          (n) =>
            n === candidateName ||
            n.endsWith(suffix) ||
            n === `${bvid}-${cid}`,
        );
    } catch {
      // summaryDir 尚不存在，忽略
    }

    if (existingDir && existingDir !== candidateName) {
      this.logger.log(
        createLogMessage(
          "Analysis reusing existing summary directory for resource",
          {
            bvid,
            cid,
            existingDir,
            candidateName,
          },
        ),
      );
    }
    return join(base, existingDir ?? candidateName);
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

  getAiSummaryTasks(): AiSummaryTaskView[] {
    return this.db.listAiSummaryTasks().map((r) => ({
      ...r,
      executionTiming: this.parseExecutionTiming(r.executionTiming),
    }));
  }

  getAiSummaryTaskById(id: number): AiSummaryTaskView | undefined {
    const record = this.db.getAiSummaryTaskById(id);
    if (!record) {
      return undefined;
    }
    return {
      ...record,
      executionTiming: this.parseExecutionTiming(record.executionTiming),
    };
  }

  deleteAiSummaryTask(id: number): boolean {
    return this.db.deleteAiSummaryTask(id);
  }

  private parseExecutionTiming(raw?: string): AiSummaryExecutionTiming | undefined {
    if (!raw) {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return undefined;
      }
      const p = parsed as { llmMs?: unknown; screenshotMs?: unknown; totalMs?: unknown };
      if (
        typeof p.llmMs !== "number" ||
        typeof p.screenshotMs !== "number" ||
        typeof p.totalMs !== "number"
      ) {
        return undefined;
      }
      return { llmMs: p.llmMs, screenshotMs: p.screenshotMs, totalMs: p.totalMs };
    } catch {
      return undefined;
    }
  }

  private upsertAiSummaryTask(
    task: TaskRecord,
    fields: {
      status: string;
      summaryOutput?: string;
      errorMessage?: string;
      executionTiming?: string;
      lastTriggeredAt?: string;
      lastCompletedAt?: string;
    },
  ): void {
    if (!task.bvid || typeof task.cid !== "number") {
      return;
    }

    this.db.upsertAiSummaryTask({
      bvid: task.bvid,
      cid: task.cid,
      title: task.title,
      sourceTaskId: task.id,
      status: fields.status,
      summaryOutput: fields.summaryOutput,
      errorMessage: fields.errorMessage,
      executionTiming: fields.executionTiming,
      lastTriggeredAt: fields.lastTriggeredAt,
      lastCompletedAt: fields.lastCompletedAt,
    });
  }
}
