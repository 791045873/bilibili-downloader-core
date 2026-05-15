import { EventEmitter } from "node:events";
import { join } from "node:path";
import { TaskStatus } from "../domain/TaskStatus.js";
import type { DownloadRequest } from "../domain/DownloadRequest.js";
import { DownloadResult, DownloadErrorCode } from "../domain/DownloadResult.js";
import { DownloadEventType, type DownloadEvent } from "../events/DownloadEvent.js";
import type { FavoritesProviderPort } from "../ports/FavoritesProviderPort.js";
import type { FileStorePort } from "../ports/FileStorePort.js";
import {
  DownloadSingleVideoUseCase,
  type DownloadSingleVideoDeps,
} from "./DownloadSingleVideoUseCase.js";

/**
 * 合集下载用例依赖项
 */
export interface DownloadFavoritesDeps extends DownloadSingleVideoDeps {
  favoritesProvider: FavoritesProviderPort;
}

/**
 * 合集下载用例
 *
 * 1. 获取合集元信息
 * 2. 分页获取所有视频列表
 * 3. 依次使用 DownloadSingleVideoUseCase 下载每个视频
 */
export class DownloadFavoritesUseCase extends EventEmitter {
  constructor(private readonly deps: DownloadFavoritesDeps) {
    super();
  }

  async execute(
    mediaId: number,
    baseRequest: DownloadRequest,
    cookieString?: string,
  ): Promise<DownloadResult> {
    const startTime = Date.now();

    try {
      // --- 阶段 1: 获取合集信息 ---
      console.log("\n=== 合集下载模式 ===");

      const info = await this.deps.favoritesProvider.getFavoritesInfo(
        mediaId,
        cookieString,
      );
      console.log(`合集: ${info.title}`);
      console.log(`共 ${info.mediaCount} 个视频\n`);

      // --- 阶段 2: 分页获取全部视频 ---
      const allVideos: {
        bvid: string;
        title: string;
        pageCount: number;
      }[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const result = await this.deps.favoritesProvider.getFavoritesVideos(
          mediaId,
          page,
          20,
          cookieString,
        );
        for (const v of result.videos) {
          allVideos.push({
            bvid: v.bvid,
            title: v.title,
            pageCount: v.pageCount,
          });
        }
        hasMore = result.hasMore;
        page++;
      }

      console.log(`已获取 ${allVideos.length} 个视频\n`);

      // --- 阶段 3: 依次下载 ---
      const outputDir = baseRequest.outputDir;
      await this.deps.fileStore.ensureOutputDir(outputDir);

      let completed = 0;
      let failed = 0;

      // 创建单视频 UseCase 并转发其事件
      const singleUseCase = new DownloadSingleVideoUseCase(this.deps);
      singleUseCase.on("event", (event: DownloadEvent) => {
        this.emit("event", event);
        this.emit(event.type, event);
      });

      for (let i = 0; i < allVideos.length; i++) {
        const video = allVideos[i];
        const idx = i + 1;

        console.log(`[${idx}/${allVideos.length}] ${video.title}`);

        const request: DownloadRequest = {
          ...baseRequest,
          input: video.bvid,
          outputDir: join(outputDir, sanitizeDirName(info.title)),
        };

        const result = await singleUseCase.execute(request);

        if (result.status === TaskStatus.Completed) {
          completed++;
          console.log(`  ✅ 完成`);
        } else {
          failed++;
          console.log(`  ❌ [${result.errorCode}] ${result.errorMessage}`);
        }
      }

      // --- 阶段 4: 汇总 ---
      const totalMs = Date.now() - startTime;
      const finalResult: DownloadResult = {
        status: failed === 0 ? TaskStatus.Completed : TaskStatus.Failed,
        timing: { totalMs, resolveMs: 0, downloadMs: 0, mergeMs: 0 },
      };

      console.log(
        `\n合集下载完成: ${completed} 成功 / ${failed} 失败 / ${allVideos.length} 总计`,
      );
      console.log(`耗时: ${formatTime(totalMs)}`);
      console.log(`输出目录: ${join(outputDir, sanitizeDirName(info.title))}`);

      return finalResult;
    } catch (err) {
      return {
        status: TaskStatus.Failed,
        errorCode: DownloadErrorCode.UNKNOWN_ERROR,
        errorMessage: (err as Error).message,
        timing: {
          totalMs: Date.now() - startTime,
          resolveMs: 0,
          downloadMs: 0,
          mergeMs: 0,
        },
      };
    }
  }

  cancel(): void {
    this.deps.mediaDownloader.abort();
  }
}

function sanitizeDirName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_");
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) return `${minutes}分${secs}秒`;
  return `${secs}秒`;
}