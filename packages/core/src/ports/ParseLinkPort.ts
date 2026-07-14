export interface PaginatedVideos {
  items: VideoSummary[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface VideoSummary {
  bvid: string;
  cid: number;
  title: string;
  cover?: string;
  duration: number;
}

export interface UgcSeasonSummary {
  seasonId: number;
  title: string;
  cover?: string;
  videoCount: number;
}

export interface UserSpaceResult {
  mid: number;
  name: string;
  face?: string;
  videos: PaginatedVideos;
  seasons: UgcSeasonSummary[];
}

export interface UgcSeasonResult {
  seasonId: number;
  title: string;
  cover?: string;
  upperName?: string;
  videos: PaginatedVideos;
}

export interface FavoritesResult {
  mediaId: number;
  title: string;
  cover?: string;
  upperName?: string;
  videos: PaginatedVideos;
}

export interface ParseLinkResult {
  type: "video" | "user-space" | "ugc-season" | "favorites";
  data: VideoParseResult | UserSpaceResult | UgcSeasonResult | FavoritesResult;
}

export interface VideoParseResult {
  bvid: string;
  avid: number;
  title: string;
  duration: number;
  coverUrl: string;
  upperName: string;
  upperMid: number;
  upperFace?: string;
  playCount: string;
  danmakuCount: string;
  publishTime: string;
  description: string;
  videoZone: string;
  typeId: number;
  pages: Array<{
    cid: number;
    page: number;
    title: string;
    duration: number;
  }>;
  ugcSeason?: {
    seasonId: number;
    title: string;
    cover: string;
    sections: Array<{
      id: number;
      seasonId: number;
      title: string;
      episodes: Array<{
        aid: number;
        bvid: string;
        cid: number;
        title: string;
        pages: Array<{
          cid: number;
          page: number;
          title: string;
          duration: number;
        }>;
      }>;
    }>;
  };
}
