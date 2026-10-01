import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { createBilibiliSdkClient } from "@bilibili-downloader/adapters/bilibili";
import type { BilibiliSdkClient } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliResourceParser } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliStreamProvider } from "@bilibili-downloader/adapters/bilibili";
import { FileCacheStore } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliAuthProvider } from "@bilibili-downloader/adapters/bilibili-auth";
import { ResolutionService } from "@bilibili-downloader/core/usecases";
import type { UserInfo } from "@bilibili-downloader/core/ports";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import type { ResolvedVideo } from "@bilibili-downloader/core/domain";
import {
  DatabaseService,
  type PaginatedTaskResult,
  type TaskRecord,
  type TaskStatusGroup,
  createLogMessage,
} from "@bilibili-downloader/server-common";
import type { DownloadDto } from "./download.dto.js";
import { decideCreateDedupVerdict } from "./create-dedup.js";
import { resolveCloudBiliApiCacheDir } from "../config/bili-cache.js";

export type CreateTaskResult =
  | { created: true; id: number; message: string }
  | { created: false; message: string };

export interface ParseResultItem {
  cid: number;
  videoQualityList: { id: number; name: string; codecList: string[] }[];
  audioQualityList: string[];
  resourceType?: string;
}

/**
 * 下载任务 cloud 半（创建/校验/读查询/停恢删 + B 站解析/扫码/图片代理）。
 *
 * 物理隔离：**不含** ffmpeg / HttpDownloader / NodeFileStore / 媒体路径 join；
 * 执行面（executeTask / executeLowResDownload / resolveBestVideoStream / fileExists）
 * 在 nas-worker 的 `DownloadExecutorService`。
 */
@Injectable()
export class DownloadTaskService implements OnModuleInit {
  private readonly logger = new Logger(DownloadTaskService.name);
  private readonly cacheDir: string;

  private biliClient!: BilibiliSdkClient;
  private authProvider!: BilibiliAuthProvider;
  private resourceParser!: BilibiliResourceParser;
  private streamProvider!: BilibiliStreamProvider;
  private resolutionService!: ResolutionService;

  private cookieString?: string;
  private cookieVersion = 0;

  constructor(private readonly db: DatabaseService) {
    this.cacheDir = resolveCloudBiliApiCacheDir();
  }

  getDownloadConfig(): { outputDir: string } {
    // 云端无媒体根目录：仅回显配置字符串（不 resolve/join 磁盘媒体路径）。
    return { outputDir: process.env.OUTPUT_DIR ?? "" };
  }

  async onModuleInit(): Promise<void> {
    const { cookie, version } = await this.db.getBiliCookie();
    this.cookieString = cookie;
    this.cookieVersion = version;
    this.biliClient = createBilibiliSdkClient(cookie, {
      cacheStore: new FileCacheStore(this.cacheDir),
    });
    this.authProvider = new BilibiliAuthProvider();
    this.resourceParser = new BilibiliResourceParser();
    this.streamProvider = new BilibiliStreamProvider(this.biliClient);
    this.resolutionService = new ResolutionService(
      this.resourceParser,
      this.streamProvider,
      this.authProvider,
    );
    this.logger.log(
      createLogMessage("Download task service (cloud) initialized", {
        hasCookie: Boolean(cookie),
        cookieVersion: version,
      }),
    );
  }

  // ==================== 视频信息 / 解析 ====================

  async getVideoInfo(input: string): Promise<ResolvedVideo> {
    await this.refreshCookieIfChanged();
    return this.resolutionService.resolve(input);
  }

  async parseVideo(bvid: string, cid: number): Promise<ParseResultItem> {
    await this.refreshCookieIfChanged();
    const parsed = await this.resourceParser.parse(bvid);
    const cookieString = this.cookieString;

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

  async parseAllVideos(bvid: string, cids: number[]): Promise<ParseResultItem[]> {
    const results: ParseResultItem[] = [];
    for (const cid of cids) {
      results.push(await this.parseVideo(bvid, cid));
    }
    return results;
  }

  // ==================== 下载任务（创建/校验/读查询/停恢删） ====================

  /** 创建下载任务（仅落库，不执行）。纯 DB 去重：存在排队/下载中任务或已成功时拒绝。 */
  async createTask(dto: DownloadDto): Promise<CreateTaskResult> {
    if (dto.bvid && typeof dto.cid === "number") {
      const verdict = await this.evaluateCreateDedup(dto.bvid, dto.cid);
      if (verdict.block) {
        this.logger.log(
          createLogMessage("Download task creation blocked by dedup gate", {
            bvid: dto.bvid,
            cid: dto.cid,
            reason: verdict.message,
          }),
        );
        return { created: false, message: verdict.message ?? "重复任务已拦截" };
      }
    }

    const now = new Date().toISOString();
    const id = await this.db.insertTask({
      bvid: dto.bvid,
      cid: dto.cid,
      title: dto.title,
      quality: dto.quality,
      codec: dto.codec,
      fileNameTemplate: dto.fileNameTemplate,
      outputPath: dto.outputPath,
      subtitleLang: dto.subtitleLang,
      autoSummary: dto.autoSummary ? 1 : 0,
      promptId: dto.promptId,
      status: TaskStatus.Created,
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
        promptId: dto.promptId,
        outputPath: dto.outputPath,
      }),
    );

    return { created: true, id, message: "任务已创建" };
  }

  /** 入队去重判定（纯 DB）：active 任务存在，或已有 success 任务则拦截。 */
  private async evaluateCreateDedup(
    bvid: string,
    cid: number,
  ): Promise<{ block: boolean; message?: string }> {
    const active = await this.db.findActiveTaskByBvidAndCid(bvid, cid);
    const completed = active
      ? undefined
      : await this.db.findCompletedTaskByBvidAndCid(bvid, cid);
    return decideCreateDedupVerdict({
      activeTaskExists: Boolean(active),
      completedTaskExists: Boolean(completed),
    });
  }

  /** 停止任务：Created → Stopped（读 DB 守卫） */
  async stopTask(id: number): Promise<{ message: string }> {
    const task = await this.db.getTaskById(id);
    if (!task) throw new Error(`任务 ${id} 不存在`);
    if (task.status !== TaskStatus.Created) {
      throw new Error(`任务 ${id} 状态为 ${task.status}，无法停止`);
    }
    await this.db.updateTaskStatus(id, { status: TaskStatus.Stopped });
    this.logger.log(
      createLogMessage("Stopped queued download task", {
        taskId: id,
        status: TaskStatus.Stopped,
      }),
    );
    return { message: "已停止" };
  }

  /** 恢复任务：Stopped → Created（读 DB 守卫） */
  async resumeTask(id: number): Promise<{ message: string }> {
    const task = await this.db.getTaskById(id);
    if (!task) throw new Error(`任务 ${id} 不存在`);
    if (task.status !== TaskStatus.Stopped) {
      throw new Error(`任务 ${id} 状态为 ${task.status}，无法恢复`);
    }
    await this.db.updateTaskStatus(id, { status: TaskStatus.Created });
    this.logger.log(
      createLogMessage("Resumed queued download task", {
        taskId: id,
        status: TaskStatus.Created,
      }),
    );
    return { message: "已恢复" };
  }

  async getTasksPaginated(params: {
    page: number;
    pageSize: number;
    statusGroup: TaskStatusGroup[];
  }): Promise<PaginatedTaskResult> {
    return this.db.listTasksPaginated(params);
  }

  async getTaskById(id: number): Promise<TaskRecord | undefined> {
    return this.db.getTaskById(id);
  }

  async deleteTask(id: number): Promise<{ message: string }> {
    await this.db.deleteTask(id);
    this.logger.log(createLogMessage("Deleted download task", { taskId: id }));
    return { message: "已删除" };
  }

  async clearTasks(): Promise<{ message: string }> {
    await this.db.clearTasks();
    this.logger.log(createLogMessage("Cleared all download tasks", {}));
    return { message: "已清空" };
  }

  // ==================== 认证（B 站扫码登录） ====================

  async getQrCode() {
    return this.authProvider.generateQrCode();
  }

  async pollQrStatus(key: string) {
    return this.authProvider.pollQrStatus(key);
  }

  async confirmLogin(callbackUrl: string) {
    const cookies = this.authProvider.extractCookies(callbackUrl);
    const cookieString = this.authProvider.toCookieString(cookies);
    await this.persistCookie(cookieString);
    return { message: "登录成功" };
  }

  /** 手动粘贴 cookie 入口：物化真源 + 刷新本进程 SDK + 更新版本缓存。 */
  async setCookieManually(cookie: string): Promise<void> {
    await this.persistCookie(cookie);
  }

  async getUserInfo(): Promise<UserInfo | null> {
    await this.refreshCookieIfChanged();
    if (!this.cookieString) return null;
    return this.authProvider.getUserInfo(this.cookieString);
  }


  // ==================== 图片代理（含 SSRF 白名单） ====================

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

  /** 写入 cookie 真源并同步本进程 SDK 与版本缓存（扫码登录 / 手动粘贴共用）。 */
  private async persistCookie(cookieString: string): Promise<void> {
    const version = await this.db.setBiliCookie(cookieString);
    this.biliClient.setCookieString(cookieString);
    this.cookieString = cookieString ? cookieString : undefined;
    this.cookieVersion = version;
  }

  /** 对外使用 biliClient 前按版本刷新：版本未变不动，变化则重取并刷新 SDK。 */
  private async refreshCookieIfChanged(): Promise<void> {
    const version = await this.db.getBiliCookieVersion();
    if (version === this.cookieVersion) return;
    const { cookie, version: latest } = await this.db.getBiliCookie();
    this.biliClient.setCookieString(cookie);
    this.cookieString = cookie;
    this.cookieVersion = latest;
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
