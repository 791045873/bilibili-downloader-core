import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { createBilibiliSdkClient } from "@bilibili-downloader/adapters/bilibili";
import type { BilibiliSdkClient } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliResourceParser } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliStreamProvider } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliSubtitleProvider } from "@bilibili-downloader/adapters/bilibili";
import { FileCacheStore } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliAuthProvider } from "@bilibili-downloader/adapters/bilibili-auth";
import { HttpDownloader } from "@bilibili-downloader/adapters/downloader";
import { FfmpegMerger } from "@bilibili-downloader/adapters/ffmpeg";
import { NodeFileStore } from "@bilibili-downloader/adapters/fs";
import {
  ResolutionService,
  DownloadExecutionUseCase,
} from "@bilibili-downloader/core/usecases";
import type { DownloadExecutionRequest } from "@bilibili-downloader/core/usecases";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import { DownloadEventType } from "@bilibili-downloader/core/events";
import type { ResolvedVideo } from "@bilibili-downloader/core/domain";
import { join } from "node:path";
import { PathsService } from "../paths/paths.service.js";
import {
  DatabaseService,
  type TaskRecord,
  createLogMessage,
} from "@bilibili-downloader/server-common";
import { buildOutputFileName } from "./file-naming.js";

interface LowResDownloadResult {
  outputFile: string;
  quality: number;
}

export interface ParseResultItem {
  cid: number;
  videoQualityList: { id: number; name: string; codecList: string[] }[];
  audioQualityList: string[];
  resourceType?: string;
}

/** 新建执行型任务入参（nas 内部链路：截图回退同步下载，无去重/无 cache）。 */
export interface AdHocTaskInput {
  bvid: string;
  cid: number;
  title: string;
  quality?: number;
  codec?: string;
  outputPath?: string;
  fileNameTemplate?: string;
  subtitleLang?: string;
}

/**
 * 下载任务 nas 半（执行面）。
 *
 * 承载 ffmpeg / HttpDownloader / NodeFileStore 与媒体路径 join（PathsService）；
 * 不含创建校验/读查询/停恢删的 HTTP 面（在 cloud-server 的 DownloadTaskService）。
 */
@Injectable()
export class DownloadExecutorService implements OnModuleInit {
  private readonly logger = new Logger(DownloadExecutorService.name);
  private readonly outputDir: string;
  private readonly cookieFile: string;

  private biliClient!: BilibiliSdkClient;
  private authProvider!: BilibiliAuthProvider;
  private resourceParser!: BilibiliResourceParser;
  private streamProvider!: BilibiliStreamProvider;
  private resolutionService!: ResolutionService;
  private executionDeps!: {
    mediaDownloader: HttpDownloader;
    mediaMerger: FfmpegMerger;
    fileStore: NodeFileStore;
    subtitleProvider: BilibiliSubtitleProvider;
  };
  private fileStore!: NodeFileStore;
  private merger!: FfmpegMerger;

  constructor(
    private readonly db: DatabaseService,
    private readonly paths: PathsService,
  ) {
    this.outputDir = paths.DOWNLOAD_ROOT;
    this.cookieFile = paths.COOKIE_FILE_PATH;
  }

  async onModuleInit(): Promise<void> {
    const cookieString = this.cookieFile
      ? await this.loadCookieString(this.cookieFile)
      : undefined;
    this.biliClient = createBilibiliSdkClient(cookieString, {
      cacheStore: new FileCacheStore(this.paths.BILI_API_CACHE_DIR),
    });
    this.fileStore = new NodeFileStore();
    this.merger = new FfmpegMerger();

    await this.fileStore.ensureOutputDir(this.outputDir);

    if (!(await this.merger.isAvailable())) {
      this.logger.error("ffmpeg 未安装，下载后无法合并!");
    }

    this.authProvider = new BilibiliAuthProvider();
    this.resourceParser = new BilibiliResourceParser();
    this.streamProvider = new BilibiliStreamProvider(this.biliClient);
    this.resolutionService = new ResolutionService(
      this.resourceParser,
      this.streamProvider,
      this.authProvider,
    );
    this.executionDeps = {
      mediaDownloader: new HttpDownloader(),
      mediaMerger: this.merger,
      fileStore: this.fileStore,
      subtitleProvider: new BilibiliSubtitleProvider(this.biliClient),
    };

    this.logger.log(
      createLogMessage("Download executor service (nas) initialized", {
        outputPath: this.outputDir,
        fileExists: Boolean(cookieString),
      }),
    );
  }

  async getVideoInfo(input: string): Promise<ResolvedVideo> {
    return this.resolutionService.resolve(input, {
      cookieFile: this.cookieFile,
    });
  }

  async parseVideo(bvid: string, cid: number): Promise<ParseResultItem> {
    const parsed = await this.resourceParser.parse(bvid);
    const cookieString = this.cookieFile
      ? await this.loadCookieString(this.cookieFile)
      : undefined;

    const streams = await this.resolutionService.resolveStreams({
      bvid,
      cid,
      resourceType: parsed.type,
      cookieString,
    });

    const qualityMap = new Map<number, { name: string; codecs: Set<string> }>();
    for (const vs of streams.videoStreams) {
      const q = qualityMap.get(vs.quality) ?? { name: "", codecs: new Set() };
      q.codecs.add(extractCodecName(vs.codec));
      q.name = q.name || qualityLabel(vs.quality);
      qualityMap.set(vs.quality, q);
    }

    const videoQualityList = Array.from(qualityMap.entries())
      .sort(([a], [b]) => b - a)
      .map(([id, v]) => ({
        id,
        name: v.name || String(id),
        codecList: Array.from(v.codecs),
      }));

    const audioQualityList = streams.audioStreams.map(
      (s) => `${Math.round(s.quality / 1000)}K`,
    );
    const uniqueAudio = [...new Set(audioQualityList)].sort(
      (a, b) => Number.parseInt(b) - Number.parseInt(a),
    );

    return {
      cid,
      videoQualityList,
      audioQualityList: uniqueAudio,
      resourceType: String(parsed.type),
    };
  }

  /** 获取分P最高可用清晰度视频流（用于分析截图源远端优先策略） */
  async resolveBestVideoStream(
    bvid: string,
    cid: number,
  ): Promise<{ url: string; quality: number }> {
    const parsed = await this.resourceParser.parse(bvid);
    const cookieString = this.cookieFile
      ? await this.loadCookieString(this.cookieFile)
      : undefined;

    const streams = await this.resolutionService.resolveStreams({
      bvid,
      cid,
      resourceType: parsed.type,
      cookieString,
    });

    const best = this.resolutionService.selectBestStream(streams.videoStreams);
    if (!best) {
      throw new Error(`无法为 ${bvid}/${cid} 选择视频流`);
    }

    this.logger.log(
      createLogMessage("Resolved best video stream", {
        bvid,
        cid,
        quality: best.quality,
        availableQualityCount: streams.videoStreams.length,
      }),
    );

    return { url: best.url, quality: best.quality };
  }

  /** 静默下载低分辨率视频（不进入下载任务队列、不改 task 状态） */
  async executeLowResDownload(
    bvid: string,
    cid: number,
    title: string,
    resourceType?: string,
  ): Promise<LowResDownloadResult> {
    this.logger.log(
      createLogMessage("Starting low resolution download", {
        bvid,
        cid,
        title,
        resourceTypeForwarded: resourceType != null,
      }),
    );

    const parsedType =
      resourceType ?? (await this.resourceParser.parse(bvid)).type;
    const cookieString = this.cookieFile
      ? await this.loadCookieString(this.cookieFile)
      : undefined;

    const streams = await this.resolutionService.resolveStreams({
      bvid,
      cid,
      resourceType:
        parsedType as Awaited<ReturnType<BilibiliResourceParser["parse"]>>["type"],
      cookieString,
    });

    if (streams.videoStreams.length === 0 || streams.audioStreams.length === 0) {
      throw new Error("低清晰度下载失败：缺少可用的视频或音频流");
    }

    const lowVideo = [...streams.videoStreams].sort(
      (a, b) => a.quality - b.quality,
    )[0];
    const bestAudio = this.resolutionService.selectBestStream(
      streams.audioStreams,
    );
    if (!bestAudio) {
      throw new Error("低清晰度下载失败：缺少可用音频流");
    }

    const llmDir = this.paths.ANALYSIS_LLM_VIDEO_DIR;
    await this.fileStore.ensureOutputDir(llmDir);

    const fileName = buildOutputFileName({
      title,
      bvid,
      cid,
      quality: lowVideo.quality,
    });
    const outputFile = join(llmDir, fileName);

    this.logger.log(
      createLogMessage("Prepared low resolution download output", {
        bvid,
        cid,
        quality: lowVideo.quality,
        outputFile,
      }),
    );

    const executionUseCase = new DownloadExecutionUseCase(this.executionDeps);
    const request: DownloadExecutionRequest = {
      bvid,
      cid,
      title,
      outputFile,
      videoStream: lowVideo,
      audioStream: bestAudio,
      cookieString,
      subtitleLanguages: "none",
    };

    const result = await executionUseCase.execute(request);
    if (result.status !== TaskStatus.Success || !result.outputFile) {
      throw new Error(result.errorMessage || "低清晰度下载执行失败");
    }

    this.logger.log(
      createLogMessage("Low resolution download execution finished", {
        bvid,
        cid,
        quality: lowVideo.quality,
        outputFile: result.outputFile,
        durationMs: result.timing?.totalMs,
      }),
    );

    return { outputFile: result.outputFile, quality: lowVideo.quality };
  }

  /** 新建执行型任务（仅 insert，无去重、无 cache）：供截图回退同步下载链路使用。 */
  async createAdHocTask(
    input: AdHocTaskInput,
  ): Promise<{ created: true; id: number; message: string }> {
    const now = new Date().toISOString();
    const id = await this.db.insertTask({
      bvid: input.bvid,
      cid: input.cid,
      title: input.title,
      quality: input.quality,
      codec: input.codec,
      fileNameTemplate: input.fileNameTemplate,
      outputPath: input.outputPath,
      subtitleLang: input.subtitleLang,
      autoSummary: 0,
      status: TaskStatus.Created,
      createdAt: now,
    });
    this.logger.log(
      createLogMessage("Created ad-hoc download task", {
        taskId: id,
        bvid: input.bvid,
        cid: input.cid,
        quality: input.quality,
      }),
    );
    return { created: true, id, message: "任务已创建" };
  }

  /** 执行下载任务：开头原子认领（created → downloading）；非 created 则跳过。 */
  async executeTask(task: TaskRecord): Promise<void> {
    const id = task.id!;
    const claimed = await this.db.claimCreatedTaskById(id);
    if (!claimed) {
      this.logger.warn(
        createLogMessage(
          "Download task execution skipped: not in created state",
          { taskId: id, bvid: task.bvid, cid: task.cid },
        ),
      );
      return;
    }

    this.logger.log(
      createLogMessage("Starting download task execution", {
        taskId: id,
        bvid: claimed.bvid,
        cid: claimed.cid,
        requestedQuality: claimed.quality,
        requestedCodec: claimed.codec,
        outputPath: claimed.outputPath,
        autoSummary: claimed.autoSummary,
      }),
    );

    try {
      const cookieString = this.cookieFile
        ? await this.loadCookieString(this.cookieFile)
        : undefined;

      const parsed = await this.resourceParser.parse(claimed.bvid!);
      const streams = await this.resolutionService.resolveStreams({
        bvid: claimed.bvid!,
        cid: claimed.cid!,
        resourceType: parsed.type,
        cookieString,
      });

      const videoStream = this.resolutionService.selectBestStream(
        streams.videoStreams,
        claimed.codec,
        claimed.quality,
      );
      const audioStream = this.resolutionService.selectBestStream(
        streams.audioStreams,
      );

      if (!videoStream || !audioStream) {
        throw new Error("无法选择合适的视频或音频流");
      }

      this.logger.log(
        createLogMessage("Resolved task streams", {
          taskId: id,
          bvid: claimed.bvid,
          cid: claimed.cid,
          quality: videoStream.quality,
          codec: claimed.codec,
          availableQualityCount: streams.videoStreams.length,
        }),
      );

      const fileName = buildOutputFileName({
        title: claimed.title!,
        bvid: claimed.bvid!,
        cid: claimed.cid!,
        quality: videoStream.quality,
        codec: claimed.codec,
        template: claimed.fileNameTemplate,
      });
      const outputFile = claimed.outputPath
        ? join(this.outputDir, sanitizeOutputPath(claimed.outputPath), fileName)
        : join(this.outputDir, fileName);

      this.logger.log(
        createLogMessage("Resolved task output file", {
          taskId: id,
          bvid: claimed.bvid,
          cid: claimed.cid,
          quality: videoStream.quality,
          outputFile,
          hasOutputPath: Boolean(claimed.outputPath),
        }),
      );

      if (claimed.outputPath) {
        await this.fileStore.ensureOutputDir(
          join(this.outputDir, sanitizeOutputPath(claimed.outputPath)),
        );
      }

      const executionUseCase = new DownloadExecutionUseCase(this.executionDeps);

      executionUseCase.on(
        DownloadEventType.DownloadProgress,
        (e: { percentage: number; speedBytesPerSec: number }) => {
          this.db
            .updateTaskProgress(
              id,
              e.percentage,
              formatBytes(e.speedBytesPerSec) + "/s",
            )
            .catch((err: unknown) => {
              this.logger.error(
                createLogMessage("Failed to persist task progress", {
                  taskId: id,
                  error: err instanceof Error ? err.message : String(err),
                }),
              );
            });
        },
      );

      const request: DownloadExecutionRequest = {
        bvid: claimed.bvid!,
        cid: claimed.cid!,
        title: claimed.title!,
        outputFile,
        videoStream,
        audioStream,
        cookieString,
        subtitleLanguages: toSubtitleLanguages(claimed.subtitleLang),
      };

      const result = await executionUseCase.execute(request);

      await this.db.updateTaskStatus(id, {
        status: result.status,
        outputFile: result.outputFile,
        fileSize: result.fileSize,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        durationMs: result.timing?.totalMs,
        progress: 100,
      });

      this.logger.log(
        createLogMessage("Download task execution finished", {
          taskId: id,
          bvid: claimed.bvid,
          cid: claimed.cid,
          status: result.status,
          outputFile: result.outputFile,
          fileSize: result.fileSize,
          durationMs: result.timing?.totalMs,
          error: result.errorMessage,
        }),
      );
    } catch (err) {
      const msg = (err as Error).message;
      await this.db.updateTaskStatus(id, {
        status: TaskStatus.Failed,
        errorMessage: msg,
      });
      this.logger.error(
        createLogMessage("Download task execution failed", {
          taskId: id,
          bvid: claimed.bvid,
          cid: claimed.cid,
          error: msg,
        }),
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  /** 磁盘存在性校验（供分析编排层复用视频资源前确认文件真实存在） */
  async fileExists(path: string): Promise<boolean> {
    return this.fileStore.exists(path);
  }

  async getTaskById(id: number): Promise<TaskRecord | undefined> {
    return this.db.getTaskById(id);
  }

  private async loadCookieString(file: string): Promise<string | undefined> {
    try {
      const cookies = await this.authProvider.loadCookies(file);
      return this.authProvider.toCookieString(cookies);
    } catch {
      return undefined;
    }
  }
}

// ---------- Helpers ----------

function extractCodecName(codec: string): string {
  const c = codec.toLowerCase();
  if (c.includes("av01") || c.includes("av1")) return "AV1";
  if (c.includes("hev") || c.includes("hvc") || c.includes("hevc")) return "HEVC";
  if (c.includes("dvh") || c.includes("dolby")) return "Dolby Vision";
  return "AVC";
}

function qualityLabel(id: number): string {
  const labels: Record<number, string> = {
    127: "8K 超高清",
    120: "4K 超清",
    116: "1080P60 高帧率",
    112: "1080P+ 高码率",
    80: "1080P 高清",
    74: "720P60 高帧率",
    64: "720P 高清",
    32: "480P 清晰",
    16: "360P 流畅",
    6: "240P 极速",
  };
  return labels[id] ?? `画质${id}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function sanitizeOutputPath(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  return path
    .split(/[\\/]/)
    .map((seg) => seg.replace(/[<>:"|?*]/g, "_").replace(/^[. ]+|[. ]+$/g, ""))
    .filter(Boolean)
    .join(sep);
}

function toSubtitleLanguages(
  lang: string | null | undefined,
): "none" | "all" | string[] {
  if (!lang) return "none";
  switch (lang) {
    case "none":
      return "none";
    case "all":
      return "all";
    case "zh":
      return ["zh-CN"];
    case "en":
      return ["en-US"];
    default:
      return "none";
  }
}
