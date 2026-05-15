/**
 * Bilibili 资源解析器 - 将用户输入解析为 bvid + 资源类型
 *
 * 支持: BV/AV/URL/番剧SS/EP/课程/合集(ml)/b23.tv
 * 参考: downkyicore/DownKyi.Core/BiliApi/BiliUtils/ParseEntrance.cs
 */

import {
  ResourceParseError,
  ResourceType,
  type ParseResult,
  type ResourceParserPort,
} from "@bilibili-downloader/core/ports";
import type { BilibiliWebClient } from "./web-client.js";
import { BV_AV_CONVERT, BILI_API_BASE, DEFAULT_HEADERS } from "./constants.js";

/** BV ID 正则: "BV" + 10 位字母数字 */
const BV_REGEX = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;

/** AV ID 正则: "av" + 数字 */
const AV_REGEX = /^[Aa][Vv]\d+$/;

/** 番剧 SS ID */
const SS_REGEX = /^[Ss][Ss]\d+$/;

/** 番剧 EP ID */
const EP_REGEX = /^[Ee][Pp]\d+$/;

/** 收藏夹 ML ID */
const ML_REGEX = /^[Mm][Ll]\d+$/;

export class BilibiliResourceParser implements ResourceParserPort {
  constructor(private readonly webClient: BilibiliWebClient) {}

  async parse(input: string): Promise<ParseResult> {
    const trimmed = input.trim();

    // 纯 BV 号
    if (BV_REGEX.test(trimmed)) {
      return { bvid: trimmed, cid: 0, type: ResourceType.Video };
    }

    // 纯 AV 号
    if (AV_REGEX.test(trimmed.toLowerCase())) {
      const aid = Number.parseInt(trimmed.substring(2), 10);
      const bvid = this.av2bv(aid);
      return { bvid, cid: 0, type: ResourceType.Video };
    }

    // 番剧 SS ID (需要后续查 season 信息获取 bvid)
    if (SS_REGEX.test(trimmed)) {
      return {
        bvid: "",
        cid: 0,
        type: ResourceType.Bangumi,
        originalUrl: `https://www.bilibili.com/bangumi/play/${trimmed}`,
      };
    }

// 番剧 EP ID
if (EP_REGEX.test(trimmed)) {
  return {
    bvid: "",
    cid: 0,
    type: ResourceType.Bangumi,
    originalUrl: `https://www.bilibili.com/bangumi/play/${trimmed}`,
  };
}

// 合集/收藏夹 ML ID
if (ML_REGEX.test(trimmed)) {
  const mediaId = Number.parseInt(trimmed.substring(2), 10);
  return {
    bvid: "",
    cid: 0,
    type: ResourceType.Favorites,
    mediaId,
    originalUrl: `https://www.bilibili.com/medialist/detail/${trimmed}`,
  };
}

    // URL 模式
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return this.parseUrl(trimmed);
    }

    throw new ResourceParseError(
      `无法识别的输入格式: "${trimmed}"。请提供 BV 号、AV 号或 B 站视频链接`,
      input,
    );
  }

  private async parseUrl(url: string): Promise<ParseResult> {
    // 标准化: http -> https, 移除 query 和末尾 /
    let normalized = url.replace(/^http:\/\//, "https://");
    normalized = normalized.split("?")[0];
    normalized = normalized.replace(/\/$/, "");

    // b23.tv 短链接 -> 跟随重定向获取真实 URL
    if (normalized.includes("b23.tv")) {
      const response = await fetch(url, {
        redirect: "manual",
        headers: DEFAULT_HEADERS,
      });
      const location = response.headers.get("location");
      if (location) {
        return this.parseUrl(location);
      }
      throw new ResourceParseError("b23.tv 短链接重定向失败", url);
    }

    // 番剧: /bangumi/play/ss{id} 或 /bangumi/play/ep{id}
    const bangumiSsMatch = normalized.match(/\/bangumi\/play\/ss(\d+)/i);
    if (bangumiSsMatch) {
      return {
        bvid: "", // 番剧需要后续通过 season API 获取 bvid
        cid: 0,
        type: ResourceType.Bangumi,
        originalUrl: url,
      };
    }

    const bangumiEpMatch = normalized.match(/\/bangumi\/play\/ep(\d+)/i);
    if (bangumiEpMatch) {
      return {
        bvid: "",
        cid: 0,
        type: ResourceType.Bangumi,
        originalUrl: url,
      };
    }

    // 合集/收藏夹: /medialist/detail/ml{id}, /medialist/play/ml{id}, /list/ml{id}
const mlDetailMatch = normalized.match(
  /\/medialist\/detail\/ml(\d+)/i,
);
if (mlDetailMatch) {
  const mediaId = Number.parseInt(mlDetailMatch[1], 10);
  return {
    bvid: "",
    cid: 0,
    type: ResourceType.Favorites,
    mediaId,
    originalUrl: url,
  };
}

const mlPlayMatch = normalized.match(/\/medialist\/play\/ml(\d+)/i);
if (mlPlayMatch) {
  const mediaId = Number.parseInt(mlPlayMatch[1], 10);
  return {
    bvid: "",
    cid: 0,
    type: ResourceType.Favorites,
    mediaId,
    originalUrl: url,
  };
}

const mlListMatch = normalized.match(/\/list\/ml(\d+)/i);
if (mlListMatch) {
  const mediaId = Number.parseInt(mlListMatch[1], 10);
  return {
    bvid: "",
    cid: 0,
    type: ResourceType.Favorites,
    mediaId,
    originalUrl: url,
  };
}

// 课程: /cheese/play/ss{id} 或 /cheese/play/ep{id}
    const cheeseSsMatch = normalized.match(/\/cheese\/play\/ss(\d+)/i);
    if (cheeseSsMatch) {
      return {
        bvid: "",
        cid: 0,
        type: ResourceType.Cheese,
        originalUrl: url,
      };
    }

    const cheeseEpMatch = normalized.match(/\/cheese\/play\/ep(\d+)/i);
    if (cheeseEpMatch) {
      return {
        bvid: "",
        cid: 0,
        type: ResourceType.Cheese,
        originalUrl: url,
      };
    }

    // 普通视频 URL: /video/BVxxx 或 /video/avxxx
    const bvMatch = normalized.match(
      /\/video\/(BV[1-9A-HJ-NP-Za-km-z]{10})/i,
    );
    if (bvMatch) {
      return { bvid: bvMatch[1], cid: 0, type: ResourceType.Video };
    }

    const avMatch = normalized.match(/\/video\/[Aa][Vv](\d+)/);
    if (avMatch) {
      const aid = Number.parseInt(avMatch[1], 10);
      const bvid = this.av2bv(aid);
      return { bvid, cid: 0, type: ResourceType.Video };
    }

    throw new ResourceParseError(
      `无法识别的 URL: "${url}"。请提供有效的 B 站视频或番剧链接`,
      url,
    );
  }

  /**
   * AV 号转 BV 号
   *
   * B 站 AV-BV 互转算法: XOR + 58进制固定置换表
   * 参考: downkyicore/DownKyi.Core/BiliApi/BiliUtils/BvId.cs
   */
  av2bv(aid: number): string {
    const { TABLE, S, XOR, ADD } = BV_AV_CONVERT;
    const num = (BigInt(aid) ^ XOR) + ADD;

    const chars = ["B", "V", "1", "", "", "4", "", "", "1", "", "7", ""];
    for (let i = 0; i < 6; i++) {
      const idx = S[i];
      const charIndex = Number((num / 58n ** BigInt(i)) % 58n);
      chars[idx] = TABLE[charIndex];
    }

    return chars.join("");
  }
}