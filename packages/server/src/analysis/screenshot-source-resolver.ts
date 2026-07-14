import { Injectable, Logger } from "@nestjs/common";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import { DatabaseService } from "../database/database.service.js";
import { DownloadService } from "../download/download.service.js";

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

@Injectable()
export class DefaultScreenshotSourceResolver implements ScreenshotSourceResolver {
  private readonly logger = new Logger(DefaultScreenshotSourceResolver.name);

  constructor(
    private readonly downloadService: DownloadService,
    private readonly databaseService: DatabaseService,
  ) {}

  async resolve(
    params: ScreenshotSourceResolverInput,
  ): Promise<ScreenshotSourceResolveResult> {
    const { metadata, localVideoPath } = params;

    if (metadata.type === "local") {
      if (!localVideoPath) {
        throw new Error("metadata.type=local 时必须提供 localVideoPath");
      }
      return { source: localVideoPath, sourceType: "local" };
    }

    const bvid = metadata.bvid;
    const cid = metadata.cid;
    if (!bvid || !cid) {
      throw new Error("metadata.type=bilibili 时必须提供 bvid 和 cid");
    }

    let bestStream: { url: string; quality: number } | undefined;
    try {
      bestStream = await this.downloadService.resolveBestVideoStream(bvid, cid);
      return {
        source: bestStream.url,
        sourceType: "remote",
        headers: { Referer: "https://www.bilibili.com" },
      };
    } catch (error) {
      this.logger.warn(`远端截图源解析失败，降级到本地策略: ${(error as Error).message}`);
    }

    const completedTask = this.databaseService.findCompletedTaskByBvidAndCid(
      bvid,
      cid,
    );
    if (
      completedTask?.outputFile
      && (completedTask.quality ?? 0) >= 80
    ) {
      return { source: completedTask.outputFile, sourceType: "local" };
    }

    if (!bestStream) {
      bestStream = await this.downloadService.resolveBestVideoStream(bvid, cid);
    }
    const title = `${bvid}-${cid}-analysis-screenshot`;
    const task = await this.downloadService.createTask({
      bvid,
      cid,
      title,
      quality: bestStream.quality,
    });

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
      throw new Error(finalRecord?.errorMessage ?? "下载失败");
    }

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
