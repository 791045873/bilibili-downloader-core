import {
  ResourceType,
  type ParseResult,
} from "@bilibili-downloader/core/ports";

const UGC_SEASON_REGEX =
  /^https:\/\/space\.bilibili\.com\/(\d+)\/channel\/collectiondetail(?:\?[^#]*)?$/;
const SID_REGEX = /(?:\?|&)sid=(\d+)/;

export function matchUgcSeason(input: string): ParseResult | null {
  if (!UGC_SEASON_REGEX.test(input)) {
    return null;
  }

  const sidMatch = input.match(SID_REGEX);
  if (!sidMatch) {
    return null;
  }

  return {
    bvid: "",
    cid: 0,
    type: ResourceType.UgcSeason,
    seasonId: Number.parseInt(sidMatch[1], 10),
    originalUrl: input,
  };
}
