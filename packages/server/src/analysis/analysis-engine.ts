/**
 * 视频内容分析引擎
 *
 * 核心编排流程：
 *   字幕解析 → LLM 分析视频和字幕 → 按模型返回时间戳截图 → 生成文档
 *
 * 也支持"基于已存储 LLM 返回内容重建"（rebuild）：跳过 LLM 与字幕，
 * 仅用 raw_response + 视频文件重建截图与 Markdown 报告（不依赖 LLM 配置）。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { Logger } from "@nestjs/common";
import {
  parseSrtFile,
  type SrtEntry,
} from "@bilibili-downloader/adapters/parser";
import { FfmpegScreenshot } from "@bilibili-downloader/adapters/ffmpeg";
import {
  QwenClient,
  type LlmConfig,
  type MultimodalContent,
} from "@bilibili-downloader/adapters/llm";
import { generateMarkdown, type DocumentInput } from "./document-generator.js";
import type { ScreenshotSourceResolver } from "./analysis-video-resolver.js";
import { transTimestampToSeconds } from "./timestamp.js";
import { createLogMessage } from "../logging/server-log.util.js";

function formatSubtitleEntry(entry: SrtEntry): string {
  return `[${entry.index}] ${entry.text}`;
}

export interface AnalysisInput {
  /** LLM 分析用视频文件路径（低分辨率或唯一可用分辨率） */
  videoPath: string;
  /** SRT 字幕文件路径，可选（无字幕时不传） */
  subtitlePath?: string;
  /** summary 输出目录（如 summary/{title}/） */
  summaryDir: string;
  /** 视频标题（用于文档标题） */
  videoTitle: string;
  /** 视频元数据 */
  metadata: {
    /** 视频来源类型 */
    type: "bilibili" | "local";
    /** 视频在平台上的完整 URL；type=bilibili 时必填；type=local 时不关心 */
    videoUrl?: string;
    /** B 站视频 ID；type=bilibili 时必填 */
    bvid?: string;
    /** B 站分 P ID；type=bilibili 时必填 */
    cid?: number;
  };
  /** 截图用视频路径（高分辨率）。不传时走 ScreenshotSourceResolver 降级逻辑（见 3b plan） */
  screenshotVideoPath?: string;
}

export interface AnalysisOutput {
  /** 生成的 Markdown 文件路径 */
  summaryPath: string;
  /** 所有截图文件路径 */
  screenshotFiles: string[];
  /** 分析的段落数 */
  segmentCount: number;
  /** 是否为空内容文档 */
  emptySummary: boolean;
  /** 执行耗时明细（LLM 分析 / 截图 / 总计，毫秒） */
  timing: { llmMs: number; screenshotMs: number; totalMs: number };
  /** LLM 模型接口成功返回的原始 content 原文 */
  rawResponse: string;
  /** 实际使用的模型名称 */
  modelName: string;
}

/** LLM #1 响应结构：视频与字幕分析 */
interface SubtitleAnalysis {
  summary: Array<{
    title: string;
    content: string;
    timestamp: string;
    frameDescription: string;
  }>;
}

/** 构建字幕分析的系统 Prompt */
function buildAnalysisSystemPrompt(): string {
  return [
    "你是一个熟练掌握各种穿搭技巧的专业人士,并且非常擅长于使用简单直白的语言，向大众介绍穿搭技巧。" +
      "这是一个穿搭博主的教学视频和该视频对应的文本内容。" +
      "博主在这个视频中讲述了自己关于穿搭方面的技巧与思路，并向观众展示了真实的穿搭例子。" +
      "请你完整、仔细地从视频与文本中总结这些技巧与思路，并给出其对应的展示案例在视频中的时间戳。" +
      "你的总结应当使用最直白、最朴实的大白话写出来，就像你在手把手教一个完全不懂穿搭的朋友。" +
      "并且严格遵循以下要求：" +
      "- 一条技巧说一个点，不要混在一起。" +
      "- 每个技巧必须说明：是什么、为什么有效、具体怎么穿。" +
      "请严格按照 JSON 格式输出，格式如下：" +
      "{summary: Array<{title: string, content: string, timestamp: string, frameDescription: string}>}" +
      "summary中的title是总结的穿搭技巧或思路的标题, content是穿搭技巧或思路的具体内容, timestamp是对应的展示案例的时间戳(格式为hh:mm:ss,例如00:02:30代表2分20秒), frameDescription是该时间戳画面的文本描述" +
      "有可能某一个穿搭技巧、思路的实际展示持续了较长时间，请你从其中选择最能展现该穿搭技巧、思路的时刻记录为时间戳。" +
      "请特别注意，这个时间戳所对应的视频帧应当是清晰的。该视频帧中的人物向观众展示自己的穿搭思路，人物应当是直面观众，眼神注视观众，且展示内容无遮挡、无扭曲、无模糊。",
  ].join("\n");
}

export class AnalysisEngine {
  private readonly logger = new Logger(AnalysisEngine.name);
  private readonly llmConfig?: LlmConfig;
  private readonly httpClient?: typeof fetch;
  private llmClient?: QwenClient;
  private readonly screenshotter: FfmpegScreenshot;
  private readonly screenshotSourceResolver?: ScreenshotSourceResolver;

  constructor(
    llmConfig?: LlmConfig,
    httpClient?: typeof fetch,
    screenshotSourceResolver?: ScreenshotSourceResolver,
  ) {
    this.llmConfig = llmConfig;
    this.httpClient = httpClient;
    this.screenshotter = new FfmpegScreenshot();
    this.screenshotSourceResolver = screenshotSourceResolver;
  }

  private ensureLlmClient(): QwenClient {
    if (!this.llmClient) {
      if (!this.llmConfig) {
        throw new Error("缺少 LLM 配置：QWEN_API_KEY/QWEN_API_BASE/QWEN_MODEL");
      }
      this.llmClient = new QwenClient(this.llmConfig, this.httpClient);
    }
    return this.llmClient;
  }

  async analyze(input: AnalysisInput): Promise<AnalysisOutput> {
    this.logger.log(
      createLogMessage("Analysis engine started", {
        bvid: input.metadata.bvid,
        cid: input.metadata.cid,
        videoPath: input.videoPath,
        subtitlePath: input.subtitlePath,
        summaryDir: input.summaryDir,
        hasSubtitle: Boolean(input.subtitlePath),
        hasScreenshotVideoPath: Boolean(input.screenshotVideoPath),
        sourceType: input.metadata.type,
      }),
    );

    const analysisStartMs = Date.now();
    let llmMs = 0;
    let llmRawResponse = "";
    let llmModelName = "";

    // 1. 解析字幕（可选：subtitlePath 未传或文件不存在时跳过，仅传视频给 LLM）
    let fullSubtitleText = "";
    if (input.subtitlePath !== undefined && existsSync(input.subtitlePath)) {
      const srtEntries = await parseSrtFile(input.subtitlePath);
      fullSubtitleText = srtEntries.map(formatSubtitleEntry).join("\n");
      this.logger.log(
        createLogMessage("Loaded subtitle file for analysis", {
          bvid: input.metadata.bvid,
          cid: input.metadata.cid,
          subtitlePath: input.subtitlePath,
        }),
      );
    }

    const llmClient = this.ensureLlmClient();
    if (!llmClient.usesVisionProxy()) {
      throw new Error(
        "视频分析需要配置 QWEN_VISION_PROXY_URL，以便通过 Python 薄代理读取本地视频文件",
      );
    }

    // 2. LLM: 视频 + 字幕分析，直接返回用于截图的时间戳
    const llmStartMs = Date.now();
    let analysis: SubtitleAnalysis;
    try {
      const userContent: MultimodalContent[] = [
        { type: "video_url", video_url: { url: input.videoPath } },
      ];
      if (fullSubtitleText.length > 0) {
        userContent.push({ type: "text", text: fullSubtitleText });
      }
      const llmResult = await llmClient.multimodalChat({
        model: "",
        stream: false,
        enable_thinking: false,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildAnalysisSystemPrompt() },
          {
            role: "user",
            content: userContent,
          },
        ],
      });
      analysis = llmResult.data as unknown as SubtitleAnalysis;
      llmMs = Date.now() - llmStartMs;
      llmRawResponse = llmResult.rawContent;
      llmModelName = llmResult.model;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        createLogMessage("LLM multimodal analysis failed", {
          bvid: input.metadata.bvid,
          cid: input.metadata.cid,
          videoPath: input.videoPath,
          error: message,
        }),
        err instanceof Error ? err.stack : undefined,
      );
      throw new Error(
        `LLM 多模态分析失败（需先启动 Python 视觉代理服务，并确保 QWEN_VISION_PROXY_URL 可访问）: ${message}`,
        err instanceof Error ? { cause: err } : undefined,
      );
    }

    // 3. LLM 之后：规范化、截图、生成文档
    return this.buildOutput(
      input,
      analysis,
      llmRawResponse,
      llmModelName,
      llmMs,
      analysisStartMs,
    );
  }

  /**
   * 基于已存储的 LLM 返回内容重建总结（不调用 LLM、不解析字幕）。
   * rawResponse 为模型返回的 content 原文（成功时已由 analyze 存储，为可解析 JSON）。
   */
  async rebuild(
    input: AnalysisInput,
    rawResponse: string,
    modelName: string,
  ): Promise<AnalysisOutput> {
    let analysis: SubtitleAnalysis;
    try {
      analysis = JSON.parse(rawResponse) as unknown as SubtitleAnalysis;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`存储的原始返回不是有效 JSON，无法重新构建: ${message}`);
    }
    this.logger.log(
      createLogMessage("Analysis rebuild started from stored raw response", {
        bvid: input.metadata.bvid,
        cid: input.metadata.cid,
        summaryDir: input.summaryDir,
        modelName,
      }),
    );
    return this.buildOutput(input, analysis, rawResponse, modelName, 0, Date.now());
  }

  /** LLM 之后共享处理：规范化 items → 截图 → 生成 Markdown（analyze 与 rebuild 复用） */
  private async buildOutput(
    input: AnalysisInput,
    analysis: SubtitleAnalysis,
    rawResponse: string,
    modelName: string,
    llmMs: number,
    startTotalMs: number,
  ): Promise<AnalysisOutput> {
    await mkdir(input.summaryDir, { recursive: true });
    const screenshotsDir = join(input.summaryDir, "screenshots");
    await mkdir(screenshotsDir, { recursive: true });

    let screenshotMs = 0;
    const screenshots: string[] = [];

    const summaryItems = normalizeSummaryItems(analysis);
    if (summaryItems.length === 0) {
      this.logger.warn(
        createLogMessage("Analysis returned no summary items", {
          bvid: input.metadata.bvid,
          cid: input.metadata.cid,
          emptySummary: true,
        }),
      );
      return await this.writeEmptySummary(
        input,
        screenshots,
        rawResponse,
        modelName,
      );
    }

    const resolvedSource = input.screenshotVideoPath
      ? {
          source: input.screenshotVideoPath,
          sourceType: "local" as const,
          headers: undefined,
        }
      : await this.resolveScreenshotSource(input);
    const localFallbackPath = input.screenshotVideoPath ?? input.videoPath;
    let useLocalFallbackForRest = false;

    this.logger.log(
      createLogMessage("Resolved screenshot source for analysis", {
        bvid: input.metadata.bvid,
        cid: input.metadata.cid,
        videoPath: resolvedSource.source,
        sourceType: resolvedSource.sourceType,
      }),
    );

    const processedSegments: DocumentInput["segments"] = [];

    // 按 LLM 返回的精确时间戳直接截图，不再做二次多模态选图
    const screenshotStartMs = Date.now();
    for (let si = 0; si < summaryItems.length; si++) {
      const item = summaryItems[si];
      const seconds = transTimestampToSeconds(item.timestamp);

      if (seconds === undefined) {
        this.logger.warn(
          createLogMessage(
            `Skipping screenshot for summary segment ${si} due to invalid timestamp`,
            {
              bvid: input.metadata.bvid,
              cid: input.metadata.cid,
              reason: item.timestamp,
            },
          ),
        );
        continue;
      }

      let segmentScreenshots: string[] = [];
      try {
        const screenshotPath = useLocalFallbackForRest
          ? localFallbackPath
          : resolvedSource.source;
        const screenshotHeaders = useLocalFallbackForRest
          ? undefined
          : resolvedSource.headers;

        const result = await this.screenshotter.takeScreenshots({
          videoPath: screenshotPath,
          timePoints: [seconds],
          outputDir: screenshotsDir,
          filenamePrefix: `segment-${si}`,
          headers: screenshotHeaders,
        });
        segmentScreenshots = result.outputFiles;
        screenshots.push(...segmentScreenshots);
      } catch (err) {
        if (
          !useLocalFallbackForRest &&
          resolvedSource.sourceType === "remote"
        ) {
          useLocalFallbackForRest = true;
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            createLogMessage(
              `Remote screenshot capture failed for summary segment ${si}, switching to local fallback`,
              {
                bvid: input.metadata.bvid,
                cid: input.metadata.cid,
                videoPath: localFallbackPath,
                sourceType: "local",
                error: message,
              },
            ),
          );
          try {
            const retryResult = await this.screenshotter.takeScreenshots({
              videoPath: localFallbackPath,
              timePoints: [seconds],
              outputDir: screenshotsDir,
              filenamePrefix: `segment-${si}`,
            });
            segmentScreenshots = retryResult.outputFiles;
            screenshots.push(...segmentScreenshots);
          } catch (retryErr) {
            const retryMessage =
              retryErr instanceof Error ? retryErr.message : String(retryErr);
            this.logger.error(
              createLogMessage(
                `Remote and local screenshot capture both failed for summary segment ${si}`,
                {
                  bvid: input.metadata.bvid,
                  cid: input.metadata.cid,
                  error: retryMessage,
                },
              ),
              retryErr instanceof Error ? retryErr.stack : undefined,
            );
          }
        }
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          createLogMessage(
            `Screenshot capture failed for summary segment ${si}`,
            {
              bvid: input.metadata.bvid,
              cid: input.metadata.cid,
              sourceType: useLocalFallbackForRest
                ? "local"
                : resolvedSource.sourceType,
              error: message,
            },
          ),
          err instanceof Error ? err.stack : undefined,
        );
      }

      processedSegments.push({
        title: item.title,
        content: item.content,
        timestamp: item.timestamp,
        frameDescription: item.frameDescription,
        images: segmentScreenshots.map((file) => ({
          relativePath: `screenshots/${basename(file)}`,
        })),
      });
    }
    screenshotMs = Date.now() - screenshotStartMs;

    // 生成 Markdown
    const doc = generateMarkdown({
      videoTitle: input.videoTitle,
      videoUrl:
        input.metadata.type === "bilibili"
          ? (input.metadata.videoUrl ?? "")
          : "",
      modelName,
      createdAt: new Date().toString(),
      segments: processedSegments,
    });

    const summaryPath = join(
      input.summaryDir,
      `${input.videoTitle}-summary.md`,
    );
    await writeFile(summaryPath, doc, "utf-8");

    this.logger.log(
      createLogMessage("Analysis summary written", {
        bvid: input.metadata.bvid,
        cid: input.metadata.cid,
        summaryPath,
        segmentCount: processedSegments.length,
        emptySummary: processedSegments.length === 0,
      }),
    );

    return {
      summaryPath,
      screenshotFiles: screenshots,
      segmentCount: processedSegments.length,
      emptySummary: processedSegments.length === 0,
      timing: {
        llmMs,
        screenshotMs,
        totalMs: Date.now() - startTotalMs,
      },
      rawResponse,
      modelName,
    };
  }

  private async resolveScreenshotSource(input: AnalysisInput): Promise<{
    source: string;
    sourceType: "remote" | "local";
    headers?: Record<string, string>;
  }> {
    if (!this.screenshotSourceResolver) {
      return { source: input.videoPath, sourceType: "local" };
    }

    return this.screenshotSourceResolver.resolve({
      metadata: input.metadata,
      localVideoPath: input.videoPath,
    });
  }

  private async writeEmptySummary(
    input: AnalysisInput,
    existingScreenshots: string[],
    rawResponse: string,
    modelName: string,
  ): Promise<AnalysisOutput> {
    const doc = generateMarkdown({
      videoTitle: input.videoTitle,
      videoUrl:
        input.metadata.type === "bilibili"
          ? (input.metadata.videoUrl ?? "")
          : "",
      modelName,
      createdAt: new Date().toString(),
      segments: [],
    });
    const summaryPath = join(
      input.summaryDir,
      `${input.videoTitle}-summary.md`,
    );
    await writeFile(summaryPath, doc, "utf-8");
    this.logger.warn(
      createLogMessage("Wrote empty analysis summary", {
        bvid: input.metadata.bvid,
        cid: input.metadata.cid,
        summaryPath,
        emptySummary: true,
      }),
    );
    return {
      summaryPath,
      screenshotFiles: existingScreenshots,
      segmentCount: 0,
      emptySummary: true,
      timing: { llmMs: 0, screenshotMs: 0, totalMs: 0 },
      rawResponse,
      modelName,
    };
  }
}

function normalizeSummaryItems(
  analysis: SubtitleAnalysis | undefined,
): SubtitleAnalysis["summary"] {
  return (analysis?.summary ?? []).filter(
    (item) =>
      typeof item.title === "string" &&
      item.title.trim().length > 0 &&
      typeof item.content === "string" &&
      item.content.trim().length > 0 &&
      typeof item.timestamp === "string" &&
      item.timestamp.trim().length > 0 &&
      typeof item.frameDescription === "string" &&
      item.frameDescription.trim().length > 0,
  );
}
