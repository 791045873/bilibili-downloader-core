import { Injectable, Logger } from "@nestjs/common";
import isNil from "lodash/isNil.js";
import { rm } from "node:fs/promises";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import { AnalysisEngine, type AnalysisInput } from "./analysis-engine.js";
import { AnalysisVideoResolver } from "./analysis-video-resolver.js";
import {
  DatabaseService,
  type AnalysisSubTaskRecord,
  type TaskRecord,
  analyzeDedupKey,
  createLogMessage,
  resolveFromDownloadRoot,
} from "@bilibili-downloader/server-common";
import { DownloadExecutorService } from "../download/download-executor.service.js";
import { NotificationService } from "../notification/notification.service.js";
import { PathsService } from "../paths/paths.service.js";
import { KnowledgePublisherService } from "../knowledge/knowledge-publisher.service.js";
import { getLlmConfig } from "./llm-config.js";
import { resolveSummaryDir } from "./summary-dir-resolver.js";

/**
 * AI 总结执行器（nas 半）：claim → 解析视频资产 → AnalysisEngine → 内联发布 → 置终态 + 通知。
 *
 * `claimAiSummaryTask` 与执行同侧同窗口；提示词全链路解析（resolvePromptId / resolveCreatorMid）
 * 与自动入队（enqueueAnalyzeForTask）均在此 —— download 完成后的 onAnalysisTrigger 在 nas 触发，
 * 故这段作业生产逻辑随执行侧落在 nas（与底图「cloud 生产者」记述的偏差，详见交付报告）。
 */
@Injectable()
export class AnalysisExecutorService {
  private readonly logger = new Logger(AnalysisExecutorService.name);
  private readonly llmVideoDir: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly downloadService: DownloadExecutorService,
    private readonly notificationService: NotificationService,
    private readonly analysisVideoResolver: AnalysisVideoResolver,
    private readonly knowledgePublisher: KnowledgePublisherService,
    private readonly paths: PathsService,
  ) {
    this.llmVideoDir = paths.ANALYSIS_LLM_VIDEO_DIR;
  }

  /** 触发期解析 promptId 并入队 analyze 作业（download 完成后自动触发链路）。 */
  async enqueueAnalyzeForTask(taskId: number): Promise<void> {
    const task = await this.db.getTaskById(taskId);
    if (
      !task ||
      !task.autoSummary ||
      task.status !== TaskStatus.Success ||
      !task.bvid ||
      typeof task.cid !== "number"
    ) {
      return;
    }
    const promptId = await this.resolvePromptId(task);
    await this.db.enqueueJob({
      kind: "analyze",
      queue: "nas",
      refType: "task",
      refId: taskId,
      dedupKey: analyzeDedupKey(task.bvid, task.cid),
      payload: { taskId, promptId },
    });
  }

  async trigger(taskId: number, options?: { promptId?: number }): Promise<void> {
    this.logger.log(
      createLogMessage("Analysis trigger started", {
        taskId,
        explicitPromptId: options?.promptId,
      }),
    );

    const task = await this.db.getTaskById(taskId);
    if (!task) {
      this.logger.warn(
        createLogMessage("Analysis trigger skipped because task was not found", {
          taskId,
        }),
      );
      return;
    }
    if (!task.autoSummary) {
      this.logger.log(
        createLogMessage(
          "Analysis trigger skipped because auto summary is disabled",
          { taskId, bvid: task.bvid, cid: task.cid, status: task.status },
        ),
      );
      return;
    }
    if (task.status !== TaskStatus.Success) {
      this.logger.log(
        createLogMessage(
          "Analysis trigger skipped because download task is not successful",
          { taskId, bvid: task.bvid, cid: task.cid, status: task.status },
        ),
      );
      return;
    }
    if (!task.bvid || typeof task.cid !== "number") {
      this.logger.warn(
        createLogMessage(
          "Analysis trigger skipped because task lacks video resource identity",
          { taskId, bvid: task.bvid, cid: task.cid },
        ),
      );
      return;
    }

    const resolvedPromptId = await this.resolvePromptId(task, options?.promptId);
    this.logger.log(
      createLogMessage("Analysis trigger resolved prompt", {
        taskId,
        promptId: resolvedPromptId,
      }),
    );

    const claim = await this.db.claimAiSummaryTask({
      bvid: task.bvid,
      cid: task.cid,
      title: task.title,
      sourceTaskId: task.id,
      promptId: resolvedPromptId,
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

    const lowResSubTask = (
      await this.db.getAnalysisSubTasks(task.bvid, task.cid)
    ).find((s) => s.status !== "failed");
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

  /**
   * 提示词解析优先级：显式 promptId → 下载任务 prompt_id → 创作者绑定（按 mid）→ 系统默认。
   * nas 不复制 PromptService：直接用 db（getAiPromptById / getDefaultAiPromptId / getCreatorBindingByMid）。
   */
  private async resolvePromptId(
    task: TaskRecord,
    explicit?: number | null,
  ): Promise<number | undefined> {
    if (explicit != null && (await this.db.getAiPromptById(explicit))) {
      return explicit;
    }
    if (
      task.promptId != null &&
      (await this.db.getAiPromptById(task.promptId))
    ) {
      return task.promptId;
    }
    if (task.bvid) {
      const mid = await this.resolveCreatorMid(task.bvid);
      if (mid !== undefined) {
        const binding = await this.db.getCreatorBindingByMid(mid);
        if (binding && (await this.db.getAiPromptById(binding.promptId))) {
          return binding.promptId;
        }
      }
    }
    const defaultId = await this.db.getDefaultAiPromptId();
    if (defaultId !== undefined && (await this.db.getAiPromptById(defaultId))) {
      return defaultId;
    }
    return undefined;
  }

  /** 解析视频创作者 mid（nas 走 download 执行面的 getVideoInfo）；失败返回 undefined。 */
  private async resolveCreatorMid(bvid: string): Promise<number | undefined> {
    try {
      const resolved = await this.downloadService.getVideoInfo(bvid);
      const mid = resolved.videoInfo?.upperMid;
      if (typeof mid === "number" && Number.isFinite(mid) && mid > 0) {
        return mid;
      }
      return undefined;
    } catch (err) {
      this.logger.warn(
        createLogMessage(
          "Creator mid resolution failed, skipping creator prompt binding",
          { bvid, error: err instanceof Error ? err.message : String(err) },
        ),
      );
      return undefined;
    }
  }

  async runAnalysis(taskId: number, now: string): Promise<void> {
    const task = await this.db.getTaskById(taskId);
    if (!task) {
      return;
    }

    const taskBvid = task.bvid ?? "";
    const taskCid = task.cid;
    const lowResSubTask =
      task.bvid && typeof task.cid === "number"
        ? ((await this.db.getAnalysisSubTasks(task.bvid, task.cid)).find(
            (s) => s.status !== "failed",
          ) as AnalysisSubTaskRecord | undefined)
        : undefined;
    let llmVideoPath: string | undefined;
    let isTempVideo = false;

    try {
      await this.upsertAiSummaryTask(task, {
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
      const highResPath = resolveFromDownloadRoot(
        effectiveTask.outputFile,
        this.paths.DOWNLOAD_ROOT,
      );

      const video = await this.analysisVideoResolver.resolveAnalysisVideo({
        taskId,
        bvid: effectiveBvid,
        cid: effectiveCid,
        title: task.title,
        preferredLowResPath:
          lowResSubTask?.status === "completed"
            ? resolveFromDownloadRoot(
                lowResSubTask.outputFile,
                this.paths.DOWNLOAD_ROOT,
              )
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

      const summaryDir = resolveSummaryDir(this.paths.SUMMARY_BASE_DIR, task);
      const metadataVideoUrl = `https://www.bilibili.com/video/${effectiveBvid}`;

      const summaryRecord = await this.db.getAiSummaryTaskByResource(
        effectiveBvid,
        effectiveCid,
      );
      const resolvedPromptId = summaryRecord?.promptId;
      const resolvedPrompt = resolvedPromptId
        ? await this.db.getAiPromptById(resolvedPromptId)
        : undefined;

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
        systemPrompt: resolvedPrompt?.content,
      };

      this.logger.log(
        createLogMessage("Analysis prompt resolved for execution", {
          taskId,
          bvid: effectiveBvid,
          cid: effectiveCid,
          promptId: resolvedPromptId,
          promptName: resolvedPrompt?.name,
        }),
      );

      const engine = new AnalysisEngine(
        await getLlmConfig(this.db),
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

      try {
        await this.knowledgePublisher.publishInline({
          bvid: effectiveBvid,
          cid: effectiveCid,
          videoTitle: task.title || `${effectiveBvid}-${effectiveCid}`,
          videoUrl: metadataVideoUrl,
          modelName: result.modelName,
          rawResponse: result.rawResponse,
          segments: result.segments,
        });
      } catch (publishErr) {
        const pMsg =
          publishErr instanceof Error ? publishErr.message : String(publishErr);
        this.logger.error(
          createLogMessage(
            "Inline knowledge publish failed; content not persisted",
            { taskId, bvid: effectiveBvid, cid: effectiveCid, error: pMsg },
          ),
          publishErr instanceof Error ? publishErr.stack : undefined,
        );
        await this.upsertAiSummaryTask(task, {
          status: "failed",
          errorMessage: pMsg,
          executionTiming: JSON.stringify(result.timing),
          rawResponse: result.rawResponse,
          modelName: result.modelName,
          lastTriggeredAt: now,
          lastCompletedAt: new Date().toISOString(),
        });
        await this.notificationService.sendSummaryNotification({
          title: input.videoTitle,
          success: false,
          videoUrl: input.metadata.videoUrl,
          errorMessage: pMsg,
        });
        return;
      }
      await this.upsertAiSummaryTask(task, {
        status: "completed",
        errorMessage: "",
        executionTiming: JSON.stringify(result.timing),
        rawResponse: result.rawResponse,
        modelName: result.modelName,
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
      await this.upsertAiSummaryTask(task, {
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
      if (
        llmVideoPath &&
        isTempVideo &&
        llmVideoPath.startsWith(this.llmVideoDir)
      ) {
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
    const latestTask = (await this.db.getTaskById(taskId)) ?? task;
    if (!isNil(latestTask.outputFile) && !isNil(latestTask.bvid)) {
      return latestTask;
    }

    if (!task.bvid || !task.cid) {
      return latestTask;
    }

    const completedTask =
      (await this.db.findCompletedTaskByBvidAndCid(task.bvid, task.cid)) ??
      latestTask;

    const completedOutputFile = resolveFromDownloadRoot(
      completedTask.outputFile,
      this.paths.DOWNLOAD_ROOT,
    );
    if (
      completedOutputFile &&
      !(await this.downloadService.fileExists(completedOutputFile))
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

  async upsertAiSummaryTask(
    task: TaskRecord,
    fields: {
      status: string;
      summaryOutput?: string;
      errorMessage?: string;
      executionTiming?: string;
      rawResponse?: string;
      modelName?: string;
      lastTriggeredAt?: string;
      lastCompletedAt?: string;
    },
  ): Promise<void> {
    if (!task.bvid || typeof task.cid !== "number") {
      return;
    }
    await this.db.upsertAiSummaryTask({
      bvid: task.bvid,
      cid: task.cid,
      title: task.title,
      sourceTaskId: task.id,
      status: fields.status,
      summaryOutput: fields.summaryOutput,
      errorMessage: fields.errorMessage,
      executionTiming: fields.executionTiming,
      rawResponse: fields.rawResponse,
      modelName: fields.modelName,
      lastTriggeredAt: fields.lastTriggeredAt,
      lastCompletedAt: fields.lastCompletedAt,
    });
  }
}
