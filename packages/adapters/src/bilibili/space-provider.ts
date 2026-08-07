import type {
  PaginatedVideos,
  UgcSeasonSummary,
  VideoSummary,
} from "@bilibili-downloader/core/ports";
import type { BilibiliSdkClient } from "./sdk-client.js";

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
  constructor(private readonly sdk: BilibiliSdkClient) {}

  async getUserInfo(
    mid: number,
    cookieString?: string,
  ): Promise<SpaceUserInfo> {
    this.sdk.useCookie(cookieString);

    const data = await this.sdk.client.user.accInfo(mid);

    return {
      mid: data.mid,
      name: data.name,
      face: data.face,
    };
  }

  async getUserVideos(
    mid: number,
    page: number,
    pageSize: number,
    cookieString?: string,
  ): Promise<PaginatedVideos> {
    this.sdk.useCookie(cookieString);

    const data = await this.sdk.client.user.spaceArcSearch({
      mid,
      pn: page,
      ps: pageSize,
    });

    const items = (data.list?.vlist ?? []).map((item) =>
      mapVideoSummary(item as Record<string, unknown>),
    );
    const total = data.page?.count ?? 0;
    const pn = data.page?.pn ?? page;
    const ps = data.page?.ps ?? pageSize;

    return {
      items,
      page: pn,
      pageSize: ps,
      total,
      hasMore: pn * ps < total,
    };
  }

  async getUserSeasons(
    mid: number,
    page = 1,
    pageSize = 20,
    cookieString?: string,
  ): Promise<UgcSeasonSummary[]> {
    this.sdk.useCookie(cookieString);

    const data = await this.sdk.client.user.seasonsSeriesList(
      mid,
      page,
      pageSize,
    );

    const seasons = data.items_lists?.seasons_list ?? [];
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
    this.sdk.useCookie(cookieString);

    const data = await this.sdk.client.user.seasonsArchivesList(
      seasonId,
      page,
      pageSize,
    );

    const items = (data.archives ?? []).map(mapVideoSummary);
    const currentPage = data.page?.page_num ?? page;
    const currentSize = data.page?.page_size ?? pageSize;
    const total = data.page?.total ?? 0;

    return {
      items,
      page: currentPage,
      pageSize: currentSize,
      total,
      hasMore: currentPage * currentSize < total,
      title: data.meta?.name,
      cover: data.meta?.cover,
      upperName: data.meta?.upper_name ?? data.meta?.upper,
    };
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
