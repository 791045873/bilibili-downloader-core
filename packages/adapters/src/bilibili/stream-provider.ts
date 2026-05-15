/**
 * Bilibili 流信息提供器 - 视频元信息 + 播放流
 *
 * 支持: 普通视频 / 番剧 (bangumi) / 课程 (cheese)
 * 参考: downkyicore/DownKyi.Core/BiliApi/VideoStream/VideoStream.cs
 *      downkyicore/DownKyi.Core/BiliApi/Video/VideoInfo.cs
 */

import { ResourceType } from "@bilibili-downloader/core/ports";
import type {
  StreamProviderPort,
  StreamInput,
  VideoInfo,
  VideoPage,
  PlayStreams,
} from "@bilibili-downloader/core/ports";
import type { MediaStreamInfo } from "@bilibili-downloader/core/domain";
import type { BilibiliWebClient } from "./web-client.js";
import type {
  BiliVideoInfo,
  BiliPlayUrlResponse,
  BiliDashStream,
} from "./types.js";
import { wbiSign, type WbiKeys } from "./wbi-sign.js";
import { BILI_API_BASE, DEFAULT_HEADERS } from "./constants.js";

/** API 端点 */
const API = {
  /** 导航 (获取 WBI Keys) */
  NAV: `${BILI_API_BASE}/x/web-interface/nav`,
  /** 普通视频信息 (WBI 签名) */
  VIDEO_INFO: `${BILI_API_BASE}/x/web-interface/wbi/view`,
  /** 普通视频播放流 (WBI 签名) */
  VIDEO_PLAYURL: `${BILI_API_BASE}/x/player/wbi/playurl`,
  /** 番剧播放流 (无需 WBI) */
  BANGUMI_PLAYURL: `${BILI_API_BASE}/pgc/player/web/playurl`,
  /** 课程播放流 (无需 WBI) */
  CHEESE_PLAYURL: `${BILI_API_BASE}/pugv/player/web/playurl`,
} as const;

/** 默认 fnval: Dash + Dolby + HDR + 4K + 8K + AV1 + H.265 */
const DEFAULT_FNVAL = 4048;

export class BilibiliStreamProvider implements StreamProviderPort {
  private wbiKeys: WbiKeys | null = null;

  constructor(
    private readonly webClient: BilibiliWebClient,
  ) {}

  /**
   * 初始化 WBI Keys (从 Nav API 获取)
   */
  async initWbiKeys(cookieString?: string): Promise<void> {
    const navData = await this.webClient.requestJson<{
      code: number;
      data: { wbi_img: { img_url: string; sub_url: string } };
    }>(API.NAV, cookieString);

    const imgUrl = navData.data.wbi_img.img_url;
    const subUrl = navData.data.wbi_img.sub_url;

    this.wbiKeys = {
      imgKey: imgUrl.split("/").pop()?.split(".")[0] ?? "",
      subKey: subUrl.split("/").pop()?.split(".")[0] ?? "",
    };
  }

  async getVideoInfo(bvid: string): Promise<VideoInfo> {
    const params = await this.signWbi({ bvid });

    const data = await this.webClient.requestJson<{
      code: number;
      data: BiliVideoInfo;
    }>(`${API.VIDEO_INFO}?${toQueryString(params)}`);

    if (data.code !== 0) {
      throw new Error(`获取视频信息失败: code=${data.code}`);
    }

    const v = data.data;
    return {
      bvid: v.bvid,
      avid: v.aid,
      title: v.title,
      duration: v.duration,
      coverUrl: v.pic,
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
    const cookieString = input.cookieString;
    let data: BiliPlayUrlResponse;

    switch (input.resourceType) {
      case ResourceType.Bangumi:
        data = await this.getBangumiPlayUrl(input, cookieString);
        break;
      case ResourceType.Cheese:
        data = await this.getCheesePlayUrl(input, cookieString);
        break;
      case ResourceType.Video:
      default:
        data = await this.getVideoPlayUrl(input, cookieString);
        break;
    }

    if (data.code !== 0) {
      throw new Error(
        `获取播放流失败: code=${data.code}, message=${data.message}`,
      );
    }

    const dash = data.data.dash;
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

  /** 普通视频播放流 (WBI 签名) */
  private async getVideoPlayUrl(
    input: StreamInput,
    cookieString?: string,
  ): Promise<BiliPlayUrlResponse> {
    const params = await this.signWbi({
      bvid: input.bvid,
      cid: input.cid,
      qn: 0, // 0 表示返回所有可用清晰度
      fnval: DEFAULT_FNVAL,
      fnver: 0,
      fourk: 1,
    });

    return this.webClient.requestJson<BiliPlayUrlResponse>(
      `${API.VIDEO_PLAYURL}?${toQueryString(params)}`,
      cookieString,
    );
  }

  /** 番剧播放流 (无 WBI 签名，直接请求) */
  private async getBangumiPlayUrl(
    input: StreamInput,
    cookieString?: string,
  ): Promise<BiliPlayUrlResponse> {
    const params = new URLSearchParams({
      bvid: input.bvid,
      cid: String(input.cid),
      qn: "0",
      fnval: String(DEFAULT_FNVAL),
      fnver: "0",
      fourk: "1",
    });

    const url = `${API.BANGUMI_PLAYURL}?${params.toString()}`;
    return this.webClient.requestJson<BiliPlayUrlResponse>(url, cookieString);
  }

  /** 课程播放流 (无 WBI 签名) */
  private async getCheesePlayUrl(
    input: StreamInput,
    cookieString?: string,
  ): Promise<BiliPlayUrlResponse> {
    const params = new URLSearchParams({
      bvid: input.bvid,
      cid: String(input.cid),
      qn: "0",
      fnval: String(DEFAULT_FNVAL),
      fnver: "0",
      fourk: "1",
    });

    const url = `${API.CHEESE_PLAYURL}?${params.toString()}`;
    return this.webClient.requestJson<BiliPlayUrlResponse>(url, cookieString);
  }

  private dashToMediaStream(
    stream: BiliDashStream,
    type: "video" | "audio",
  ): MediaStreamInfo {
    const url = stream.baseUrl || stream.base_url || "";
    const mimeType = stream.mimeType || stream.mime_type || "";
    const format =
      mimeType.split("/")[1] ?? (type === "video" ? "m4s" : "m4a");

    return {
      url,
      codec: stream.codecs || "unknown",
      quality: stream.id,
      format,
    };
  }

  private async signWbi(
    params: Record<string, string | number | undefined>,
  ): Promise<Record<string, string>> {
    if (!this.wbiKeys) {
      await this.initWbiKeys();
    }
    if (!this.wbiKeys) {
      throw new Error("无法获取 WBI Keys");
    }
    return wbiSign(params, this.wbiKeys.imgKey, this.wbiKeys.subKey);
  }
}

function toQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
    )
    .join("&");
}