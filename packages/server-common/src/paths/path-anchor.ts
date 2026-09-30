/**
 * DB 路径锚点工具 — 相对 DOWNLOAD_ROOT 的写侧/读侧纯函数
 *
 * 约定（docs/design/app-overview.md）：DB 中磁盘路径一律相对 DOWNLOAD_ROOT
 * 存储（POSIX 分隔符）；读取时 join(DOWNLOAD_ROOT, value)，不透传绝对值
 * （2026-09-09 起读侧恒 join，遗留绝对值须迁移清理）；写侧把进程内绝对值
 * 归一化为该锚点的 POSIX 相对路径，根外值不改写。
 * 纯函数层：不读 env、不依赖 Nest。
 */

import { isAbsolute, join, relative, resolve } from "node:path";

export function isAbsoluteAnchorPath(value: string): boolean {
  return isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value);
}

/**
 * 写侧：把位于 downloadRoot 之下的绝对路径转为相对路径（POSIX 分隔符）。
 * 仅当值位于 downloadRoot 之下时转换；空值、已是相对值、根外值返回 null 表示不改写。
 * 大小写：归属判定仅用于比较，relative() 用原始大小写计算，保留原段 case（云端 Linux 大小写敏感）。
 */
export function toRelativeDownloadRootPath(
  value: string | null | undefined,
  downloadRoot: string,
): string | null {
  if (!value || !isAbsoluteAnchorPath(value)) {
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
 * 读侧：把 DB 值解析为当前环境的绝对路径。
 * 非空值一律 join(downloadRoot, value)（2026-09-09 起不再透传绝对值：
 * `/abc` 等根相对形态同样按下载根拼接）。
 */
export function resolveFromDownloadRoot(
  value: string | null | undefined,
  downloadRoot: string,
): string | undefined {
  if (!value) {
    return undefined;
  }
  return join(downloadRoot, value);
}
