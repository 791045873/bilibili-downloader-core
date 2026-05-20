/**
 * 番剧匹配器
 *
 * 支持:
 * - 纯 SS/EP ID: "ss32982", "ep317925"
 * - URL 中的 SS/EP: "/bangumi/play/ss32982", "/bangumi/play/ep317925"
 */

import { ResourceType, type ParseResult } from "@bilibili-downloader/core/ports";

/** 纯 SS ID */
const SS_PURE_REGEX = /^[Ss][Ss]\d+$/;

/** 纯 EP ID */
const EP_PURE_REGEX = /^[Ee][Pp]\d+$/;

/** URL 中的番剧 ID */
const BANGUMI_URL_REGEX = /\/bangumi\/play\/(ss|ep)(\d+)/i;

/**
 * 匹配番剧 (纯 ID 或 URL)
 */
export function matchBangumi(input: string): ParseResult | null {
  // 纯 SS/EP ID
  if (SS_PURE_REGEX.test(input) || EP_PURE_REGEX.test(input)) {
    return {
      bvid: "",
      cid: 0,
      type: ResourceType.Bangumi,
      originalUrl: `https://www.bilibili.com/bangumi/play/${input}`,
    };
  }

  // URL 中的 SS/EP
  if (BANGUMI_URL_REGEX.test(input)) {
    return {
      bvid: "",
      cid: 0,
      type: ResourceType.Bangumi,
      originalUrl: input,
    };
  }

  return null;
}