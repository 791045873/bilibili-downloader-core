/**
 * Bilibili 资源解析器 - 将用户输入解析为 bvid + 资源类型
 *
 * 采用独立 matcher 组合模式，每种资源类型由独立模块负责识别：
 *   bv-matcher       → BV 号 (纯 ID + URL)
 *   bangumi-matcher  → 番剧 SS / EP (纯 ID + URL)
 *   favorites-matcher → 收藏夹 ML (纯 ID + URL)
 *   cheese-matcher   → 课程 URL
 *
 * 每个 matcher 是自包含的：同时处理纯 ID 和 URL 两种输入形式。
 * URL 输入先由 normalizeUrl 标准化后再进入 matcher 管道。
 * 新增资源类型时只需添加新 matcher 并加入 MATCHERS 数组即可。
 *
 * 参考: downkyicore/DownKyi.Core/BiliApi/BiliUtils/ParseEntrance.cs
 */

import {
  ResourceParseError,
  type ParseResult,
  type ResourceParserPort,
} from "@bilibili-downloader/core/ports";
import { matchBv } from "./matcher/bv-matcher.js";
import { matchBangumi } from "./matcher/bangumi-matcher.js";
import { matchFavorites } from "./matcher/favorites-matcher.js";
import { matchCheese } from "./matcher/cheese-matcher.js";
import { matchUgcSeason } from "./matcher/ugc-season-matcher.js";
import { matchSpace } from "./matcher/space-matcher.js";
import { isUrl, normalizeUrl } from "./matcher/url-normalizer.js";
import { summarizeInput, summarizeUrl } from "../safe-error-context.js";

/**
 * matcher 管道 - 按优先级排列，新增类型追加到末尾即可
 */
const MATCHERS = [
  matchBv,
  matchBangumi,
  matchFavorites,
  matchCheese,
  matchUgcSeason,
  matchSpace,
] as const;

export class BilibiliResourceParser implements ResourceParserPort {
  async parse(input: string): Promise<ParseResult> {
    // URL 先标准化 (协议升级、去除参数、b23.tv 转换)
    const normalized = isUrl(input) ? normalizeUrl(input) : input.trim();

    for (const matcher of MATCHERS) {
      const result = matcher(normalized);
      if (result) return result;
    }

    const safeInput = isUrl(input)
      ? summarizeUrl(input)
      : summarizeInput(input);

    throw new ResourceParseError(
      `无法识别的输入格式: "${safeInput}"。请提供 BV 号或 B 站视频链接`,
      safeInput,
    );
  }
}
