import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Logger,
  NotFoundException,
  Post,
} from "@nestjs/common";
import { isAbsolute, join } from "node:path";
import { AnalysisEngine, type AnalysisInput } from "./analysis-engine.js";
import type { LlmConfig } from "@bilibili-downloader/adapters/llm";
import type { VideoPage } from "@bilibili-downloader/core/ports";
import { DefaultScreenshotSourceResolver } from "./screenshot-source-resolver.js";
import { DatabaseService } from "../database/database.service.js";
import { AnalysisTriggerService } from "./analysis-trigger.service.js";
import { DownloadScheduler } from "../download/download-scheduler.js";
import { DownloadService } from "../download/download.service.js";

interface AnalysisRequest {
  /** LLM 分析用视频文件绝对路径（低分辨率或唯一可用分辨率） */
  videoPath: string;
  /** 字幕文件绝对路径，可选（无字幕时不传） */
  subtitlePath?: string;
  /** 视频标题 */
  videoTitle: string;
  /** 视频元数据 */
  metadata: {
    type: "bilibili" | "local";
    videoUrl?: string;
    bvid?: string;
    cid?: number;
  };
  /** 截图用视频路径（高分辨率）。不传时走 ScreenshotSourceResolver 降级逻辑 */
  screenshotVideoPath?: string;
}

@Controller("api/analysis")
export class AnalysisController {
  private readonly logger = new Logger(AnalysisController.name);

  constructor(
    private readonly screenshotSourceResolver: DefaultScreenshotSourceResolver,
    private readonly analysisTriggerService: AnalysisTriggerService,
    private readonly databaseService: DatabaseService,
    private readonly downloadScheduler: DownloadScheduler,
    private readonly downloadService: DownloadService,
  ) {}

  @Post("/run")
  async runAnalyze(@Body() body: AnalysisRequest) {
    validateRequest(body);
    const input: AnalysisInput = {
      videoPath: body.videoPath,
      subtitlePath: body.subtitlePath,
      summaryDir: join(process.cwd(), "summaryDir"),
      videoTitle: body.videoTitle,
      metadata: body.metadata,
      screenshotVideoPath: body.screenshotVideoPath,
    };
    const engine = new AnalysisEngine(
      this.getLlmConfig(),
      undefined,
      this.screenshotSourceResolver,
    );
    return engine.analyze(input);
  }

  @Post("/trigger")
  async triggerAiSummary(@Body() body: { bvid?: string; cid?: number }) {
    if (!body?.bvid || typeof body.cid !== "number") {
      throw new BadRequestException("bvid/cid 必填");
    }

    const task = this.databaseService.findLatestTaskByBvidAndCid(
      body.bvid,
      body.cid,
    );
    if (!task) {
      const created = await this.createOneClickAiSummaryTask(
        body.bvid,
        body.cid,
      );
      return {
        message: `${created.message}，下载完成后将自动触发 AI 总结`,
      };
    }
    if (task.autoSummary) {
      throw new ConflictException("该任务已开启 AI 总结");
    }

    this.databaseService.updateTaskStatus(task.id!, {
      status: task.status,
      autoSummary: 1,
    });

    await this.analysisTriggerService.trigger(task.id!);
    return { message: "AI 总结触发中" };
  }

  private async createOneClickAiSummaryTask(bvid: string, cid: number) {
    try {
      const [resolvedVideo, parsed] = await Promise.all([
        this.downloadService.getVideoInfo(bvid),
        this.downloadService.parseVideo(bvid, cid),
      ]);

      const highestQuality = parsed.videoQualityList[0];
      const lowestQuality = parsed.videoQualityList.at(-1);
      if (!highestQuality) {
        throw new Error("无法获取可用清晰度");
      }

      const title = this.buildTaskTitle(
        resolvedVideo.videoInfo.title,
        resolvedVideo.videoInfo.pages,
        cid,
      );

      const created = await this.downloadScheduler.createDownload({
        bvid,
        cid,
        title,
        quality: highestQuality.id,
        codec: highestQuality.codecList[0],
        autoSummary: true,
      });

      if (
        lowestQuality &&
        parsed.videoQualityList.length > 1 &&
        lowestQuality.id !== highestQuality.id
      ) {
        this.scheduleInitialLowResDownload({
          taskId: created.id,
          bvid,
          cid,
          title,
          quality: lowestQuality.id,
        });
      }

      return created;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadGatewayException(`创建 AI 总结下载任务失败: ${msg}`);
    }
  }

  private scheduleInitialLowResDownload(input: {
    taskId: number;
    bvid: string;
    cid: number;
    title: string;
    quality: number;
  }): void {
    try {
      const analysisSubTaskId = this.databaseService.insertAnalysisSubTask({
        taskId: input.taskId,
        bvid: input.bvid,
        cid: input.cid,
        quality: input.quality,
        status: "created",
        createdAt: new Date().toISOString(),
      });

      this.downloadScheduler.scheduleLowResDownload({
        taskId: input.taskId,
        analysisSubTaskId,
        bvid: input.bvid,
        cid: input.cid,
        title: input.title,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `预创建低清分析子任务失败: task=${input.taskId}, ${msg}`,
      );
    }
  }

  private buildTaskTitle(
    mainTitle: string,
    pages: VideoPage[],
    cid: number,
  ): string {
    const matchedPage = pages.find((page) => page.cid === cid);
    if (!matchedPage || pages.length <= 1) {
      return mainTitle;
    }
    return `${mainTitle} P${matchedPage.page}`;
  }

  private getLlmConfig(): LlmConfig {
    const apiKey = process.env.QWEN_API_KEY;
    const baseUrl = process.env.QWEN_API_BASE;
    const modelName = process.env.QWEN_MODEL;
    const visionProxyUrl = process.env.QWEN_VISION_PROXY_URL;
    const visionModelName = process.env.QWEN_VISION_MODEL;

    if (!apiKey) {
      throw new BadRequestException("缺少环境变量 QWEN_API_KEY");
    }
    if (!baseUrl) {
      throw new BadRequestException("缺少环境变量 QWEN_API_BASE");
    }
    if (!modelName) {
      throw new BadRequestException("缺少环境变量 QWEN_MODEL");
    }

    return {
      apiKey,
      baseUrl,
      modelName,
      visionProxyUrl,
      visionModelName,
    };
  }
}

function validateRequest(body: AnalysisRequest): void {
  if (typeof body.videoPath !== "string" || !isAbsolute(body.videoPath)) {
    throw new BadRequestException("videoPath 必填且必须为绝对路径");
  }
  if (
    typeof body.videoTitle !== "string" ||
    body.videoTitle.trim().length === 0
  ) {
    throw new BadRequestException("videoTitle 必填且不能为空字符串");
  }
  if (body.subtitlePath !== undefined) {
    if (
      typeof body.subtitlePath !== "string" ||
      !isAbsolute(body.subtitlePath)
    ) {
      throw new BadRequestException("subtitlePath 如传入必须为绝对路径");
    }
  }
  if (body.screenshotVideoPath !== undefined) {
    if (
      typeof body.screenshotVideoPath !== "string" ||
      !isAbsolute(body.screenshotVideoPath)
    ) {
      throw new BadRequestException("screenshotVideoPath 如传入必须为绝对路径");
    }
  }
  if (body.metadata === null || typeof body.metadata !== "object") {
    throw new BadRequestException("metadata 必填");
  }
  if (body.metadata.type !== "bilibili" && body.metadata.type !== "local") {
    throw new BadRequestException("metadata.type 必须为 bilibili 或 local");
  }
  if (body.metadata.type === "bilibili") {
    if (
      typeof body.metadata.videoUrl !== "string" ||
      body.metadata.videoUrl.trim().length === 0
    ) {
      throw new BadRequestException(
        "metadata.type=bilibili 时 videoUrl 必填且非空",
      );
    }
    if (
      typeof body.metadata.bvid !== "string" ||
      body.metadata.bvid.trim().length === 0
    ) {
      throw new BadRequestException(
        "metadata.type=bilibili 时 bvid 必填且非空",
      );
    }
    if (
      typeof body.metadata.cid !== "number" ||
      !Number.isFinite(body.metadata.cid)
    ) {
      throw new BadRequestException(
        "metadata.type=bilibili 时 cid 必填且为数字",
      );
    }
  }
}
