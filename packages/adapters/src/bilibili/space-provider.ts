import type {
  PaginatedVideos,
  UgcSeasonSummary,
  VideoSummary,
} from "@bilibili-downloader/core/ports";
import type { BilibiliWebClient } from "./web-client.js";
import { BILI_API_BASE } from "./constants.js";
import { wbiSign, type WbiKeys } from "./wbi-sign.js";

interface UserInfoResponse {
  code: number;
  message: string;
  data: {
    mid: number;
    name: string;
    face?: string;
  };
}

interface UserVideosResponse {
  code: number;
  message: string;
  data?: {
    list?: {
      vlist?: Array<Record<string, unknown>>;
    };
    page?: {
      pn?: number;
      ps?: number;
      count?: number;
    };
  };
}

interface SeasonsListResponse {
  code: number;
  message: string;
  data?: {
    items_lists?: {
      seasons_list?: Array<Record<string, unknown>>;
    };
  };
}

interface SeasonVideosResponse {
  code: number;
  message: string;
  data?: {
    archives?: Array<Record<string, unknown>>;
    page?: {
      page_num?: number;
      page_size?: number;
      total?: number;
    };
    meta?: {
      name?: string;
      cover?: string;
      mid?: number;
      upper?: string;
      upper_name?: string;
    };
  };
}

interface NavResponse {
  code: number;
  data: {
    wbi_img: {
      img_url: string;
      sub_url: string;
    };
  };
}

const API = {
  NAV: `${BILI_API_BASE}/x/web-interface/nav`,
  USER_INFO: `${BILI_API_BASE}/x/space/acc/info`,
  USER_VIDEOS: `${BILI_API_BASE}/x/space/wbi/arc/search`,
  USER_SEASONS: `${BILI_API_BASE}/x/polymer/web-space/seasons_series_list`,
  SEASON_VIDEOS: `${BILI_API_BASE}/x/polymer/web-space/seasons_archives_list`,
} as const;

export interface SpaceUserInfo {
  mid: number;
  name: string;
  face?: string;
}

export interface UgcSeasonVideosPage extends PaginatedVideos {
  title?: string;
  cover?: string;
  upperName?: string;
}

export class BilibiliSpaceProvider {
  private wbiKeys: WbiKeys | null = null;

  constructor(private readonly webClient: BilibiliWebClient) {}

  async getUserInfo(mid: number, cookieString?: string): Promise<SpaceUserInfo> {
    const response = await this.webClient.requestJson<UserInfoResponse>(
      `${API.USER_INFO}?mid=${mid}`,
      cookieString,
    );

    if (response.code !== 0) {
      throw new Error(`获取用户信息失败: code=${response.code}, ${response.message}`);
    }

    return {
      mid: response.data.mid,
      name: response.data.name,
      face: response.data.face,
    };
  }

  async getUserVideos(
    mid: number,
    page: number,
    pageSize: number,
    cookieString?: string,
  ): Promise<PaginatedVideos> {
    const params = await this.signWbi({
      mid,
      pn: page,
      ps: pageSize,
      tid: 0,
      keyword: "",
      order: "pubdate",
      platform: "web",
      web_location: 1550101,
    });

    const response = await this.webClient.requestJson<UserVideosResponse>(
      `${API.USER_VIDEOS}?${toQueryString(params)}`,
      cookieString,
    );

    if (response.code !== 0) {
      throw new Error(`获取用户投稿失败: code=${response.code}, ${response.message}`);
    }

    const items = (response.data?.list?.vlist ?? []).map(mapVideoSummary);
    const total = response.data?.page?.count ?? 0;
    const pn = response.data?.page?.pn ?? page;
    const ps = response.data?.page?.ps ?? pageSize;

    return {
      items,
      page: pn,
      pageSize: ps,
      total,
      hasMore: pn * ps < total,
    };
  }

  async getUserSeasons(mid: number, cookieString?: string): Promise<UgcSeasonSummary[]> {
    const response = await this.webClient.requestJson<SeasonsListResponse>(
      `${API.USER_SEASONS}?mid=${mid}&page_num=1&page_size=50`,
      cookieString,
    );

    if (response.code !== 0) {
      throw new Error(`获取用户合集失败: code=${response.code}, ${response.message}`);
    }

    const seasons = response.data?.items_lists?.seasons_list ?? [];
    return seasons.map((item) => ({
      seasonId: toNumber(item.season_id ?? item.id),
      title: toString(item.name ?? item.title),
      cover: toOptionalString(item.cover),
      videoCount: toNumber(item.total ?? item.video_count ?? item.count),
    }));
  }

  async getUgcSeasonVideos(
    seasonId: number,
    page: number,
    pageSize: number,
    cookieString?: string,
  ): Promise<UgcSeasonVideosPage> {
    const response = await this.webClient.requestJson<SeasonVideosResponse>(
      `${API.SEASON_VIDEOS}?season_id=${seasonId}&page_num=${page}&page_size=${pageSize}`,
      cookieString,
    );

    if (response.code !== 0) {
      throw new Error(`获取合集视频失败: code=${response.code}, ${response.message}`);
    }

    const items = (response.data?.archives ?? []).map(mapVideoSummary);
    const currentPage = response.data?.page?.page_num ?? page;
    const currentSize = response.data?.page?.page_size ?? pageSize;
    const total = response.data?.page?.total ?? 0;

    return {
      items,
      page: currentPage,
      pageSize: currentSize,
      total,
      hasMore: currentPage * currentSize < total,
      title: response.data?.meta?.name,
      cover: response.data?.meta?.cover,
      upperName: response.data?.meta?.upper_name ?? response.data?.meta?.upper,
    };
  }

  private async initWbiKeys(cookieString?: string): Promise<void> {
    const navData = await this.webClient.requestJson<NavResponse>(API.NAV, cookieString);
    const imgUrl = navData.data.wbi_img.img_url;
    const subUrl = navData.data.wbi_img.sub_url;

    this.wbiKeys = {
      imgKey: imgUrl.split("/").pop()?.split(".")[0] ?? "",
      subKey: subUrl.split("/").pop()?.split(".")[0] ?? "",
    };
  }

  private async signWbi(
    params: Record<string, string | number | undefined>,
    cookieString?: string,
  ): Promise<Record<string, string>> {
    if (!this.wbiKeys) {
      await this.initWbiKeys(cookieString);
    }
    if (!this.wbiKeys) {
      throw new Error("无法获取 WBI Keys");
    }
    return wbiSign(params, this.wbiKeys.imgKey, this.wbiKeys.subKey);
  }
}

function mapVideoSummary(item: Record<string, unknown>): VideoSummary {
  return {
    bvid: toString(item.bvid),
    cid: toNumber(item.cid ?? item.first_cid ?? item.firstCid),
    title: toString(item.title),
    cover: toOptionalString(item.pic ?? item.cover),
    duration: toNumber(item.length ?? item.duration),
  };
}

function toQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toOptionalString(value: unknown): string | undefined {
  const s = toString(value);
  return s.length > 0 ? s : undefined;
}
