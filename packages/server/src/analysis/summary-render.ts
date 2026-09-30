/**
 * 云 DB 总结渲染纯函数层：不读 env、不依赖 Nest 运行时、不触盘。
 *
 * 供 Phase 1a 读取侧从 DB 渲染 markdown：
 * - `renderSummaryFromDb`：summary + summary_segment → markdown 正文（图片用 COS URL）。
 * - `renderRawResponseMarkdown`：无 summary 行时回退 ai_summary_task.raw_response 渲染纯文本。
 * - `buildSummaryMeta`：按取值链重建 meta（不信任 md 内文）。
 */

import { ConflictException } from "@nestjs/common";
import { generateMarkdown, type DocumentInput } from "./document-generator.js";
import { extractSummaryMeta, type SummaryMeta } from "./summary-dir.js";
import type { AiSummaryTaskRecord } from "@bilibili-downloader/server-common";

export interface SummarySegmentView {
  seq: number;
  title: string;
  content: string;
  frameDescription: string | null;
  screenshotUrl: string | null;
}

export interface SummaryView {
  videoTitle: string;
  videoUrl: string | null;
  modelName: string | null;
  createdAt: Date;
  segments: SummarySegmentView[];
}

/** 复用生成器产出完整 md 后剥离 frontmatter，得与现状逐字节一致的正文。 */
function documentToBody(input: DocumentInput): string {
  return extractSummaryMeta(generateMarkdown(input)).body;
}

/**
 * Meta 取值链：summary 优先、回退 ai_summary_task；createdAt 用任务完成/创建时刻
 * （不用 summary.createdAt——其为首次发布时刻，重分析后过期）。
 */
export function buildSummaryMeta(
  summary: Pick<SummaryView, "videoTitle" | "videoUrl" | "modelName"> | null,
  task: AiSummaryTaskRecord,
  bvid: string,
): SummaryMeta {
  return {
    title: summary?.videoTitle ?? task.title ?? undefined,
    videoUrl: summary?.videoUrl ?? `https://www.bilibili.com/video/${bvid}`,
    model: summary?.modelName ?? task.modelName ?? "",
    createdAt: task.lastCompletedAt ?? task.createdAt ?? undefined,
  };
}

/** summary + segments → 正文；screenshot_url 作为图片链接，空则该段无图。 */
export function renderSummaryFromDb(summary: SummaryView): { content: string } {
  const input: DocumentInput = {
    videoTitle: summary.videoTitle,
    videoUrl: "",
    modelName: "",
    createdAt: "",
    segments: summary.segments.map((seg) => ({
      title: seg.title,
      content: seg.content,
      timestamp: "",
      frameDescription: seg.frameDescription ?? "",
      images: seg.screenshotUrl ? [{ relativePath: seg.screenshotUrl }] : [],
    })),
  };
  return { content: documentToBody(input) };
}

/**
 * 回退渲染：解析 raw_response 的 summary[] 生成无图正文。
 * raw_response 为空 / 非合法 JSON / summary 缺失或空数组 → 抛 409（内容不可用）。
 */
export function renderRawResponseMarkdown(
  rawResponse: string | null | undefined,
  videoTitle: string,
): { content: string } {
  if (!rawResponse) {
    throw new ConflictException("该总结内容不可用");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    throw new ConflictException("该总结内容不可用");
  }
  const items =
    parsed && typeof parsed === "object" && "summary" in parsed
      ? (parsed as { summary?: unknown }).summary
      : undefined;
  if (!Array.isArray(items) || items.length === 0) {
    throw new ConflictException("该总结内容不可用");
  }
  const input: DocumentInput = {
    videoTitle,
    videoUrl: "",
    modelName: "",
    createdAt: "",
    segments: items.map((raw) => {
      const it = raw as {
        title?: unknown;
        content?: unknown;
        frameDescription?: unknown;
      };
      return {
        title: typeof it.title === "string" ? it.title : "",
        content: typeof it.content === "string" ? it.content : "",
        timestamp: "",
        frameDescription:
          typeof it.frameDescription === "string" ? it.frameDescription : "",
        images: [],
      };
    }),
  };
  return { content: documentToBody(input) };
}
