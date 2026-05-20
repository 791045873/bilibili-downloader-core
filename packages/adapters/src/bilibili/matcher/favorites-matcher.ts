/**
 * 收藏夹匹配器
 *
 * 支持:
 * - 纯 ML ID: "ml1329019876"
 * - URL 中的 ML: "/medialist/detail/ml{id}", "/medialist/play/ml{id}", "/list/ml{id}"
 * - 空间收藏夹: "space.bilibili.com/{uid}/favlist?fid={id}"
 */

import { ResourceType, type ParseResult } from "@bilibili-downloader/core/ports";


/** space.bilibili.com 收藏夹 URL */
const SPACE_FAVLIST_REGEX = /^https:\/\/space\.bilibili\.com\/\d+\/favlist/;

/** 从 query 中提取 fid */
const FID_REGEX = /[?&]fid=(\d+)/;

/**
 * 匹配收藏夹 (纯 ID 或 URL)
 */
export function matchFavorites(input: string): ParseResult | null {
  // 空间收藏夹: https://space.bilibili.com/{uid}/favlist?fid={id}
  if (SPACE_FAVLIST_REGEX.test(input)) {
    const fidMatch = input.match(FID_REGEX);
    if (fidMatch) {
      const mediaId = Number.parseInt(fidMatch[1], 10);
      return {
        bvid: "",
        cid: 0,
        type: ResourceType.Favorites,
        mediaId,
        originalUrl: input,
      };
    }
  }

  return null;
}