/**
 * Bilibili 收藏夹/收藏夹提供器
 *
 * API 端点:
 * - 收藏夹信息: GET /x/v3/fav/folder/info?media_id={mediaId}
 * - 收藏夹视频列表: GET /x/v3/fav/resource/list?media_id={mediaId}&pn={pn}&ps={ps}&platform=web
 * 参考: downkyicore/DownKyi.Core/BiliApi/Favorites/
 */

import type {
  FavoritesProviderPort,
  FavoritesInfo,
  FavoritesVideoPage,
  FavoritesVideo,
} from "@bilibili-downloader/core/ports";
import type { BilibiliWebClient } from "../bilibili/web-client.js";
import { BILI_API_BASE } from "../bilibili/constants.js";

/** B 站 API 响应结构 */
interface FavoritesInfoResponse {
  code: number;
  message: string;
  data: {
    id: number;
    title: string;
    cover: string;
    media_count: number;
  };
}

interface FavoritesResourceResponse {
  code: number;
  message: string;
  data: {
    info: {
      id: number;
      title: string;
      cover: string;
      media_count: number;
    };
    medias: {
      id: number;
      bvid: string;
      title: string;
      cover: string;
      duration: number;
      page: number;
    }[];
    has_more: boolean;
  };
}

export class BilibiliFavoritesProvider implements FavoritesProviderPort {
  constructor(private readonly webClient: BilibiliWebClient) {}

  async getFavoritesInfo(
    mediaId: number,
    cookieString?: string,
  ): Promise<FavoritesInfo> {
    const url = `${BILI_API_BASE}/x/v3/fav/folder/info?media_id=${mediaId}`;
    const response = await this.webClient.requestJson<FavoritesInfoResponse>(
      url,
      cookieString,
    );

    if (response.code !== 0) {
      throw new Error(
        `获取收藏夹信息失败: code=${response.code}, ${response.message}`,
      );
    }

    return {
      mediaId: response.data.id,
      title: response.data.title,
      mediaCount: response.data.media_count,
      coverUrl: response.data.cover,
    };
  }

  async getFavoritesVideos(
    mediaId: number,
    page: number,
    pageSize = 20,
    cookieString?: string,
  ): Promise<FavoritesVideoPage> {
    const url =
      `${BILI_API_BASE}/x/v3/fav/resource/list` +
      `?media_id=${mediaId}&pn=${page}&ps=${pageSize}&platform=web`;

    const response = await this.webClient.requestJson<FavoritesResourceResponse>(
      url,
      cookieString,
    );

    if (response.code !== 0) {
      throw new Error(
        `获取收藏夹视频列表失败: code=${response.code}, ${response.message}`,
      );
    }

    return {
      videos: response.data.medias.map(
        (m): FavoritesVideo => ({
          bvid: m.bvid,
          avid: m.id,
          title: m.title,
          pageCount: m.page,
          duration: m.duration,
          coverUrl: m.cover,
        }),
      ),
      hasMore: response.data.has_more,
    };
  }
}