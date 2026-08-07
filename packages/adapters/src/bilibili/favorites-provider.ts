/**
 * Bilibili 收藏夹提供器
 *
 * API 端点 (由 bilibili-api-sdk 封装):
 * - 收藏夹信息: GET /x/v3/fav/folder/info?media_id={mediaId}
 * - 收藏夹视频列表: GET /x/v3/fav/resource/list?media_id={mediaId}&pn={pn}&ps={ps}&platform=web
 */

import type {
  FavoritesProviderPort,
  FavoritesInfo,
  FavoritesVideoPage,
  FavoritesVideo,
} from "@bilibili-downloader/core/ports";
import type { BilibiliSdkClient } from "./sdk-client.js";

export class BilibiliFavoritesProvider implements FavoritesProviderPort {
  constructor(private readonly sdk: BilibiliSdkClient) {}

  async getFavoritesInfo(
    mediaId: number,
    cookieString?: string,
  ): Promise<FavoritesInfo> {
    this.sdk.useCookie(cookieString);

    const data = await this.sdk.client.favorite.folderInfo(mediaId);

    return {
      mediaId: data.id,
      title: data.title,
      mediaCount: data.media_count ?? data.count ?? 0,
      coverUrl: data.cover,
    };
  }

  async getFavoritesVideos(
    mediaId: number,
    page: number,
    pageSize = 20,
    cookieString?: string,
  ): Promise<FavoritesVideoPage> {
    this.sdk.useCookie(cookieString);

    const data = await this.sdk.client.favorite.resourceList({
      mediaId,
      pn: page,
      ps: pageSize,
      platform: "web",
    });

    return {
      videos: (data.medias ?? []).map(
        (m): FavoritesVideo => ({
          bvid: m.bvid,
          avid: m.id,
          title: m.title,
          pageCount: m.page,
          duration: m.duration,
          coverUrl: m.cover,
        }),
      ),
      hasMore: data.has_more,
    };
  }
}
