import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { createBilibiliWebClient } from "@bilibili-downloader/adapters/bilibili";
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
  type TaskRecord,
} from "../database/database.service.js";
import type { DownloadDto } from "./download.dto.js";

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

  private webClient: any;
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
    this.webClient = createBilibiliWebClient({ cookieString });
    this.fileStore = new NodeFileStore();
    this.merger = new FfmpegMerger();

    await this.fileStore.ensureOutputDir(this.outputDir);

    if (!(await this.merger.isAvailable())) {
      this.logger.error("ffmpeg 未安装，下载后无法合并!");
    }

    this.authProvider = new BilibiliAuthProvider();
    this.resourceParser = new BilibiliResourceParser(this.webClient);
    this.streamProvider = new BilibiliStreamProvider(this.webClient);

    this.resolutionService = new ResolutionService(
      this.resourceParser,
      this.streamProvider,
      this.authProvider,
    );

    this.executionDeps = {
      mediaDownloader: new HttpDownloader(),
      mediaMerger: this.merger,
      fileStore: this.fileStore,
      subtitleProvider: new BilibiliSubtitleProvider(this.webClient),
    };
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
      outputPath: dto.outputPath,
      subtitleLang: dto.subtitleLang,
      status: TaskStatus.Created,
      createdAt: now,
    });

    this.taskCache.set(id, {
      id,
      status: TaskStatus.Created,
      title: dto.title,
      createdAt: now,
    });

    return { id, message: "任务已创建" };
  }

  /** 执行下载任务（由 Scheduler 调用） */
  async executeTask(task: TaskRecord): Promise<void> {
    const id = task.id!;
    const cached = this.taskCache.get(id);
    if (!cached) {
      throw new Error(`任务 ${id} 不在缓存中`);
    }

    // 校验状态：只有 Created 或 Stopped 可进入 Downloading
    if (
      cached.status !== TaskStatus.Created &&
      cached.status !== TaskStatus.Stopped
    ) {
      throw new Error(`任务 ${id} 状态为 ${cached.status}，无法执行`);
    }

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

      // 构建输出路径
      const fileName = `${sanitizeFileName(task.title!)}.mp4`;
      const outputFile = task.outputPath
        ? join(this.outputDir, sanitizeOutputPath(task.outputPath), fileName)
        : join(this.outputDir, fileName);

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
    } catch (err) {
      const msg = (err as Error).message;
      cached.status = TaskStatus.Failed;
      cached.error = msg;

      this.db.updateTaskStatus(id, {
        status: TaskStatus.Failed,
        errorMessage: msg,
      });
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
    return { message: "已恢复" };
  }

  /** 中止正在执行的下载 */
  abortTask(id: number): void {
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

  /** 获取单个任务详情（从SQLite） */
  getTaskById(id: number): TaskRecord | undefined {
    return this.db.getTaskById(id);
  }

  /** 删除任务 */
  async deleteTask(id: number): Promise<{ message: string }> {
    this.taskCache.delete(id);
    this.db.deleteTask(id);
    return { message: "已删除" };
  }

  /** 清空所有任务 */
  async clearTasks(): Promise<{ message: string }> {
    this.taskCache.clear();
    this.db.clearTasks();
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
    this.webClient.setCookieString(cookieString);
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
   * 代理 B站图片（绕过防盗链）
   * 浏览器端无法在 <img> 上加 Referer 请求头，通过服务端代理转发
   */
  async proxyCoverImage(
    url: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    const response = await fetch(url, {
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

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_");
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
    case "none": return "none";
    case "all": return "all";
    case "zh": return ["zh-CN"];
    case "en": return ["en-US"];
    default: return "none";
  }
}
