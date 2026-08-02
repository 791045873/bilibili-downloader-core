/**
 * Bilibili 字幕提供器
 *
 * API: PlayerV2 → 获取字幕URL → 下载JSON → 转换为SRT
 * 参考: downkyicore/DownKyi.Core/BiliApi/VideoStream/VideoStream.cs (GetSubtitle)
 */

import type {
  SubtitleProviderPort,
  SubtitleInfo,
} from "@bilibili-downloader/core/ports";
import type { BilibiliWebClient } from "../bilibili/web-client.js";
import { wbiSign, type WbiKeys } from "../bilibili/wbi-sign.js";
import { BILI_API_BASE, DEFAULT_HEADERS } from "../bilibili/constants.js";
import { logger } from "../logger.js";
import { summarizeText, summarizeUrl } from "../safe-error-context.js";

/** PlayerV2 API 响应 */
interface PlayerV2Response {
  code: number;
  data: {
    subtitle?: {
      subtitles: {
        lan: string;
        lan_doc: string;
        subtitle_url: string;
      }[];
    };
  };
}

/** 字幕 JSON 格式 */
interface SubtitleJson {
  body: {
    from: number;
    to: number;
    content: string;
  }[];
}

export class BilibiliSubtitleProvider implements SubtitleProviderPort {
  private wbiKeys: WbiKeys | null = null;

  constructor(private readonly webClient: BilibiliWebClient) {}

  async fetchSubtitles(
    bvid: string,
    cid: number,
    cookieString?: string,
  ): Promise<SubtitleInfo[]> {
    // 1. 获取 WBI Keys
    if (!this.wbiKeys) {
      await this.initWbiKeys(cookieString);
    }
    if (!this.wbiKeys) {
      return [];
    }

    // 2. 调用 PlayerV2 API
    const params = await wbiSign(
      { bvid, cid },
      this.wbiKeys.imgKey,
      this.wbiKeys.subKey,
    );

    const query = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    let playerData: PlayerV2Response;
    try {
      playerData = await this.webClient.requestJson<PlayerV2Response>(
        `${BILI_API_BASE}/x/player/wbi/v2?${query}`,
        cookieString,
      );
    } catch (err) {
      logger.warn(
        `字幕接口调用失败，返回空字幕: bvid=${bvid}, cid=${cid}, reason=${summarizeText((err as Error).message)}`,
      );
      return [];
    }

    if (playerData.code !== 0) {
      logger.warn(
        `字幕接口返回非成功状态，按空字幕处理: bvid=${bvid}, cid=${cid}, code=${playerData.code}`,
      );
      return [];
    }

    if (!playerData.data.subtitle?.subtitles?.length) {
      return [];
    }

    // 3. 下载每个字幕的 JSON 并转换为 SRT
    const results: SubtitleInfo[] = [];

    for (const sub of playerData.data.subtitle.subtitles) {
      const subtitleUrl = sub.subtitle_url.startsWith("http")
        ? sub.subtitle_url
        : `https:${sub.subtitle_url}`;

      try {
        const response = await fetch(subtitleUrl, {
          headers: {
            ...DEFAULT_HEADERS,
            ...(cookieString ? { Cookie: cookieString } : {}),
          },
        });

        const subtitleJson: SubtitleJson =
          (await response.json()) as SubtitleJson;
        const srtContent = jsonToSrt(subtitleJson);

        results.push({
          langKey: sub.lan,
          langName: sub.lan_doc,
          srtContent,
        });
      } catch (err) {
        logger.warn(
          `单个字幕下载失败，跳过该语言: bvid=${bvid}, cid=${cid}, lang=${sub.lan}, url=${summarizeUrl(subtitleUrl)}, reason=${summarizeText((err as Error).message)}`,
        );
        // 单个字幕获取失败不阻塞其他字幕
      }
    }

    return results;
  }

  private async initWbiKeys(cookieString?: string): Promise<void> {
    const navData = await this.webClient.requestJson<{
      code: number;
      data: { wbi_img: { img_url: string; sub_url: string } };
    }>(`${BILI_API_BASE}/x/web-interface/nav`, cookieString);

    const imgUrl = navData.data.wbi_img.img_url;
    const subUrl = navData.data.wbi_img.sub_url;

    this.wbiKeys = {
      imgKey: imgUrl.split("/").pop()?.split(".")[0] ?? "",
      subKey: subUrl.split("/").pop()?.split(".")[0] ?? "",
    };
  }
}

/**
 * 将 B 站字幕 JSON 转换为 SRT 格式
 */
function jsonToSrt(json: SubtitleJson): string {
  const lines: string[] = [];

  for (let i = 0; i < json.body.length; i++) {
    const item = json.body[i];
    lines.push(String(i + 1)); // 序号
    lines.push(`${secToSrtTime(item.from)} --> ${secToSrtTime(item.to)}`); // 时间戳
    lines.push(item.content); // 内容
    lines.push(""); // 空行
  }

  return lines.join("\n");
}

/**
 * 秒数转 SRT 时间戳格式: HH:MM:SS,mmm
 */
function secToSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
