/**
 * URL 规范化工具
 *
 * 提供 URL 判断、标准化、b23.tv 短链解析等能力，
 * 供各 URL matcher 和 ResourceParser 共用。
 */

/** 判断输入是否为 URL */
export function isUrl(input: string): boolean {
  return input.startsWith("http://") || input.startsWith("https://");
}

/**
 * 标准化 URL: http -> https, 去除末尾 /, b23.tv 短链接转化
 */
export function normalizeUrl(url: string): string {
  let normalized = url.replace(/^http:\/\//, "https://");
  normalized = normalized.replace(/\/$/, "");
  if (normalized.startsWith('https://b23.tv/')) {
    normalized = normalized.replace('https://b23.tv/', 'https://www.bilibili.com/video/')
  }
  return normalized;
}
