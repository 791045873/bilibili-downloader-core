/**
 * 视频资产决策层 — AI 总结用视频与截图源的统一裁决
 *
 * 职责：
 * - resolveAnalysisVideo：LLM 分析视频（低清子任务文件 → 高清任务文件，取第一个真实存在者；均缺失时重置子任务并重新调度低清下载）
 * - resolve：截图源（远端流 → 已完成本地下载 → 同步重下），全程磁盘校验
 *
 * 收敛了此前散落在 trigger() / ScreenshotSourceResolver 中的资产决策逻辑，
 * 所有磁盘校验以 NodeFileStore.exists 为唯一入口。
 */

import { Injectable, Logger } from "@nestjs/common";
import { mkdir } from "node:fs/promises";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import { DatabaseService } from "../database/database.service.js";
import { DownloadService } from "../download/download.service.js";
import { DownloadScheduler } from "../download/download-scheduler.js";
import { createLogMessage } from "../logging/server-log.util.js";
import isNil from "lodash/isNil.js";

export interface ScreenshotSourceResolverInput {
  metadata: {
    type: "bilibili" | "local";
    videoUrl?: string;
    bvid?: string;
    cid?: number;
  };
  localVideoPath?: string;
}

export interface ScreenshotSourceResolveResult {
  source: string;
  sourceType: "remote" | "local";
  headers?: Record<string, string>;
}

export interface ScreenshotSourceResolver {
  resolve(
    params: ScreenshotSourceResolverInput,
  ): Promise<ScreenshotSourceResolveResult>;
}

export type AnalysisVideoResolveResult =
  | { status: "ready"; path: string; isTemp: boolean }
  | { status: "downloading" };

@Injectable()
export class AnalysisVideoResolver implements ScreenshotSourceResolver {
  private readonly logger = new Logger(AnalysisVideoResolver.name);

  constructor(
    private readonly downloadService: DownloadService,
    private readonly databaseService: DatabaseService,
    private readonly downloadScheduler: DownloadScheduler,
  ) {}

  /**
   * 决策 LLM 分析视频：低清子任务文件 → 高清任务文件，取第一个真实存在者。
   * 均不存在时重置失效子任务并重新调度低清下载，返回 downloading。
   */
  async resolveAnalysisVideo(input: {
    taskId: number;
    bvid: string;
    cid: number;
    title?: string;
    preferredLowResPath?: string;
    highResPath?: string;
    llmVideoDir: string;
  }): Promise<AnalysisVideoResolveResult> {
    if (
      input.preferredLowResPath &&
      (await this.downloadService.fileExists(input.preferredLowResPath))
    ) {
      return { status: "ready", path: input.preferredLowResPath, isTemp: true };
    }

    if (
      input.highResPath &&
      (await this.downloadService.fileExists(input.highResPath))
    ) {
      return { status: "ready", path: input.highResPath, isTemp: false };
    }

    // 无可用视频：重置失效子任务并重新调度低清下载（资源级键，同资源唯一）
    await mkdir(input.llmVideoDir, { recursive: true });
    const subTasks = this.databaseService.getAnalysisSubTasks(
      input.bvid,
      input.cid,
    );
    const stale = subTasks.find((s) => s.status !== "failed");

    let analysisSubTaskId: number;
    if (stale) {
      this.databaseService.updateAnalysisSubTaskStatus(stale.id!, {
        status: "created",
        errorMessage: "",
        completedAt: "",
      });
      analysisSubTaskId = stale.id!;
    } else {
      const failed = subTasks.find((s) => s.status === "failed");
      if (failed) {
        this.databaseService.updateAnalysisSubTaskStatus(failed.id!, {
          status: "created",
          errorMessage: "",
          completedAt: "",
        });
        analysisSubTaskId = failed.id!;
      } else {
        analysisSubTaskId = this.databaseService.insertAnalysisSubTask({
          taskId: input.taskId,
          bvid: input.bvid,
          cid: input.cid,
          quality: 0,
          status: "created",
          createdAt: new Date().toISOString(),
        });
      }
    }

    this.downloadScheduler.scheduleLowResDownload({
      taskId: input.taskId,
      analysisSubTaskId,
      bvid: input.bvid,
      cid: input.cid,
      title: input.title ?? `${input.bvid}-${input.cid}`,
    });

    this.logger.log(
      createLogMessage(
        "Analysis scheduled low resolution video download because no usable video exists",
        {
          taskId: input.taskId,
          analysisSubTaskId,
          bvid: input.bvid,
          cid: input.cid,
          outputPath: input.llmVideoDir,
        },
      ),
    );

    return { status: "downloading" };
  }

  /** 截图源解析：本地直用；bilibili 走 远端流 → 已完成本地下载 → 同步重下 三级降级 */
  async resolve(
    params: ScreenshotSourceResolverInput,
  ): Promise<ScreenshotSourceResolveResult> {
    const { metadata, localVideoPath } = params;

    if (metadata.type === "local") {
      if (!localVideoPath) {
        throw new Error("metadata.type=local 时必须提供 localVideoPath");
      }
      this.logger.log(
        createLogMessage("Using local screenshot source", {
          videoPath: localVideoPath,
          sourceType: "local",
        }),
      );
      return { source: localVideoPath, sourceType: "local" };
    }

    const bvid = metadata.bvid;
    const cid = metadata.cid;
    if (isNil(bvid) || isNil(cid)) {
      throw new Error("metadata.type=bilibili 时必须提供 bvid 和 cid");
    }

    let bestStream: { url: string; quality: number } | undefined;
    try {
      this.logger.log(
        createLogMessage("Attempting remote screenshot source resolution", {
          bvid,
          cid,
          sourceType: "remote",
        }),
      );
      bestStream = await this.downloadService.resolveBestVideoStream(bvid, cid);
      this.logger.log(
        createLogMessage("Using remote screenshot source", {
          bvid,
          cid,
          sourceType: "remote",
          quality: bestStream.quality,
        }),
      );
      return {
        source: bestStream.url,
        sourceType: "remote",
        headers: { Referer: "https://www.bilibili.com" },
      };
    } catch (error) {
      this.logger.warn(
        createLogMessage(
          "Remote screenshot source resolution failed, falling back to local strategies",
          {
            bvid,
            cid,
            error: error instanceof Error ? error.message : String(error),
          },
        ),
      );
    }

    const completedTask = this.databaseService.findCompletedTaskByBvidAndCid(
      bvid,
      cid,
    );
    if (
      completedTask?.outputFile &&
      (completedTask.quality ?? 0) >= 80 &&
      (await this.downloadService.fileExists(completedTask.outputFile))
    ) {
      this.logger.log(
        createLogMessage(
          "Using completed local download as screenshot source",
          {
            taskId: completedTask.id,
            bvid,
            cid,
            quality: completedTask.quality,
            outputFile: completedTask.outputFile,
            sourceType: "local",
          },
        ),
      );
      return { source: completedTask.outputFile, sourceType: "local" };
    }
    if (completedTask?.outputFile && (completedTask.quality ?? 0) >= 80) {
      this.logger.warn(
        createLogMessage(
          "Completed local download file is missing on disk, skipping this fallback",
          {
            taskId: completedTask.id,
            bvid,
            cid,
            quality: completedTask.quality,
            outputFile: completedTask.outputFile,
          },
        ),
      );
    }

    if (!bestStream) {
      try {
        bestStream = await this.downloadService.resolveBestVideoStream(
          bvid,
          cid,
        );
      } catch (error) {
        this.logger.error(
          createLogMessage("Unable to resolve screenshot fallback stream", {
            bvid,
            cid,
            error: error instanceof Error ? error.message : String(error),
          }),
          error instanceof Error ? error.stack : undefined,
        );
        throw error;
      }
    }
    const title = `${bvid}-${cid}-analysis-screenshot`;
    const task = await this.downloadService.createTask({
      bvid,
      cid,
      title,
      quality: bestStream.quality,
    });

    this.logger.log(
      createLogMessage("Created fallback screenshot download task", {
        taskId: task.id,
        bvid,
        cid,
        quality: bestStream.quality,
        timeoutMs: 10 * 60 * 1000,
      }),
    );

    const taskRecord = this.downloadService.getTaskById(task.id);
    if (!taskRecord) {
      throw new Error(`无法加载新建下载任务: ${task.id}`);
    }

    await this.executeWithTimeout(
      this.downloadService.executeTask(taskRecord),
      10 * 60 * 1000,
    );

    const finalRecord = this.downloadService.getTaskById(task.id);
    if (finalRecord?.status !== TaskStatus.Success || !finalRecord.outputFile) {
      this.logger.error(
        createLogMessage(
          "Fallback screenshot download did not produce a usable file",
          {
            taskId: task.id,
            bvid,
            cid,
            status: finalRecord?.status,
            error: finalRecord?.errorMessage ?? "下载失败",
          },
        ),
      );
      throw new Error(finalRecord?.errorMessage ?? "下载失败");
    }

    this.logger.log(
      createLogMessage("Using freshly downloaded local screenshot source", {
        taskId: task.id,
        bvid,
        cid,
        outputFile: finalRecord.outputFile,
        sourceType: "local",
      }),
    );

    return { source: finalRecord.outputFile, sourceType: "local" };
  }

  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error("下载超时，请稍后手动重试"));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
}
