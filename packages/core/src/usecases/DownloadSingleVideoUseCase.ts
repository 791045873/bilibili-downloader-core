import { EventEmitter } from "node:events";
import { join } from "node:path";
import { TaskStatus } from "../domain/TaskStatus.js";
import type { DownloadRequest } from "../domain/DownloadRequest.js";
import type { DownloadPlan } from "../domain/DownloadPlan.js";
import { DownloadResult, DownloadErrorCode } from "../domain/DownloadResult.js";
import {
  DownloadEventType,
  type DownloadEvent,
} from "../events/DownloadEvent.js";
import type { ResourceParserPort, ResourceType } from "../ports/ResourceParserPort.js";
import type { StreamProviderPort } from "../ports/StreamProviderPort.js";
import type { MediaDownloaderPort } from "../ports/MediaDownloaderPort.js";
import type { MediaMergerPort } from "../ports/MediaMergerPort.js";
import type { FileStorePort } from "../ports/FileStorePort.js";
import type { AuthProviderPort } from "../ports/AuthProviderPort.js";

/**
 * 单视频下载用例依赖项
 */
export interface DownloadSingleVideoDeps {
  resourceParser: ResourceParserPort;
  streamProvider: StreamProviderPort;
  mediaDownloader: MediaDownloaderPort;
  mediaMerger: MediaMergerPort;
  fileStore: FileStorePort;
  authProvider?: AuthProviderPort;
}

/**
 * 单视频下载用例 - MVP 核心用例
 *
 * 编排 6 个标准阶段:
 * 1. 解析输入 -> bvid + resourceType
 * 2. 获取资源元信息 (从中获取 cid)
 * 3. 获取播放流 + 选择流 (视频 + 音频)
 * 4. 下载媒体文件
 * 5. 合并产物 (ffmpeg)
 * 6. 输出结果 + 清理临时文件
 */
export class DownloadSingleVideoUseCase extends EventEmitter {
  private abortController: AbortController | null = null;

  constructor(private readonly deps: DownloadSingleVideoDeps) {
    super();
  }

  /**
   * 执行下载
   * @param request 下载请求
   * @returns 下载结果
   */
  async execute(request: DownloadRequest): Promise<DownloadResult> {
    const startTime = Date.now();
    let resolveMs = 0;
    let downloadMs = 0;
    let mergeMs = 0;
    let tempDir: string | null = null;
    let hasFailed = false;

    this.abortController = new AbortController();

    try {
      // --- 阶段 1: 解析输入 ---
      this.emitEvent({
        type: DownloadEventType.TaskStarted,
        request,
        status: TaskStatus.Created,
      });

      const parseStart = Date.now();
      let parseResult: {bvid: string; type: ResourceType};
      try {
        parseResult = await this.deps.resourceParser.parse(request.input);
      } catch (err) {
        return this.failResult(
          DownloadErrorCode.INPUT_PARSE_ERROR,
          `无法解析输入: ${(err as Error).message}`,
          startTime,
        );
      }
      resolveMs = Date.now() - parseStart;

      // --- 阶段 2: 获取资源元信息 ---
      const cookieString = await this.resolveCookieString(request.cookieFile);

      const videoInfo = await this.deps.streamProvider.getVideoInfo(
        parseResult.bvid,
      );

      // 使用第一个分 P 的 cid
      const firstPage = videoInfo.pages[0];
      if (!firstPage) {
        return this.failResult(
          DownloadErrorCode.RESOURCE_NOT_FOUND,
          "该视频无分 P 信息",
          startTime,
        );
      }

      const cid = firstPage.cid;

      // --- 阶段 3: 获取播放流 + 选择流 ---
      const playStreams = await this.deps.streamProvider.getPlayStreams({
        bvid: parseResult.bvid,
        cid,
        resourceType: parseResult.type,
        cookieString,
      });

      const videoStream = this.selectBestStream(
        playStreams.videoStreams,
        request.videoCodec,
        request.quality,
      );
      const audioStream = this.selectBestStream(
        playStreams.audioStreams,
        undefined,
        request.audioQuality,
      );

      if (!videoStream || !audioStream) {
        return this.failResult(
          DownloadErrorCode.RESOURCE_NOT_FOUND,
          "无法找到合适的视频或音频流",
          startTime,
        );
      }

      const plan: DownloadPlan = {
        bvid: parseResult.bvid,
        cid,
        title: videoInfo.title,
        videoStream,
        audioStream,
        outputFileName: this.buildFileName(
          videoInfo.title,
          request.fileNameTemplate ?? "{title}",
        ),
      };

      this.emitEvent({
        type: DownloadEventType.TaskResolved,
        request,
        plan,
        status: TaskStatus.Resolving,
      });

      this.emitEvent({
        type: DownloadEventType.StreamSelected,
        videoCodec: videoStream.codec,
        videoQuality: String(videoStream.quality),
        audioCodec: audioStream.codec,
        audioQuality: String(audioStream.quality),
      });

      // --- 阶段 4: 下载媒体 ---
      await this.deps.fileStore.ensureOutputDir(request.outputDir);
      tempDir = await this.deps.fileStore.createTempDir();

      const downloadStart = Date.now();

      const videoExt = videoStream.format ?? "m4s";
      const audioExt = audioStream.format ?? "m4s";
      const videoFile = join(tempDir, `video.${videoExt}`);
      const audioFile = join(tempDir, `audio.${audioExt}`);

      await this.downloadWithProgress(
        videoStream.url,
        videoFile,
        cookieString,
      );

      await this.downloadWithProgress(
        audioStream.url,
        audioFile,
        cookieString,
      );

      downloadMs = Date.now() - downloadStart;

      // --- 阶段 5: 合并 ---
      this.emitEvent({ type: DownloadEventType.MergeProgress });

      const mergeStart = Date.now();
      const outputFile = join(
        request.outputDir,
        `${plan.outputFileName}.mp4`,
      );
      await this.deps.mediaMerger.merge(videoFile, audioFile, outputFile);
      mergeMs = Date.now() - mergeStart;

      // --- 阶段 6: 输出结果 ---
      const totalMs = Date.now() - startTime;
      const fileSize = await this.deps.fileStore.getFileSize(outputFile);

      const result: DownloadResult = {
        status: TaskStatus.Completed,
        outputFile,
        fileSize,
        timing: { totalMs, resolveMs, downloadMs, mergeMs },
      };

      this.emitEvent({
        type: DownloadEventType.TaskCompleted,
        result,
        status: TaskStatus.Completed,
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
      // 清理临时目录: 成功时总是清理，失败时按配置决定
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
    this.abortController?.abort();
  }

  // ===== 私有方法 =====

  private emitEvent(event: DownloadEvent): void {
    this.emit("event", event);
    this.emit(event.type, event);
  }

  private async resolveCookieString(
    cookieFile?: string,
  ): Promise<string | undefined> {
    if (!cookieFile || !this.deps.authProvider) return undefined;
    try {
      const cookies = await this.deps.authProvider.loadCookies(cookieFile);
      return this.deps.authProvider.toCookieString(cookies);
    } catch {
      return undefined;
    }
  }

  private selectBestStream(
    streams: { codec: string; quality: number; url: string; format: string }[],
    codecPreference?: string,
    qualityPreference?: number,
  ) {
    if (streams.length === 0) return null;

    let candidates = [...streams];

    // 按编码过滤
    if (codecPreference) {
      const filtered = candidates.filter((s) =>
        s.codec.toLowerCase().includes(codecPreference.toLowerCase()),
      );
      if (filtered.length > 0) candidates = filtered;
    }

    // 按清晰度过滤
    if (qualityPreference) {
      const filtered = candidates.filter(
        (s) => s.quality === qualityPreference,
      );
      if (filtered.length > 0) candidates = filtered;
    }

    // 选择最高清晰度的流
    candidates.sort((a, b) => b.quality - a.quality);
    return candidates[0];
  }

  private async downloadWithProgress(
    url: string,
    filePath: string,
    cookieString: string | undefined,
  ): Promise<void> {
    let lastEmitTime = 0;

    await this.deps.mediaDownloader.download({
      url,
      filePath,
      cookieString,
      referer: "https://www.bilibili.com",
      onProgress: (progress) => {
        const now = Date.now();
        if (now - lastEmitTime >= 1000) {
          lastEmitTime = now;
          this.emitEvent({
            type: DownloadEventType.DownloadProgress,
            downloadedBytes: progress.downloadedBytes,
            totalBytes: progress.totalBytes,
            speedBytesPerSec: progress.speedBytesPerSec,
            percentage: progress.percentage,
          });
        }
      },
    });
  }

  private buildFileName(title: string, template: string): string {
    let name = template.replace("{title}", title);
    name = name.replace(/[<>:"/\\|?*]/g, "_");
    return name;
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