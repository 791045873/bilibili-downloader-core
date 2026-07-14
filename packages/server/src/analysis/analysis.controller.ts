import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { isAbsolute, join } from "node:path";
import { AnalysisEngine, type AnalysisInput } from "./analysis-engine.js";
import type { LlmConfig } from "@bilibili-downloader/adapters/llm";
import { DefaultScreenshotSourceResolver } from "./screenshot-source-resolver.js";

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
  constructor(private readonly screenshotSourceResolver: DefaultScreenshotSourceResolver) {}

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
  if (typeof body.videoTitle !== "string" || body.videoTitle.trim().length === 0) {
    throw new BadRequestException("videoTitle 必填且不能为空字符串");
  }
  if (body.subtitlePath !== undefined) {
    if (typeof body.subtitlePath !== "string" || !isAbsolute(body.subtitlePath)) {
      throw new BadRequestException("subtitlePath 如传入必须为绝对路径");
    }
  }
  if (body.screenshotVideoPath !== undefined) {
    if (typeof body.screenshotVideoPath !== "string" || !isAbsolute(body.screenshotVideoPath)) {
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
    if (typeof body.metadata.videoUrl !== "string" || body.metadata.videoUrl.trim().length === 0) {
      throw new BadRequestException("metadata.type=bilibili 时 videoUrl 必填且非空");
    }
    if (typeof body.metadata.bvid !== "string" || body.metadata.bvid.trim().length === 0) {
      throw new BadRequestException("metadata.type=bilibili 时 bvid 必填且非空");
    }
    if (typeof body.metadata.cid !== "number" || !Number.isFinite(body.metadata.cid)) {
      throw new BadRequestException("metadata.type=bilibili 时 cid 必填且为数字");
    }
  }
}
