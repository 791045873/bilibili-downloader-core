/**
 * 下载输出文件名构建 — 命名逻辑收敛的单一模块
 *
 * 职责：按模板渲染输出文件名（含 .mp4 扩展名），不做目录拼接（目录由 outputPath 决定）。
 * 空模板回退默认模板，保证唯一性（默认模板含 bvid/cid/quality）。
 */

const DEFAULT_TEMPLATE = "{title}-{bvid}-{cid}-q{quality}";

export interface FileNamingContext {
  title: string;
  bvid: string;
  cid: number;
  quality: number;
  codec?: string;
  template?: string;
}

/** 清理文件名非法字符 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_");
}

/**
 * 按模板渲染输出文件名。
 * 已知占位符替换其值（无值时替换为空串）；未知/非法占位符保留原样，保证结果可预期、不抛错。
 */
export function buildOutputFileName(ctx: FileNamingContext): string {
  const template = (ctx.template ?? "").trim() || DEFAULT_TEMPLATE;
  const rendered = template.replace(/\{(\w+)\}/g, (match, key: string) => {
    switch (key) {
      case "title":
        return sanitizeFileName(ctx.title);
      case "bvid":
        return ctx.bvid;
      case "cid":
        return String(ctx.cid);
      case "quality":
        return String(ctx.quality);
      case "codec":
        return ctx.codec ? sanitizeFileName(ctx.codec) : "";
      default:
        return match;
    }
  });
  return `${rendered}.mp4`;
}
