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
} from "@bilibili-downloader/server-common";
import { DownloadScheduler } from "../download/download-scheduler.js";
import { DownloadService } from "../download/download.service.js";
import { NotificationService } from "../notification/notification.service.js";
import { sanitizeFileName } from "../download/file-naming.js";
import { createLogMessage } from "@bilibili-downloader/server-common";
import { PromptService } from "./prompt.service.js";
import { PathsService } from "../paths/paths.service.js";
import { resolveFromDownloadRoot } from "@bilibili-downloader/server-common";
import { KnowledgePublisherService } from "../knowledge/knowledge-publisher.service.js";
import { WorkerService } from "@bilibili-downloader/server-common";
import { SummaryIntegrityService } from "./summary-integrity.service.js";
import { ScreenshotRetryService } from "./screenshot-retry.service.js";
import type { WorkerJobRecord } from "@bilibili-downloader/server-common";

/** AI 总结任务执行耗时明细 */
export interface AiSummaryExecutionTiming {
  llmMs: number;
  screenshotMs: number;
  totalMs: number;
}

/** AI 总结任务对外视图：executionTiming 解析为对象；rawResponse 不出接口（仅入库；成功=模型原始返回，失败=错误信息） */
export interface AiSummaryTaskView
  extends Omit<AiSummaryTaskRecord, "executionTiming" | "rawResponse"> {
  executionTiming?: AiSummaryExecutionTiming;
}

/** AI 总结任务分页视图 */
export interface PaginatedAiSummaryTaskView {
  items: AiSummaryTaskView[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

function parseVisionProxyTimeoutMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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
    private readonly promptService: PromptService,
    private readonly knowledgePublisher: KnowledgePublisherService,
    private readonly paths: PathsService,
    private readonly worker: WorkerService,
    private readonly summaryIntegrity: SummaryIntegrityService,
    private readonly screenshotRetry: ScreenshotRetryService,
  ) {
    this.llmVideoDir = paths.ANALYSIS_LLM_VIDEO_DIR;
  }

  async onModuleInit(): Promise<void> {
    // 启动对账：低清队列为内存态，重启后遗留子任务/卡死总结标 failed，避免永久等待
    const reconciled = await this.db.reconcileStaleAnalysisState();
    if (reconciled.failedSubTasks > 0 || reconciled.failedSummaryTasks > 0) {
      this.logger.log(
        createLogMessage("Reconciled stale analysis state after restart", {
          failedSubTasks: reconciled.failedSubTasks,
          failedSummaryTasks: reconciled.failedSummaryTasks,
        }),
      );
    }

    this.downloadScheduler.onAnalysisTrigger = (taskId: number) => {
      this.enqueueAnalyzeForTask(taskId).catch((err: unknown) => {
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

    this.worker.registerHandler("analyze", (job) => this.handleAnalyzeJob(job));
    this.worker.registerHandler("low_res_download", (job) =>
      this.handleLowResDownloadJob(job),
    );
    this.worker.registerHandler("screenshot_retry", (job) =>
      this.handleScreenshotRetryJob(job),
    );
    this.worker.registerHandler("integrity_check", (job) =>
      this.handleIntegrityCheckJob(job),
    );
  }

  /** 触发期解析 promptId 并入队 analyze 作业（payload 前移 promptId/mid 解析）。 */
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
      dedupKey: `analyze:${task.bvid}:${task.cid}`,
      payload: { taskId, promptId },
    });
  }

  private async handleIntegrityCheckJob(_job: WorkerJobRecord): Promise<void> {
    // 完整性检查重定义：以云 DB(内容) + screenshot_url(截图) + NAS 视频三类判据执行。
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
      await this.runAnalysis(payload.taskId, new Date().toISOString());
      return;
    }
    await this.trigger(payload.taskId, { promptId: payload.promptId });
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
        kind: "analyze",
        queue: "nas",
        refType: "task",
        refId: taskId,
        dedupKey: `analyze:cont:${bvid}:${cid}`,
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
        await this.upsertAiSummaryTask(task, {
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

  async trigger(
    taskId: number,
    options?: { promptId?: number },
  ): Promise<void> {
    this.logger.log(
      createLogMessage("Analysis trigger started", {
        taskId,
        explicitPromptId: options?.promptId,
      }),
    );

    const task = await this.db.getTaskById(taskId);
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

    // 提示词解析：显式 → task.prompt_id → 创作者绑定（按 mid）→ 系统默认 → 内置兜底
    const resolvedPromptId = await this.resolvePromptId(task, options?.promptId);
    this.logger.log(
      createLogMessage("Analysis trigger resolved prompt", {
        taskId,
        promptId: resolvedPromptId,
      }),
    );

    // 原子认领：pending/analyzing 进行中直接拒绝，防并发双跑
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

    // 认领已完成，ai_summary_task 已置 pending（唯一权威），无需再写 task 镜像

    // 低清未就绪则等待（认领保持进行中，续跑由 onLowResFinished 驱动 runAnalysis）
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
   * 某层引用的提示词不存在（已删除）则跳过该层继续向下；返回 undefined 由引擎回退内置内容。
   * mid 解析失败（B 站接口异常）时跳过创作者绑定层。
   */
  private async resolvePromptId(
    task: TaskRecord,
    explicit?: number,
  ): Promise<number | undefined> {
    if (explicit !== undefined && (await this.promptService.get(explicit))) {
      return explicit;
    }
    if (
      task.promptId !== undefined &&
      (await this.promptService.get(task.promptId))
    ) {
      return task.promptId;
    }
    if (task.bvid) {
      const mid = await this.resolveCreatorMid(task.bvid);
      if (mid !== undefined) {
        const binding = await this.promptService.getCreatorBinding(mid);
        if (binding && (await this.promptService.get(binding.promptId))) {
          return binding.promptId;
        }
      }
    }
    const defaultId = await this.promptService.getDefaultPromptId();
    if (
      defaultId !== undefined &&
      (await this.promptService.get(defaultId))
    ) {
      return defaultId;
    }
    return undefined;
  }

  /** 解析视频创作者 mid；失败返回 undefined（跳过创作者绑定层） */
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
          {
            bvid,
            error: err instanceof Error ? err.message : String(err),
          },
        ),
      );
      return undefined;
    }
  }

  private async runAnalysis(taskId: number, now: string): Promise<void> {
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

      // LLM 分析视频决策统一走资产层：低清子任务文件 → 高清任务文件，缺失时调度重下
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

      const summaryDir = this.resolveSummaryDir(task);
      const metadataVideoUrl = `https://www.bilibili.com/video/${effectiveBvid}`;

      const summaryRecord = await this.db.getAiSummaryTaskByResource(
        effectiveBvid,
        effectiveCid,
      );
      const resolvedPromptId = summaryRecord?.promptId;
      const resolvedPrompt = resolvedPromptId
        ? await this.promptService.get(resolvedPromptId)
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
        await this.getLlmConfig(),
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
      // Phase 1b：内联发布，内容入库成功才置 completed；截图/向量为入库后 best-effort
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
          createLogMessage("Inline knowledge publish failed; content not persisted", {
            taskId,
            bvid: effectiveBvid,
            cid: effectiveCid,
            error: pMsg,
          }),
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
        // H4：失败不写 rawResponse（只放模型输出；LLM 失败保持 NULL）
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

    // 磁盘校验：重载文件已不存在时回退当前任务，交由下游低清恢复
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

  private resolveSummaryDir(task: TaskRecord): string {
    const base = this.paths.SUMMARY_BASE_DIR;
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

  private async getLlmConfig(): Promise<LlmConfig> {
    const stored = await this.db.getSettings([
      "llm.apiKey",
      "llm.modelName",
    ]);
    const apiKey = stored["llm.apiKey"];
    const modelName = stored["llm.modelName"];
    const visionProxyUrl = process.env.QWEN_VISION_PROXY_URL;
    const visionProxyTimeoutMs = parseVisionProxyTimeoutMs(
      process.env.QWEN_VISION_PROXY_TIMEOUT_MS,
    );

    if (!apiKey || !modelName) {
      throw new Error("缺少 LLM 配置：请在设置页配置 API Key/模型");
    }

    return {
      apiKey,
      modelName,
      visionProxyUrl,
      visionProxyTimeoutMs,
    };
  }

  async getAiSummaryTasksPaginated(params: {
    page: number;
    pageSize: number;
    status?: string[];
    search?: string;
    updatedFrom?: string;
    updatedTo?: string;
  }): Promise<PaginatedAiSummaryTaskView> {
    const result = await this.db.listAiSummaryTasksPaginated({
      page: params.page,
      pageSize: params.pageSize,
      filter: {
        status: params.status,
        search: params.search,
        updatedFrom: params.updatedFrom,
        updatedTo: params.updatedTo,
      },
    });
    return {
      ...result,
      items: result.items.map(({ rawResponse: _raw, ...rest }) => ({
        ...rest,
        executionTiming: this.parseExecutionTiming(rest.executionTiming),
      })),
    };
  }

  async getAiSummaryTaskById(
    id: number,
  ): Promise<AiSummaryTaskView | undefined> {
    const record = await this.db.getAiSummaryTaskById(id);
    if (!record) {
      return undefined;
    }
    const { rawResponse: _raw, ...rest } = record;
    return {
      ...rest,
      executionTiming: this.parseExecutionTiming(rest.executionTiming),
    };
  }

  async deleteAiSummaryTask(id: number): Promise<boolean> {
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

  private async upsertAiSummaryTask(
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
