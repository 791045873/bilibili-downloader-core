/**
 * 视频内容分析引擎
 *
 * 核心编排流程：
 *   字幕解析 → LLM 分析视频和字幕 → 按模型返回时间戳截图 → 生成文档
 */

import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseSrtFile, type SrtEntry } from "@bilibili-downloader/adapters/parser";
import { FfmpegScreenshot } from "@bilibili-downloader/adapters/ffmpeg";
import { QwenClient, type LlmConfig } from "@bilibili-downloader/adapters/llm";
import { generateMarkdown, type DocumentInput } from "./document-generator.js";

function formatSubtitleEntry(entry: SrtEntry): string {
  return `[${entry.index}] ${entry.text}`;
}

function transTimestampToSeconds(timestamp: string): number | undefined {
  const normalized = timestamp.trim();
  const parts = normalized.split(":").map((part) => Number.parseInt(part, 10));

  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return undefined;
  }

  const [hours, minutes, seconds] = parts;
  return hours * 3600 + minutes * 60 + seconds;
}

export interface AnalysisInput {
  /** 视频文件路径 */
  videoPath: string;
  /** SRT 字幕文件路径 */
  subtitlePath: string;
  /** summary 输出目录（如 summary/{title}/） */
  summaryDir: string;
  /** 视频标题（用于文档标题） */
  videoTitle: string;
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
}

/** LLM #1 响应结构：视频与字幕分析 */
interface SubtitleAnalysis {
  summary: Array<{
    title: string;
    content: string;
    timestamp: string;
  }>;
}

/** 构建字幕分析的系统 Prompt */
function buildAnalysisSystemPrompt(): string {
  return [
    "这是一个穿搭博主的教学视频和该视频对应的文本内容。"+
    "博主在这个视频中讲述了自己关于穿搭方面的技巧与思路，并向观众展示了真实的穿搭例子。"+
    "请你完整、仔细地从视频与文本中总结这些技巧与思路，并给出其对应的展示案例在视频中的时间戳。"+
    "请严格按照 JSON 格式输出，格式如下："+
    "{summary: Array<{title: string, content: string, timestamp: string}>}"+
    "summary中的title是总结的穿搭技巧或思路的标题, content是穿搭技巧或思路的具体内容, timestamp是对应的展示案例的时间戳(格式为hh:mm:ss,例如00:02:30代表2分20秒)"+
    "有可能某一个穿搭技巧、思路的实际展示持续了较长时间，请你从其中选择最能展现该穿搭技巧、思路的时刻记录为时间戳。"
  ].join("\n");
}

export class AnalysisEngine {
  private readonly llmClient: QwenClient;
  private readonly screenshotter: FfmpegScreenshot;

  constructor(
    llmConfig: LlmConfig,
    httpClient?: typeof fetch,
  ) {
    this.llmClient = new QwenClient(llmConfig, httpClient);
    this.screenshotter = new FfmpegScreenshot();
  }

  async analyze(input: AnalysisInput): Promise<AnalysisOutput> {
    await mkdir(input.summaryDir, { recursive: true });
    const screenshotsDir = join(input.summaryDir, "screenshots");
    await mkdir(screenshotsDir, { recursive: true });

    const screenshots: string[] = [];

    // 1. 解析字幕
    const srtEntries = await parseSrtFile(input.subtitlePath);
    if (srtEntries.length === 0) {
      return await this.writeEmptySummary(input, screenshots);
    }

    if (!this.llmClient.usesVisionProxy()) {
      throw new Error("视频+字幕分析需要配置 QWEN_VISION_PROXY_URL，以便通过 Python 薄代理读取本地视频文件");
    }

    const fullSubtitleText = srtEntries.map(formatSubtitleEntry).join("\n");

    // 2. LLM: 视频 + 字幕分析，直接返回用于截图的时间戳
    let analysis: SubtitleAnalysis;
    try {
      analysis = (await this.llmClient.multimodalChat({
        model: "",
        stream: false,
        enable_thinking: false,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildAnalysisSystemPrompt() },
          {
            role: "user",
            content: [
              { type: "video_url", video_url: { url: input.videoPath } },
              { type: "text", text: fullSubtitleText },
            ],
          },
        ],
      })) as unknown as SubtitleAnalysis;
    } catch (err) {
      console.error(`LLM 视频和字幕分析失败: ${(err as Error).message}`);
      return await this.writeEmptySummary(input, screenshots);
    }

    const summaryItems = normalizeSummaryItems(analysis);
    if (summaryItems.length === 0) {
      return await this.writeEmptySummary(input, screenshots);
    }

    const processedSegments: DocumentInput["segments"] = [];

    // 3. 按 LLM 返回的精确时间戳直接截图，不再做二次多模态选图
    for (let si = 0; si < summaryItems.length; si++) {
      const item = summaryItems[si];
      const seconds = transTimestampToSeconds(item.timestamp);

      if (seconds === undefined) {
        console.error(`段落 ${si} 返回了无效时间戳，跳过截图: ${item.timestamp}`);
        continue;
      }

      let segmentScreenshots: string[] = [];
      try {
        const result = await this.screenshotter.takeScreenshots({
          videoPath: input.videoPath,
          timePoints: [seconds],
          outputDir: screenshotsDir,
          filenamePrefix: `segment-${si}`,
        });
        segmentScreenshots = result.outputFiles;
        screenshots.push(...segmentScreenshots);
      } catch (err) {
        console.error(`段落 ${si} 截图失败: ${(err as Error).message}`);
      }

      processedSegments.push({
        topic: item.title,
        subtitleText: item.content,
        selectedImages: segmentScreenshots.map((file) => ({
          relativePath: `screenshots/${basename(file)}`,
          reason: item.title,
        })),
      });
    }

    // 4. 生成 Markdown
    const doc = generateMarkdown({
      videoTitle: input.videoTitle,
      summary: summaryItems.map((item) => `- ${item.title}: ${item.content}`).join("\n"),
      segments: processedSegments,
      emptySummary: processedSegments.length === 0,
    });

    const summaryPath = join(input.summaryDir, `${input.videoTitle}-summary.md`);
    await writeFile(summaryPath, doc, "utf-8");

    return {
      summaryPath,
      screenshotFiles: screenshots,
      segmentCount: processedSegments.length,
      emptySummary: processedSegments.length === 0,
    };
  }

  private async writeEmptySummary(
    input: AnalysisInput,
    existingScreenshots: string[],
  ): Promise<AnalysisOutput> {
    const doc = generateMarkdown({
      videoTitle: input.videoTitle,
      summary: "",
      segments: [],
      emptySummary: true,
    });
    const summaryPath = join(input.summaryDir, `${input.videoTitle}-summary.md`);
    await writeFile(summaryPath, doc, "utf-8");
    return {
      summaryPath,
      screenshotFiles: existingScreenshots,
      segmentCount: 0,
      emptySummary: true,
    };
  }
}

function normalizeSummaryItems(analysis: SubtitleAnalysis | undefined): SubtitleAnalysis["summary"] {
  return (analysis?.summary ?? []).filter((item) => (
    typeof item.title === "string"
    && item.title.trim().length > 0
    && typeof item.content === "string"
    && item.content.trim().length > 0
    && typeof item.timestamp === "string"
    && item.timestamp.trim().length > 0
  ));
}
