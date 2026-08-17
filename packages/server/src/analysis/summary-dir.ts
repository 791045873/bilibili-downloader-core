/**
 * 摘要文档根目录共享常量
 *
 * 静态挂载、AnalysisTriggerService.resolveSummaryDir、markdown 查看端点共用，
 * 避免三处重复推导 cwd/summaryDir 造成漂移。
 */

import { dirname, isAbsolute, relative, resolve } from "node:path";

/** 摘要文档根目录：所有 AI 总结 md 与截图均落于此目录下 */
export const SUMMARY_BASE_DIR = resolve(process.cwd(), "summaryDir");

/** 摘要目录静态挂载前缀（同源；dev 由 Vite 代理转发，生产同源直达） */
export const SUMMARY_STATIC_PREFIX = "/summary-files";

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

function encodeUrlSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[()]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
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
 * 将 md 文本中的相对图片链接统一重写为 `/summary-files/…` 同源静态路径。
 * 非图片链接不受影响；无法安全解析的链接（绝对地址/根相对/锚点/越界）原样保留。
 *
 * @param content md 全文（通常已剥离 frontmatter）
 * @param mdFileAbsPath md 文件的绝对路径（用于计算相对摘要根目录的基准）
 */
export function rewriteMarkdownImageUrls(
  content: string,
  mdFileAbsPath: string,
): string {
  const mdDir = dirname(mdFileAbsPath);
  let relDir = relative(SUMMARY_BASE_DIR, mdDir).replaceAll("\\", "/");
  if (relDir === ".") {
    relDir = "";
  }
  if (relDir.startsWith("..") || isAbsolute(relDir)) {
    return content;
  }
  const baseUrl = `${SUMMARY_STATIC_PREFIX}${
    relDir ? `/${relDir.split("/").filter(Boolean).map(encodeUrlSegment).join("/")}` : ""
  }/`;

  return content.replace(MARKDOWN_IMAGE_RE, (match, alt: string, rawUrl: string) => {
    const url = rawUrl.trim();
    if (isAlreadyResolvable(url)) {
      return match;
    }
    const rel = normalizeRelUrl(url);
    if (rel === undefined) {
      return match;
    }
    const encoded = rel.split("/").map(encodeUrlSegment).join("/");
    return `![${alt}](${baseUrl}${encoded})`;
  });
}