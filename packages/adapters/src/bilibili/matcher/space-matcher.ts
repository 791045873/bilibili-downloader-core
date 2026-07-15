import {
  ResourceType,
  type ParseResult,
} from "@bilibili-downloader/core/ports";

const SPACE_REGEX = /^https:\/\/space\.bilibili\.com\/(\d+)(?:\/video)?\/?$/;

export function matchSpace(input: string): ParseResult | null {
  const match = input.match(SPACE_REGEX);
  if (!match) {
    return null;
  }

  return {
    bvid: "",
    cid: 0,
    type: ResourceType.UserSpace,
    mid: Number.parseInt(match[1], 10),
    originalUrl: input,
  };
}
