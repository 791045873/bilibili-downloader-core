/**
 * Markdown 总结文档工具：frontmatter 解析、图片链接重写
 *
 * 纯函数层：不读 env、不依赖 Nest；摘要根目录由调用方传入。
 */

import {
  resolveFromDownloadRoot,
  toRelativeDownloadRootPath,
} from "@bilibili-downloader/server-common";

/**
 * 写侧：把 summary_output 绝对路径转为相对 downloadRoot 的相对路径（POSIX 分隔符）。
 * 仅当值位于 downloadRoot 之下时转换；遗留根外值（如旧 cwd/summaryDir）返回 null 表示不改写。
 * 委托通用锚点模块（paths/path-anchor.ts），行为见其文档。
 */
export function toRelativeSummaryOutputPath(
  value: string,
  downloadRoot: string,
): string | null {
  return toRelativeDownloadRootPath(value, downloadRoot);
}

/**
 * 读侧：把 DB 中的 summary_output 解析为当前环境的绝对路径。
 * 非空值一律 join(downloadRoot, value)（读侧恒 join，不透传绝对值）。
 */
export function resolveSummaryOutputPath(
  value: string,
  downloadRoot: string,
): string {
  return resolveFromDownloadRoot(value, downloadRoot) ?? value;
}

/** Markdown 图片语法：![alt](url)（当前生成器仅产出该语法，url 不含空格/括号） */
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

function isAlreadyResolvable(url: string): boolean {
  // 根相对、锚点、或带 scheme 的绝对地址（http:/https:/data: 等）原样保留
  if (url.startsWith("/") || url.startsWith("#")) {
    return true;
  }
  return /^[a-z][a-z0-9+.-]*:/i.test(url);
}

/** 相对路径归一化；任何 `..` 段越过摘要目录，放弃重写返回 undefined */
function normalizeRelUrl(url: string): string | undefined {
  const normalized = url.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (segments.some((seg) => seg === "..")) {
    return undefined;
  }
  return normalized;
}

/**
 * 提取 md 头部 YAML frontmatter 元数据并剥离正文。
 * 生成器固定产出 `---` + `key: "value"` 行，数值用 JSON.parse 还原引号转义；
 * frontmatter 缺失或畸形时返回空 meta 与原样正文（容错）。
 */
export interface SummaryMeta {
  title?: string;
  videoUrl?: string;
  model?: string;
  createdAt?: string;
}

function parseFrontmatterValue(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function extractSummaryMeta(content: string): {
  meta: SummaryMeta;
  body: string;
} {
  if (!content.startsWith("---")) {
    return { meta: {}, body: content };
  }
  const firstEol = content.indexOf("\n");
  if (firstEol < 0) {
    return { meta: {}, body: content };
  }
  const rest = content.slice(firstEol + 1);
  const endMarker = "\n---";
  const endIndex = rest.indexOf(endMarker);
  if (endIndex < 0) {
    return { meta: {}, body: content };
  }

  const meta: SummaryMeta = {};
  for (const line of rest.slice(0, endIndex).split(/\r?\n/)) {
    const colonIndex = line.indexOf(":");
    if (colonIndex < 1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = parseFrontmatterValue(line.slice(colonIndex + 1));
    if (value === undefined) continue;
    switch (key) {
      case "title":
        meta.title = value;
        break;
      case "video_url":
        meta.videoUrl = value;
        break;
      case "model":
        meta.model = value;
        break;
      case "created_at":
        meta.createdAt = value;
        break;
    }
  }

  const body = rest
    .slice(endIndex + endMarker.length)
    .replace(/^\r?\n/, "");
  return { meta, body };
}

/**
 * 列出 md 中本地相对图片引用（相对 md 所在目录，如 screenshots/segment-0.jpg）。
 * 绝对地址/根相对/锚点/`..` 越界排除；供完整性检查等消费方使用。
 * matchAll 不会共享 MARKDOWN_IMAGE_RE 的 lastIndex，可安全复用。
 */
export function listLocalImageRefs(content: string): string[] {
  const refs: string[] = [];
  for (const match of content.matchAll(MARKDOWN_IMAGE_RE)) {
    const url = match[2].trim();
    if (isAlreadyResolvable(url)) {
      continue;
    }
    const rel = normalizeRelUrl(url);
    if (rel !== undefined) {
      refs.push(rel);
    }
  }
  return refs;
}