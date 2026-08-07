/**
 * Bilibili 流信息提供器 - 视频元信息 + 播放流
 *
 * 支持: 普通视频 / 番剧 (bangumi) / 课程 (cheese)
 * 普通视频播放流获取失败时，自动回退到 WebPage 抓取兜底。
 * 基于 bilibili-api-sdk 实现。
 */

import { ResourceType } from "@bilibili-downloader/core/ports";
import type {
  StreamProviderPort,
  StreamInput,
  VideoInfo,
  VideoPage,
  PlayStreams,
  UgcSection,
  UgcEpisode,
} from "@bilibili-downloader/core/ports";
import type { MediaStreamInfo } from "@bilibili-downloader/core/domain";
import {
  BiliError,
  type DashStreamItem,
  type PlayUrlData,
} from "bilibili-api-sdk";
import type { BilibiliSdkClient } from "./sdk-client.js";
import { BILI_WWW_BASE } from "./constants.js";

/** 默认 fnval: Dash + Dolby + HDR + 4K + 8K + AV1 + H.265 */
const DEFAULT_FNVAL = 4048;

export class BilibiliStreamProvider implements StreamProviderPort {
  constructor(private readonly sdk: BilibiliSdkClient) {}

  async getVideoInfo(bvid: string): Promise<VideoInfo> {
    const v = await this.sdk.client.video.view({ bvid });

    const publishTime =
      (v.pubdate ?? v.ctime)
        ? new Date((v.pubdate ?? v.ctime) * 1000).toISOString().split("T")[0]
        : "";

    return {
      bvid: v.bvid,
      avid: v.aid,
      title: v.title,
      duration: v.duration,
      coverUrl: v.pic,
      upperName: v.owner.name,
      upperMid: v.owner.mid,
      upperFace: v.owner.face,
      playCount: formatCount(v.stat.view),
      danmakuCount: formatCount(v.stat.danmaku),
      publishTime,
      description: v.desc ?? "",
      videoZone: v.tname ?? "",
      typeId: v.tid ?? 0,
      // 合集数据：
      // ugc_season.sections → UgcSection[] → episodes → UgcEpisode[] → pages → VideoPage[]
      ugcSeason: v.ugc_season
        ? {
            id: v.ugc_season.id,
            title: v.ugc_season.title,
            cover: v.ugc_season.cover ?? "",
            sections: (v.ugc_season.sections ?? []).map(
              (s): UgcSection => ({
                id: s.section_id,
                seasonId: s.season_id,
                title: s.title,
                episodes: (s.episodes ?? []).map(
                  (ep): UgcEpisode => ({
                    aid: ep.aid,
                    bvid: ep.bvid ?? "",
                    cid: ep.cid,
                    title: ep.title,
                    pages: (ep.pages ?? []).map(
                      (p): VideoPage => ({
                        cid: p.cid,
                        page: p.page,
                        title: p.part,
                        duration: p.duration,
                      }),
                    ),
                  }),
                ),
              }),
            ),
          }
        : undefined,
      // 当前视频的分P列表
      pages: v.pages.map(
        (p): VideoPage => ({
          cid: p.cid,
          page: p.page,
          title: p.part,
          duration: p.duration,
        }),
      ),
    };
  }

  async getPlayStreams(input: StreamInput): Promise<PlayStreams> {
    this.sdk.useCookie(input.cookieString);

    let data: PlayUrlData;
    try {
      switch (input.resourceType) {
        case ResourceType.Bangumi:
          data = await this.sdk.client.bangumi.playurl(this.playUrlParams(input));
          break;
        case ResourceType.Cheese:
          data = await this.sdk.client.cheese.playurl(this.playUrlParams(input));
          break;
        case ResourceType.Video:
        default:
          data = await this.getVideoPlayUrlWithFallback(input);
          break;
      }
    } catch (err) {
      const code = err instanceof BiliError ? err.code : undefined;
      throw new Error(
        `获取播放流失败: code=${code ?? "unknown"}, message=${(err as Error).message}`,
      );
    }

    const dash = data.dash;
    if (!dash) {
      throw new Error("该视频无 DASH 流 (可能是 FLV 格式)");
    }

    return {
      videoStreams: (dash.video ?? []).map((s) =>
        this.dashToMediaStream(s, "video"),
      ),
      audioStreams: (dash.audio ?? []).map((s) =>
        this.dashToMediaStream(s, "audio"),
      ),
    };
  }

  // ========== 私有方法 ==========

  private playUrlParams(input: StreamInput) {
    return {
      bvid: input.bvid,
      cid: input.cid,
      qn: 0,
      fnval: DEFAULT_FNVAL,
      fnver: 0,
      fourk: 1,
    };
  }

  /**
   * 普通视频播放流 (API + WebPage 兜底)
   * 先尝试 WBI 签名 API，失败后回退到 WebPage 抓取
   */
  private async getVideoPlayUrlWithFallback(
    input: StreamInput,
  ): Promise<PlayUrlData> {
    try {
      return await this.sdk.client.video.playurl(this.playUrlParams(input));
    } catch (err) {
      if (err instanceof BiliError && (err.code === -404 || err.code === -400)) {
        return this.getVideoPlayUrlWebPage(input);
      }
      throw err;
    }
  }

  /**
   * 普通视频播放流 WebPage 兜底
   * 请求视频页面 HTML，从 <script>window.__playinfo__=...</script> 中提取播放流数据
   * 此方式无需 WBI 签名，作为 API 失败时的备用方案
   */
  private async getVideoPlayUrlWebPage(input: StreamInput): Promise<PlayUrlData> {
    const url = `${BILI_WWW_BASE}/video/${input.bvid}/`;

    const response = await this.sdk.client.http.get<string>(url, { raw: true });
    const html = response.body;

    // 提取 window.__playinfo__
    const regex = /<script>window\.__playinfo__\s*=\s*({.*?})<\/script>/;
    const match = html.match(regex);
    if (!match) {
      throw new Error(
        `WebPage 兜底失败: 未从页面中提取到 __playinfo__ (bvid=${input.bvid})`,
      );
    }

    const playinfo = JSON.parse(match[1]) as {
      code: number;
      message?: string;
      data?: PlayUrlData;
      result?: PlayUrlData;
    };

    // 兼容两种响应格式: data 字段 或 result 字段
    const responseData = playinfo.data ?? playinfo.result;
    if (!responseData) {
      throw new Error(
        `WebPage 兜底失败: __playinfo__ 中无 data/result 字段 (bvid=${input.bvid})`,
      );
    }

    return responseData;
  }

  private dashToMediaStream(
    stream: DashStreamItem,
    type: "video" | "audio",
  ): MediaStreamInfo {
    const url = stream.baseUrl || stream.base_url || "";
    const mimeType = stream.mimeType || stream.mime_type || "";
    const format = mimeType.split("/")[1] ?? (type === "video" ? "m4s" : "m4a");

    return {
      url,
      codec: stream.codecs || "unknown",
      quality: stream.id,
      format,
    };
  }
}

function formatCount(n: number): string {
  if (n >= 10000) {
    return `${(n / 10000).toFixed(1)}万`;
  }
  return String(n);
}
