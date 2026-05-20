import { EventEmitter } from "node:events";
import { join, dirname } from "node:path";
import { TaskStatus } from "../domain/TaskStatus.js";
import { DownloadResult, DownloadErrorCode } from "../domain/DownloadResult.js";
import {
  DownloadEventType,
  type DownloadEvent,
} from "../events/DownloadEvent.js";
import type { MediaDownloaderPort } from "../ports/MediaDownloaderPort.js";
import type { MediaMergerPort } from "../ports/MediaMergerPort.js";
import type { FileStorePort } from "../ports/FileStorePort.js";
import type { SubtitleProviderPort } from "../ports/SubtitleProviderPort.js";
import type { MediaStreamInfo } from "../domain/DownloadPlan.js";

/**
 * 下载执行用例依赖项 — 仅需 4 个 port
 */
export interface DownloadExecutionDeps {
  mediaDownloader: MediaDownloaderPort;
  mediaMerger: MediaMergerPort;
  fileStore: FileStorePort;
  subtitleProvider?: SubtitleProviderPort;
}

/**
 * 下载执行请求 — 全部输入都已解析好、流已选好
 */
export interface DownloadExecutionRequest {
  bvid: string;
  cid: number;
  title: string;
  /** 预计算的完整输出路径（含 .mp4 扩展名） */
  outputFile: string;
  /** 适配层已选好的视频流 */
  videoStream: MediaStreamInfo;
  /** 适配层已选好的音频流 */
  audioStream: MediaStreamInfo;
  cookieString?: string;
  downloadSubtitle?: boolean;
  keepTempOnFailure?: boolean;
}

/**
 * 下载执行用例 — 原子地执行 下载 + 合并 + 字幕
 *
 * 不负责解析输入或选择流，这些由 ResolutionService 和适配层完成。
 * 输入 DownloadExecutionRequest 中的 videoStream / audioStream 是适配层已选好的。
 */
export class DownloadExecutionUseCase extends EventEmitter {
  constructor(private readonly deps: DownloadExecutionDeps) {
    super();
  }

  async execute(request: DownloadExecutionRequest): Promise<DownloadResult> {
    const startTime = Date.now();
    let downloadMs = 0;
    let mergeMs = 0;
    let tempDir: string | null = null;
    let hasFailed = false;

    try {
      // --- 跳检已存在文件 ---
      const fileExists = await this.deps.fileStore.exists(request.outputFile);
      if (fileExists) {
        const fileSize = await this.deps.fileStore.getFileSize(
          request.outputFile,
        );
        const result: DownloadResult = {
          status: TaskStatus.Success,
          outputFile: request.outputFile,
          fileSize,
          errorCode: DownloadErrorCode.UNKNOWN_ERROR,
          errorMessage: "文件已存在, 跳过下载",
          timing: {
            totalMs: Date.now() - startTime,
            resolveMs: 0,
            downloadMs: 0,
            mergeMs: 0,
          },
        };
        this.emitEvent({
          type: DownloadEventType.TaskSucceeded,
          result,
          status: TaskStatus.Success,
        });
        return result;
      }

      // --- 准备目录 ---
      const outputDir = dirname(request.outputFile);
      await this.deps.fileStore.ensureOutputDir(outputDir);
      tempDir = await this.deps.fileStore.createTempDir();

      const videoExt = request.videoStream.format ?? "m4s";
      const audioExt = request.audioStream.format ?? "m4s";
      const videoFile = join(tempDir, `video.${videoExt}`);
      const audioFile = join(tempDir, `audio.${audioExt}`);

      // --- 并发下载视频 + 音频（音频不报进度）---
      const downloadStart = Date.now();

      await Promise.all([
        this.downloadWithProgress(
          request.videoStream.url,
          videoFile,
          request.cookieString,
          (p) => {
            this.emitEvent({
              type: DownloadEventType.DownloadProgress,
              speedBytesPerSec: p.speedBytesPerSec,
              percentage: Math.min(p.percentage, 99),
            });
          },
        ),
        this.downloadWithProgress(
          request.audioStream.url,
          audioFile,
          request.cookieString,
        ),
      ]);

      downloadMs = Date.now() - downloadStart;

      // --- 合并 ---
      this.emitEvent({ type: DownloadEventType.MergeProgress });

      const mergeStart = Date.now();
      await this.deps.mediaMerger.merge(
        videoFile,
        audioFile,
        request.outputFile,
      );
      mergeMs = Date.now() - mergeStart;

      // --- 字幕下载（可选） ---
      if (request.downloadSubtitle && this.deps.subtitleProvider) {
        try {
          const subtitles = await this.deps.subtitleProvider.fetchSubtitles(
            request.bvid,
            request.cid,
            request.cookieString,
          );
          if (subtitles.length > 0) {
            const { writeFile } = await import("node:fs/promises");
            for (const sub of subtitles) {
              const srtFile = request.outputFile.replace(
                /\.mp4$/,
                `.${sub.langKey}.srt`,
              );
              await writeFile(srtFile, sub.srtContent, "utf-8");
            }
          }
        } catch {
          // 字幕下载失败不阻塞主流程
        }
      }

      // 下载 + 合并全部完成，进度 100%
      this.emitEvent({
        type: DownloadEventType.DownloadProgress,
        speedBytesPerSec: 0,
        percentage: 100,
      });

      // --- 结果 ---
      const totalMs = Date.now() - startTime;
      const fileSize = await this.deps.fileStore.getFileSize(
        request.outputFile,
      );

      const result: DownloadResult = {
        status: TaskStatus.Success,
        outputFile: request.outputFile,
        fileSize,
        timing: { totalMs, resolveMs: 0, downloadMs, mergeMs },
      };

      this.emitEvent({
        type: DownloadEventType.TaskSucceeded,
        result,
        status: TaskStatus.Success,
      });

      return result;
    } catch (err) {
      hasFailed = true;
      const errorMessage = (err as Error).message;
      return this.failResult(
        DownloadErrorCode.UNKNOWN_ERROR,
        errorMessage,
        startTime,
      );
    } finally {
      // 清理临时目录
      if (tempDir) {
        try {
          const keepTemp =
            hasFailed && (request.keepTempOnFailure ?? false);
          if (!keepTemp) {
            await this.deps.fileStore.cleanTempDir(tempDir);
          }
        } catch {
          // 清理失败不阻塞主流程
        }
      }
    }
  }

  /** 取消下载 */
  cancel(): void {
    this.deps.mediaDownloader.abort();
  }

  // ===== 私有方法 =====

  private emitEvent(event: DownloadEvent): void {
    this.emit("event", event);
    this.emit(event.type, event);
  }

  private async downloadWithProgress(
    url: string,
    filePath: string,
    cookieString: string | undefined,
    onProgress?: (p: { speedBytesPerSec: number; percentage: number }) => void,
  ): Promise<void> {
    let lastEmitTime = 0;

    await this.deps.mediaDownloader.download({
      url,
      filePath,
      cookieString,
      referer: "https://www.bilibili.com",
      onProgress: (progress) => {
        if (!onProgress) return;
        const now = Date.now();
        if (now - lastEmitTime >= 1000) {
          lastEmitTime = now;
          onProgress(progress);
        }
      },
    });
  }

  private failResult(
    errorCode: DownloadErrorCode,
    errorMessage: string,
    startTime: number,
  ): DownloadResult {
    const totalMs = Date.now() - startTime;
    const result: DownloadResult = {
      status: TaskStatus.Failed,
      errorCode,
      errorMessage,
      timing: { totalMs, resolveMs: 0, downloadMs: 0, mergeMs: 0 },
    };

    this.emitEvent({
      type: DownloadEventType.TaskFailed,
      result,
      status: TaskStatus.Failed,
    });

    return result;
  }
}