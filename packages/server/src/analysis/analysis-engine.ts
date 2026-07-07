/**
 * 视频内容分析引擎
 *
 * 核心编排流程：
 *   字幕解析 → LLM 分析字幕 → 截图 → 上传临时图片 → LLM 多模态选图 → 清理临时图片 → 生成文档
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseSrtFile, type SrtEntry } from "@bilibili-downloader/adapters/parser";
import { FfmpegScreenshot } from "@bilibili-downloader/adapters/ffmpeg";
import { QwenClient, type LlmConfig } from "@bilibili-downloader/adapters/llm";
import {
  TencentCosTempImageStore,
  type TempImageStore,
} from "@bilibili-downloader/adapters/cos";
import { generateMarkdown, type DocumentInput } from "./document-generator.js";

function formatSubtitleEntry(entry: SrtEntry): string {
  return `[${entry.index}] ${entry.text}`;
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

export interface AnalysisEngineOptions {
  tempImageStore?: TempImageStore;
}

/** LLM #1 响应结构：字幕分析 */
interface SubtitleAnalysis {
  summary: string;
  segments: Array<{
    content: string;
    sourceIndexes: number[];
  }>;
}

/** LLM #2 响应结构：截图选择 */
interface ScreenshotSelection {
  selectedImages: Array<{
    imageIndex: number;
    reason: string;
  }>;
}

/** 构建字幕分析的系统 Prompt */
function buildAnalysisSystemPrompt(): string {
  return [
    "你是一个穿搭视频内容分析助手。",
    "你将获得一段穿搭视频的完整字幕列表。",
    "每一行格式为：[字幕序号] 字幕文本。字幕序号是原始 SRT 条目的 index，不是数组下标。",
    "这段字幕文件中的具体内容非常口语化、碎片化。",
    "请分析这段字幕，对其进行总结，重点关注以下内容：",
    "1. 认可、推荐的穿搭风格的描述",
    "2. 认可、推荐的穿搭技巧的讲解",
    "3. 对每一条总结内容，同步输出它依据的原始字幕序号列表 sourceIndexes。",
    "sourceIndexes 必须只包含输入中真实出现过的字幕序号；如果一条总结跨越多条字幕，请输出该内容覆盖到的所有连续或相关字幕序号。",
    "将所有内容总结后，按照以下 JSON 格式返回：",
    '{ "summary": "整体总结文本", "segments": [{ "content": "我是总结文本", "sourceIndexes": [1, 2, 3] }] }',
    "请严格按照 JSON 格式输出，不要包含其他文字。",
  ].join("\n");
}

/** 构建截图选择的系统 Prompt */
function buildSelectionSystemPrompt(): string {
  return [
    "你是一个视频截图选择助手。",
    "你将获得一个视频关键段落的主题、字幕原文、以及多张按时间顺序排列的视频截图。",
    "请分析这些截图，选出最符合该段落主题的一张或多张截图。",
    "选择标准：",
    "- 截图应最能反映该段落的视觉内容",
    "- 画面清晰、构图完整",
    "- 图片内容与该段落的描述高度相关",
    "请严格按照 JSON 格式输出，格式：",
    '{ "selectedImages": [{ "imageIndex": 0, "reason": "..." }] }',
    "其中 imageIndex 是截图的编号（从 0 开始），reason 是选中该图的原因。",
  ].join("\n");
}

export class AnalysisEngine {
  private readonly llmClient: QwenClient;
  private readonly screenshotter: FfmpegScreenshot;
  private readonly tempImageStore?: TempImageStore;

  constructor(
    llmConfig: LlmConfig,
    httpClient?: typeof fetch,
    options: AnalysisEngineOptions = {},
  ) {
    this.llmClient = new QwenClient(llmConfig, httpClient);
    this.screenshotter = new FfmpegScreenshot();
    this.tempImageStore = options.tempImageStore ?? createTempImageStoreFromEnv();
  }

  async analyze(input: AnalysisInput): Promise<AnalysisOutput> {
    await mkdir(input.summaryDir, { recursive: true });
    const screenshotsDir = join(input.summaryDir, "screenshots");
    await mkdir(screenshotsDir, { recursive: true });

    const screenshots: string[] = [];
    const tempImageKeys: string[] = [];
    const tempRunPrefix = `${sanitizeObjectKeyPart(input.videoTitle)}-${Date.now()}-${randomUUID()}`;

    try {
      // 1. 解析字幕
      const srtEntries = await parseSrtFile(input.subtitlePath);
      if (srtEntries.length === 0) {
        return await this.writeEmptySummary(input, screenshots);
      }

      const fullSubtitleText = srtEntries.map(formatSubtitleEntry).join("\n");
      const srtEntryByIndex = new Map(srtEntries.map((entry) => [entry.index, entry]));

      // 2. LLM #1: 字幕分析
      let analysis: SubtitleAnalysis;
      try {
        analysis = (await this.llmClient.chatCompletion({
          model: "",
          messages: [
            { role: "system", content: buildAnalysisSystemPrompt() },
            { role: "user", content: fullSubtitleText },
          ],
          response_format: { type: "json_object" },
        })) as unknown as SubtitleAnalysis;
      } catch (err) {
        console.error(`LLM 字幕分析失败: ${(err as Error).message}`);
        return await this.writeEmptySummary(input, screenshots);
      }

      const segments = analysis?.segments ?? [];
      if (segments.length === 0) {
        return await this.writeEmptySummary(input, screenshots);
      }

      if (!this.tempImageStore) {
        throw new Error("COS 临时图片存储未配置，无法向远端多模态模型提供截图 URL");
      }

      const processedSegments: DocumentInput["segments"] = [];

      // 这个后续可以优化一下，把相同的时间节点去重掉。每一个时间节点只做一次截图，然后将这些截图映射到不同的段落上去，每个段落最终根据自己的所需选择自己需要的截图。
      // 3-4. 对每个段落截图 + 多模态选图
      for (let si = 0; si < segments.length; si++) {
        const seg = segments[si];
        const sourceEntries = getSourceEntries(seg.sourceIndexes, srtEntryByIndex);
        if (sourceEntries.length === 0) {
          console.error(`段落 ${si} 未返回有效字幕序号，跳过截图`);
          continue;
        }

        const winStart = Math.max(0, sourceEntries[0].startTime - 3);
        const winEnd = sourceEntries[sourceEntries.length - 1].endTime + 3;
        const timePoints: number[] = [];
        for (let t = Math.floor(winStart); t <= Math.ceil(winEnd); t++) {
          timePoints.push(t);
        }

        let segScreenshots: string[] = [];
        try {
          const result = await this.screenshotter.takeScreenshots({
            videoPath: input.videoPath,
            timePoints,
            outputDir: screenshotsDir,
            filenamePrefix: `segment-${si}`,
          });
          segScreenshots = result.outputFiles;
          screenshots.push(...segScreenshots);
        } catch (err) {
          console.error(`段落 ${si} 截图失败: ${(err as Error).message}`);
          continue;
        }

        let uploadedImages: Awaited<ReturnType<TempImageStore["uploadImages"]>> = [];
        try {
          uploadedImages = await this.tempImageStore.uploadImages({
            files: segScreenshots,
            keyPrefix: `${tempRunPrefix}/segment-${si}`,
          });
          tempImageKeys.push(...uploadedImages.map((image) => image.key));
        } catch (err) {
          console.error(`段落 ${si} 上传临时截图失败: ${(err as Error).message}`);
          continue;
        }

        const imageContents = uploadedImages.map((image) => ({
          type: "image_url" as const,
          image_url: { url: image.url },
        }));

        if (imageContents.length === 0) continue;

        // LLM #2: 多模态选图
        let selection: ScreenshotSelection;
        try {
          const userContent = [
            { type: "text" as const, text: `段落内容: ${seg.content}` },
            ...imageContents,
          ];
          selection = (await this.llmClient.multimodalChat({
            model: "",
            messages: [
              { role: "system", content: buildSelectionSystemPrompt() },
              { role: "user", content: userContent },
            ],
          })) as unknown as ScreenshotSelection;
        } catch (err) {
          console.error(`段落 ${si} 选图失败: ${(err as Error).message}`);
          selection = { selectedImages: [{ imageIndex: 0, reason: "自动选择（LLM 选图失败）" }] };
        }

        const selectedImgs = normalizeSelectedImages(selection, segScreenshots.length);

        processedSegments.push({
          topic: seg.content,
          subtitleText: sourceEntries.map(formatSubtitleEntry).join("\n"),
          selectedImages: selectedImgs.map((sel) => ({
            relativePath: `screenshots/${basename(segScreenshots[sel.imageIndex])}`,
            reason: sel.reason,
          })),
        });
      }

      // 5. 生成 Markdown
      const doc = generateMarkdown({
        videoTitle: input.videoTitle,
        summary: analysis.summary || "",
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
    } finally {
      await this.cleanupTempImages(tempImageKeys);
    }
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

  private async cleanupTempImages(keys: string[]): Promise<void> {
    if (keys.length === 0 || !this.tempImageStore) return;

    try {
      await this.tempImageStore.deleteObjects(keys);
    } catch (err) {
      console.error(`清理 COS 临时截图失败: ${(err as Error).message}`);
    }
  }
}

function getSourceEntries(
  sourceIndexes: number[] | undefined,
  entryByIndex: Map<number, SrtEntry>,
): SrtEntry[] {
  const entries = (sourceIndexes ?? [])
    .map((index) => entryByIndex.get(index))
    .filter((entry): entry is SrtEntry => entry !== undefined)
    .sort((a, b) => a.startTime - b.startTime);

  return entries;
}

function normalizeSelectedImages(
  selection: ScreenshotSelection | undefined,
  screenshotCount: number,
): ScreenshotSelection["selectedImages"] {
  const selected = (selection?.selectedImages ?? []).filter((item) => (
    Number.isInteger(item.imageIndex)
    && item.imageIndex >= 0
    && item.imageIndex < screenshotCount
  ));

  if (selected.length > 0) return selected;
  return [{ imageIndex: 0, reason: "自动选择（LLM 未返回有效结果）" }];
}

function createTempImageStoreFromEnv(): TempImageStore | undefined {
  const secretId = process.env.TENCENT_COS_SECRET_ID;
  const secretKey = process.env.TENCENT_COS_SECRET_KEY;
  const bucket = process.env.TENCENT_COS_BUCKET;
  const region = process.env.TENCENT_COS_REGION;

  if (!secretId || !secretKey || !bucket || !region) {
    return undefined;
  }

  return new TencentCosTempImageStore({
    secretId,
    secretKey,
    bucket,
    region,
    tempPrefix: process.env.TENCENT_COS_TEMP_PREFIX,
    signedUrlExpiresSeconds: parsePositiveInt(
      process.env.TENCENT_COS_SIGNED_URL_EXPIRES_SECONDS,
      3600,
    ),
  });
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeObjectKeyPart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "video";
}
