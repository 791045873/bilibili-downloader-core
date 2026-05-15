/**
 * Bilibili 常量: 清晰度 / 编码 / 转换表
 */

/** 清晰度 qn 值映射 */
export const QUALITY_MAP: Record<number, string> = {
  6: "240P 极速",
  16: "360P 流畅",
  32: "480P 清晰",
  64: "720P 高清",
  74: "720P60 高帧率",
  80: "1080P 高清",
  112: "1080P+ 高码率",
  116: "1080P60 高帧率",
  120: "4K 超清",
  125: "HDR 真彩色",
  126: "Dolby Vision",
  127: "8K 超高清",
};

/** 视频编码 codecid 映射 */
export const CODEC_MAP: Record<number, string> = {
  7: "AVC/H.264",
  12: "HEVC/H.265",
  13: "AV1",
};

/** BV <-> AV 转换表 */
export const BV_AV_CONVERT = {
  TABLE: "fZodR9XQDSUm21yCkr6zBqiveYah8bt4xsWpHnJE7jL5VG3guMTKNPAwcF",
  TR: new Map<string, number>(),
  S: [11, 10, 3, 8, 4, 6] as const,
  XOR: 177451812n,
  ADD: 8728348608n,
};

// 初始化 TR 映射
for (let i = 0; i < BV_AV_CONVERT.TABLE.length; i++) {
  BV_AV_CONVERT.TR.set(BV_AV_CONVERT.TABLE[i], i);
}

/** Bilibili API 基础 URL */
export const BILI_API_BASE = "https://api.bilibili.com";

/** Bilibili 主站 URL */
export const BILI_WWW_BASE = "https://www.bilibili.com";

/** 默认 User-Agent (Chrome) */
export const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** 默认请求头 */
export const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": DEFAULT_UA,
  Referer: `${BILI_WWW_BASE}/`,
  Origin: BILI_WWW_BASE,
};