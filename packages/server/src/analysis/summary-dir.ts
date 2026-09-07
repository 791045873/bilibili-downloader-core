/**
 * Markdown 总结文档工具：frontmatter 解析、图片链接重写
 *
 * 纯函数层：不读 env、不依赖 Nest；摘要根目录由调用方传入。
 */

import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/** 摘要目录静态挂载前缀（同源；dev 由 Vite 代理转发，生产同源直达） */
export const SUMMARY_STATIC_PREFIX = "/summary-files";

function isAbsoluteSummaryPath(value: string): boolean {
  return isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value);
}

/**
 * 写侧：把 summary_output 绝对路径转为相对 downloadRoot 的相对路径（POSIX 分隔符）。
 * 仅当值位于 downloadRoot 之下时转换；遗留根外值（如旧 cwd/summaryDir）返回 null 表示不改写。
 * 大小写：归属判定仅用于比较，relative() 用原始大小写计算，保留原段 case（云端 Linux 大小写敏感）。
 */
export function toRelativeSummaryOutputPath(
  value: string,
  downloadRoot: string,
): string | null {
  if (!value || isAbsoluteSummaryPath(value) === false) {
    return null;
  }
  const absValue = resolve(value);
  const absRoot = resolve(downloadRoot);
  const rel = relative(absRoot, absValue);
  if (
    rel === "" ||
    isAbsolute(rel) ||
    rel.startsWith("..") ||
    rel.startsWith(`..${sepOf(rel)}`)
  ) {
    return null;
  }
  return rel.replaceAll("\\", "/");
}

function sepOf(value: string): string {
  return value.includes("/") ? "/" : "\\";
}

/**
 * 读侧：把 DB 中的 summary_output 解析为当前环境的绝对路径。
 * 相对值按 join(downloadRoot, value) 拼接；绝对值（迁移前遗留）原样透传。
 */
export function resolveSummaryOutputPath(
  value: string,
  downloadRoot: string,
): string {
  if (!value || isAbsoluteSummaryPath(value)) {
    return value;
  }
  return join(downloadRoot, value);
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
 * @param summaryBaseDir 摘要根目录（由调用方从 PathsService 传入）
 */
export function rewriteMarkdownImageUrls(
  content: string,
  mdFileAbsPath: string,
  summaryBaseDir: string,
): string {
  const mdDir = dirname(mdFileAbsPath);
  let relDir = relative(summaryBaseDir, mdDir).replaceAll("\\", "/");
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

/**
 * 将 md 中相对图片链接按映射表改写（如相对路径 → COS 公网 URL）。
 * 已可解析的绝对地址/根相对/锚点原样保留；无映射的相对路径保留。
 * @param content md 全文
 * @param urlByRelPath 相对路径（如 screenshots/segment-0.jpg）→ 目标 URL 的映射
 */
export function rewriteMarkdownImages(
  content: string,
  urlByRelPath: Record<string, string>,
): string {
  return content.replace(
    MARKDOWN_IMAGE_RE,
    (match, alt: string, rawUrl: string) => {
      const url = rawUrl.trim();
      if (isAlreadyResolvable(url)) {
        return match;
      }
      const rel = normalizeRelUrl(url);
      if (rel === undefined) {
        return match;
      }
      const target = urlByRelPath[rel];
      if (!target) {
        return match;
      }
      return `![${alt}](${target})`;
    },
  );
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