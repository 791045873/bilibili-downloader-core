/**
 * 课程匹配器
 *
 * 支持 URL: /cheese/play/ss{id} 或 /cheese/play/ep{id}
 * (课程仅有 URL 形式，无纯 ID 输入)
 */

import { ResourceType, type ParseResult } from "@bilibili-downloader/core/ports";

/** 课程 URL 正则 */
const CHEESE_URL_REGEX = /\/cheese\/play\/(ss|ep)\d+/i;

/**
 * 匹配课程 URL
 */
export function matchCheese(input: string): ParseResult | null {
  if (CHEESE_URL_REGEX.test(input)) {
    return {
      bvid: "",
      cid: 0,
      type: ResourceType.Cheese,
      originalUrl: input,
    };
  }
  return null;
}