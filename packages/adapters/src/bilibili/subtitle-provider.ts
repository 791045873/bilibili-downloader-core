/**
 * Bilibili 字幕提供器
 *
 * API: PlayerV2 → 获取字幕URL → 下载JSON → 转换为SRT
 * 基于 bilibili-api-sdk 实现。
 */

import type {
  SubtitleProviderPort,
  SubtitleInfo,
} from "@bilibili-downloader/core/ports";
import type { PlayerSubtitleItem, SubtitleJsonBody } from "bilibili-api-sdk";
import type { BilibiliSdkClient } from "./sdk-client.js";
import { logger } from "../logger.js";
import { summarizeText, summarizeUrl } from "../safe-error-context.js";

export class BilibiliSubtitleProvider implements SubtitleProviderPort {
  constructor(private readonly sdk: BilibiliSdkClient) {}

  async fetchSubtitles(
    bvid: string,
    cid: number,
    cookieString?: string,
  ): Promise<SubtitleInfo[]> {
    this.sdk.useCookie(cookieString);

    // 1. 调用 PlayerV2 API 获取字幕列表
    let subtitles: PlayerSubtitleItem[] | undefined;
    try {
      const playerData = await this.sdk.client.player.playerV2({ bvid, cid });
      subtitles = playerData.subtitle?.subtitles;
    } catch (err) {
      logger.warn(
        `字幕接口调用失败，返回空字幕: bvid=${bvid}, cid=${cid}, reason=${summarizeText((err as Error).message)}`,
      );
      return [];
    }

    if (!subtitles?.length) {
      return [];
    }

    // 2. 下载每个字幕的 JSON 并转换为 SRT
    const results: SubtitleInfo[] = [];

    for (const sub of subtitles) {
      const subtitleUrl = sub.subtitle_url.startsWith("http")
        ? sub.subtitle_url
        : `https:${sub.subtitle_url}`;

      try {
        const response = await this.sdk.client.http.get<SubtitleJsonBody>(
          subtitleUrl,
        );
        const srtContent = jsonToSrt(response.body);

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
}

/**
 * 将 B 站字幕 JSON 转换为 SRT 格式
 */
function jsonToSrt(json: SubtitleJsonBody): string {
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
