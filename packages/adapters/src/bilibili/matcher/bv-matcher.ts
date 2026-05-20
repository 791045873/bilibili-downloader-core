/**
 * BV 号匹配器
 *
 * 支持:
 * - 纯 BV 号: "BV17x411w7KC"
 * - URL 中的 BV 号: "https://www.bilibili.com/video/BV17x411w7KC"
 * - b23.tv 短链 (由 normalizeUrl 统一转为完整 URL)
 */

import { ResourceType, type ParseResult } from "@bilibili-downloader/core/ports";

/** 纯 BV 号: "BV" + 10 位字母数字 (排除 ILOU 易混淆字符) */
const BV_PURE_REGEX = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;

/** URL 中的 BV 号: /video/BVxxx */
const BV_URL_REGEX = /\/video\/(BV[1-9A-HJ-NP-Za-km-z]{10})/i;

/**
 * 匹配 BV 号 (纯 ID 或 URL 中的 BV)
 * @returns ParseResult 或 null（不匹配）
 */
export function matchBv(input: string): ParseResult | null {
  // 纯 BV 号
  if (BV_PURE_REGEX.test(input)) {
    return { bvid: input, cid: 0, type: ResourceType.Video };
  }

  // URL 中的 BV 号
  const urlMatch = input.match(BV_URL_REGEX);
  if (urlMatch) {
    return { bvid: urlMatch[1], cid: 0, type: ResourceType.Video };
  }

  return null;
}