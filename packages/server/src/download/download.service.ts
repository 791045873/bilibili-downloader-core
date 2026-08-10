import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { createBilibiliSdkClient } from "@bilibili-downloader/adapters/bilibili";
import type { BilibiliSdkClient } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliResourceParser } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliStreamProvider } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliAuthProvider } from "@bilibili-downloader/adapters/bilibili-auth";
import { HttpDownloader } from "@bilibili-downloader/adapters/downloader";
import { FfmpegMerger } from "@bilibili-downloader/adapters/ffmpeg";
import { NodeFileStore } from "@bilibili-downloader/adapters/fs";
import { BilibiliSubtitleProvider } from "@bilibili-downloader/adapters/bilibili";
import {
  ResolutionService,
  DownloadExecutionUseCase,
} from "@bilibili-downloader/core/usecases";
import type { DownloadExecutionRequest } from "@bilibili-downloader/core/usecases";
import type { VideoInfo, UserInfo } from "@bilibili-downloader/core/ports";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import { DownloadEventType } from "@bilibili-downloader/core/events";
import type { ResolvedVideo } from "@bilibili-downloader/core/domain";
import { join, resolve } from "node:path";
import {
  DatabaseService,
  type PaginatedTaskResult,
  type TaskRecord,
  type TaskStatusGroup,
} from "../database/database.service.js";
import type { DownloadDto } from "./download.dto.js";
import { buildOutputFileName } from "./file-naming.js";
import { createLogMessage } from "../logging/server-log.util.js";

interface LowResDownloadResult {
  outputFile: string;
  quality: number;
}

// ---------- 公开类型（旧前端兼容） ----------

export interface TaskEntry {
  id: number;
  status: string;
  title?: string;
  outputFile?: string;
  fileSize?: number;
  error?: string;
  progress?: number;
  speed?: string;
  createdAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface ParseResultItem {
  cid: number;
  videoQualityList: { id: number; name: string; codecList: string[] }[];
  audioQualityList: string[];
}

// ---------- Service ----------

@Injectable()
export class DownloadService implements OnModuleInit {
  private readonly logger = new Logger(DownloadService.name);
  private readonly outputDir: string;
  private readonly cookieFile: string;

  private biliClient!: BilibiliSdkClient;
  private authProvider!: BilibiliAuthProvider;
  private resourceParser!: BilibiliResourceParser;
  private streamProvider!: BilibiliStreamProvider;

  // 新组件
  private resolutionService!: ResolutionService;
  private executionDeps!: any;
  private fileStore!: NodeFileStore;
  private merger!: FfmpegMerger;

  // 运行时任务状态缓存（用于快速查询）
  private readonly taskCache = new Map<number, TaskEntry>();

  // 中止控制器（用于 cancel 运行中的下载）
  private readonly abortControllers = new Map<number, AbortController>();

  // 下载执行完成后的回调（由 Scheduler 设置）
  onTaskFinished?: (taskId: number) => void;

  constructor(private readonly db: DatabaseService) {
    this.outputDir = process.env.OUTPUT_DIR ?? join(process.cwd(), "downloads");
    this.cookieFile =
      process.env.COOKIE_FILE || join(this.outputDir, ".cookies.json");
  }

  getDownloadConfig(): { outputDir: string; source: "env" | "default" } {
    return {
      outputDir: resolve(this.outputDir),
      source: process.env.OUTPUT_DIR ? "env" : "default",
    };
  }

  async onModuleInit(): Promise<void> {
    const cookieString = this.cookieFile
      ? await this.loadCookieString(this.cookieFile)
      : undefined;
    this.biliClient = createBilibiliSdkClient(cookieString);
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
      createLogMessage("Download service initialized", {
        outputPath: this.outputDir,
        fileExists: Boolean(cookieString),
      }),
    );
  }

  restoreTaskCacheFromDatabase(): void {
    const tasks = this.db.getTasks();
    this.taskCache.clear();

    for (const task of tasks) {
      if (task.id === undefined) {
        continue;
      }

      this.taskCache.set(task.id, {
        id: task.id,
        status: task.status,
        title: task.title,
        outputFile: task.outputFile,
        fileSize: task.fileSize,
        error: task.errorMessage,
        progress: task.progress,
        speed: task.speed,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
        durationMs: task.durationMs,
      });
    }

    this.logger.log(
      createLogMessage("Restored download task cache from database", {
        taskCount: this.taskCache.size,
      }),
    );
  }

  // ==================== 视频信息（使用 ResolutionService） ====================

  /** 获取视频元信息 + 分P列表 + 合集信息 */
  async getVideoInfo(input: string): Promise<ResolvedVideo> {
    return this.resolutionService.resolve(input, {
      cookieFile: this.cookieFile,
    });
  }

  /** 解析单个视频流，返回画质/编码选项 */
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

    return { cid, videoQualityList, audioQualityList: uniqueAudio };
  }

  /** 批量解析 */
  async parseAllVideos(
    bvid: string,
    cids: number[],
  ): Promise<ParseResultItem[]> {
    const results: ParseResultItem[] = [];
    for (const cid of cids) {
      results.push(await this.parseVideo(bvid, cid));
    }
    return results;
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

  /** 静默下载低分辨率视频（不进入任务队列，不写 taskCache） */
  async executeLowResDownload(
    bvid: string,
    cid: number,
    title: string,
  ): Promise<LowResDownloadResult> {
    this.logger.log(
      createLogMessage("Starting low resolution download", {
        bvid,
        cid,
        title,
      }),
    );

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

    if (
      streams.videoStreams.length === 0 ||
      streams.audioStreams.length === 0
    ) {
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

    const llmDir = process.env.ANALYSIS_LLM_VIDEO_DIR
      ? resolve(process.env.ANALYSIS_LLM_VIDEO_DIR)
      : join(this.outputDir, ".analysis-llm");
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

    return {
      outputFile: result.outputFile,
      quality: lowVideo.quality,
    };
  }

  // ==================== 下载任务 ====================

  /** 创建下载任务（仅落库，不执行，由 Scheduler 调度） */
  async createTask(dto: DownloadDto): Promise<{ id: number; message: string }> {
    const now = new Date().toISOString();
    const id = this.db.insertTask({
      bvid: dto.bvid,
      cid: dto.cid,
      title: dto.title,
      quality: dto.quality,
      codec: dto.codec,
      fileNameTemplate: dto.fileNameTemplate,
      outputPath: dto.outputPath,
      subtitleLang: dto.subtitleLang,
      autoSummary: dto.autoSummary ? 1 : 0,
      status: TaskStatus.Created,
      createdAt: now,
    });

    this.taskCache.set(id, {
      id,
      status: TaskStatus.Created,
      title: dto.title,
      createdAt: now,
    });

    this.logger.log(
      createLogMessage("Created download task", {
        taskId: id,
        bvid: dto.bvid,
        cid: dto.cid,
        quality: dto.quality,
        codec: dto.codec,
        autoSummary: dto.autoSummary,
        outputPath: dto.outputPath,
      }),
    );

    return { id, message: "任务已创建" };
  }

  /** 执行下载任务（由 Scheduler 调用） */
  async executeTask(task: TaskRecord): Promise<void> {
    const id = task.id!;
    const cached = this.taskCache.get(id);
    if (!cached) {
      this.logger.error(
        createLogMessage(
          "Download task execution aborted because cache entry is missing",
          {
            taskId: id,
            bvid: task.bvid,
            cid: task.cid,
          },
        ),
      );
      throw new Error(`任务 ${id} 不在缓存中`);
    }

    // 校验状态：只有 Created 或 Stopped 可进入 Downloading
    if (
      cached.status !== TaskStatus.Created &&
      cached.status !== TaskStatus.Stopped
    ) {
      this.logger.warn(
        createLogMessage(
          "Download task execution rejected due to invalid cached status",
          {
            taskId: id,
            bvid: task.bvid,
            cid: task.cid,
            status: cached.status,
          },
        ),
      );
      throw new Error(`任务 ${id} 状态为 ${cached.status}，无法执行`);
    }

    this.logger.log(
      createLogMessage("Starting download task execution", {
        taskId: id,
        bvid: task.bvid,
        cid: task.cid,
        requestedQuality: task.quality,
        requestedCodec: task.codec,
        outputPath: task.outputPath,
        autoSummary: task.autoSummary,
      }),
    );

    cached.status = TaskStatus.Downloading;
    cached.title = task.title ?? cached.title;
    this.db.updateTaskStatus(id, { status: TaskStatus.Downloading });

    try {
      const cookieString = this.cookieFile
        ? await this.loadCookieString(this.cookieFile)
        : undefined;

      // 解析资源
      const parsed = await this.resourceParser.parse(task.bvid!);
      const streams = await this.resolutionService.resolveStreams({
        bvid: task.bvid!,
        cid: task.cid!,
        resourceType: parsed.type,
        cookieString,
      });

      const videoStream = this.resolutionService.selectBestStream(
        streams.videoStreams,
        task.codec,
        task.quality,
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
          bvid: task.bvid,
          cid: task.cid,
          quality: videoStream.quality,
          codec: task.codec,
          availableQualityCount: streams.videoStreams.length,
        }),
      );

      // 构建输出路径
      const fileName = buildOutputFileName({
        title: task.title!,
        bvid: task.bvid!,
        cid: task.cid!,
        quality: videoStream.quality,
        codec: task.codec,
        template: task.fileNameTemplate,
      });
      const outputFile = task.outputPath
        ? join(this.outputDir, sanitizeOutputPath(task.outputPath), fileName)
        : join(this.outputDir, fileName);

      this.logger.log(
        createLogMessage("Resolved task output file", {
          taskId: id,
          bvid: task.bvid,
          cid: task.cid,
          quality: videoStream.quality,
          outputFile,
          hasOutputPath: Boolean(task.outputPath),
        }),
      );

      // 确保子目录存在
      if (task.outputPath) {
        await this.fileStore.ensureOutputDir(
          join(this.outputDir, sanitizeOutputPath(task.outputPath)),
        );
      }

      const executionUseCase = new DownloadExecutionUseCase(this.executionDeps);

      executionUseCase.on(
        DownloadEventType.DownloadProgress,
        (e: { percentage: number; speedBytesPerSec: number }) => {
          cached.progress = e.percentage;
          cached.speed = formatBytes(e.speedBytesPerSec) + "/s";
          this.db.updateTaskProgress(id, e.percentage, cached.speed);
        },
      );

      const request: DownloadExecutionRequest = {
        bvid: task.bvid!,
        cid: task.cid!,
        title: task.title!,
        outputFile,
        videoStream,
        audioStream,
        cookieString,
        subtitleLanguages: toSubtitleLanguages(task.subtitleLang),
      };

      const result = await executionUseCase.execute(request);

      cached.status = result.status;
      cached.outputFile = result.outputFile;
      cached.fileSize = result.fileSize;
      cached.error = result.errorMessage;
      cached.durationMs = result.timing?.totalMs;
      cached.completedAt = new Date().toISOString();

      this.db.updateTaskStatus(id, {
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
          bvid: task.bvid,
          cid: task.cid,
          status: result.status,
          outputFile: result.outputFile,
          fileSize: result.fileSize,
          durationMs: result.timing?.totalMs,
          error: result.errorMessage,
        }),
      );
    } catch (err) {
      const msg = (err as Error).message;
      cached.status = TaskStatus.Failed;
      cached.error = msg;

      this.db.updateTaskStatus(id, {
        status: TaskStatus.Failed,
        errorMessage: msg,
      });

      this.logger.error(
        createLogMessage("Download task execution failed", {
          taskId: id,
          bvid: task.bvid,
          cid: task.cid,
          error: msg,
        }),
        err instanceof Error ? err.stack : undefined,
      );
    } finally {
      this.abortControllers.delete(id);
      this.onTaskFinished?.(id);
    }
  }

  /** 停止任务：Created → Stopped */
  async stopTask(id: number): Promise<{ message: string }> {
    const cached = this.taskCache.get(id);
    if (!cached) throw new Error(`任务 ${id} 不存在`);
    if (cached.status !== TaskStatus.Created) {
      throw new Error(`任务 ${id} 状态为 ${cached.status}，无法停止`);
    }
    cached.status = TaskStatus.Stopped;
    this.db.updateTaskStatus(id, { status: TaskStatus.Stopped });
    this.logger.log(
      createLogMessage("Stopped queued download task", {
        taskId: id,
        status: TaskStatus.Stopped,
      }),
    );
    return { message: "已停止" };
  }

  /** 恢复任务：Stopped → Created */
  async resumeTask(id: number): Promise<{ message: string }> {
    const cached = this.taskCache.get(id);
    if (!cached) throw new Error(`任务 ${id} 不存在`);
    if (cached.status !== TaskStatus.Stopped) {
      throw new Error(`任务 ${id} 状态为 ${cached.status}，无法恢复`);
    }
    cached.status = TaskStatus.Created;
    this.db.updateTaskStatus(id, { status: TaskStatus.Created });
    this.logger.log(
      createLogMessage("Resumed queued download task", {
        taskId: id,
        status: TaskStatus.Created,
      }),
    );
    return { message: "已恢复" };
  }

  /** 中止正在执行的下载 */
  abortTask(id: number): void {
    this.logger.warn(
      createLogMessage("Abort requested for running download task", {
        taskId: id,
      }),
    );
    this.abortControllers.get(id)?.abort();
  }

  /** 获取任务列表（内存缓存） */
  getTasks(): TaskEntry[] {
    return Array.from(this.taskCache.values()).sort(
      (a, b) =>
        new Date(b.createdAt ?? "").getTime() -
        new Date(a.createdAt ?? "").getTime(),
    );
  }

  getTasksPaginated(params: {
    page: number;
    pageSize: number;
    statusGroup: TaskStatusGroup;
  }): PaginatedTaskResult {
    return this.db.listTasksPaginated(params);
  }

  /** 获取单个任务详情（从SQLite） */
  getTaskById(id: number): TaskRecord | undefined {
    return this.db.getTaskById(id);
  }

  /** 删除任务 */
  async deleteTask(id: number): Promise<{ message: string }> {
    this.taskCache.delete(id);
    this.db.deleteTask(id);
    this.logger.log(
      createLogMessage("Deleted download task", {
        taskId: id,
      }),
    );
    return { message: "已删除" };
  }

  /** 清空所有任务 */
  async clearTasks(): Promise<{ message: string }> {
    const taskCount = this.taskCache.size;
    this.taskCache.clear();
    this.db.clearTasks();
    this.logger.log(
      createLogMessage("Cleared all download tasks", {
        taskCount,
      }),
    );
    return { message: "已清空" };
  }

  // ==================== 认证 ====================

  async getQrCode() {
    return this.authProvider.generateQrCode();
  }

  async pollQrStatus(key: string) {
    return this.authProvider.pollQrStatus(key);
  }

  async confirmLogin(callbackUrl: string) {
    const cookies = this.authProvider.extractCookies(callbackUrl);
    const cookieFile = join(this.outputDir, ".cookies.json");
    await this.authProvider.saveCookies(cookies, cookieFile);
    const cookieString = this.authProvider.toCookieString(cookies);
    this.biliClient.setCookieString(cookieString);
    return { message: "登录成功" };
  }

  async getUserInfo(): Promise<UserInfo | null> {
    const cookieString = this.cookieFile
      ? await this.loadCookieString(this.cookieFile)
      : undefined;
    if (!cookieString) return null;
    return this.authProvider.getUserInfo(cookieString);
  }

  // ==================== 图片代理 ====================

  /**
   * 代理 B站静态图片（绕过防盗链）
   * 浏览器端无法在 <img> 上加 Referer 请求头，通过服务端代理转发
   */
  async proxyBilibiliImage(
    url: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    const normalizedUrl = this.normalizeBilibiliImageUrl(url);
    const response = await fetch(normalizedUrl, {
      headers: {
        Referer: "https://www.bilibili.com",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!response.ok) {
      throw new Error(`获取封面失败: HTTP ${response.status}`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    return { data, contentType };
  }

  private normalizeBilibiliImageUrl(url: string): string {
    const normalized = url.startsWith("//") ? `https:${url}` : url;

    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      throw new Error("无效的图片地址");
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("不支持的图片协议");
    }

    if (!this.isAllowedBilibiliImageHost(parsed.hostname)) {
      throw new Error("仅支持代理哔哩哔哩静态图片资源");
    }

    return parsed.toString();
  }

  private isAllowedBilibiliImageHost(hostname: string): boolean {
    return ["hdslb.com", "biliimg.com"].some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  }

  // ==================== 工具 ====================

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
  if (c.includes("hev") || c.includes("hvc") || c.includes("hevc"))
    return "HEVC";
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

/**
 * 格式化输出子路径：保留 / \ 作为路径分隔符，清理其他非法字符。
 * 例如 "a/b" → "a/b"，"a<b" → "a_b"
 * 注意：清理后会在各段首尾去掉多余空格与点，防止 Windows 坑。
 */
function sanitizeOutputPath(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  return path
    .split(/[\\/]/)
    .map((seg) => seg.replace(/[<>:"|?*]/g, "_").replace(/^[. ]+|[. ]+$/g, ""))
    .filter(Boolean)
    .join(sep);
}

/**
 * 将数据库中存储的字幕语言选择转换为 Core 层 subtitleLanguages
 * "none" | "zh" | "en" | "all" → "none" | "all" | string[]
 */
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
