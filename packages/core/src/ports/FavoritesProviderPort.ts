/**
 * 合集/收藏夹提供端口 - 获取合集视频列表
 *
 * 参考: downkyicore/DownKyi.Core/BiliApi/Favorites/FavoritesResource.cs
 */

export interface FavoritesProviderPort {
  /**
   * 获取合集元信息 (标题、视频数量)
   */
  getFavoritesInfo(mediaId: number, cookieString?: string): Promise<FavoritesInfo>;

  /**
   * 分页获取合集视频列表
   */
  getFavoritesVideos(
    mediaId: number,
    page: number,
    pageSize?: number,
    cookieString?: string,
  ): Promise<FavoritesVideoPage>;
}

export interface FavoritesInfo {
  mediaId: number;
  title: string;
  mediaCount: number;
  coverUrl: string;
}

export interface FavoritesVideoPage {
  videos: FavoritesVideo[];
  hasMore: boolean;
}

export interface FavoritesVideo {
  bvid: string;
  avid: number;
  title: string;
  /** 分 P 数量 */
  pageCount: number;
  /** 时长 (秒) */
  duration: number;
  /** 封面 URL */
  coverUrl: string;
}