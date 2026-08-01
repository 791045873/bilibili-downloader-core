import {
  ResourceType,
  type ParseResult,
} from "@bilibili-downloader/core/ports";

const SPACE_REGEX = /^https:\/\/space\.bilibili\.com\/(\d+)$/;

export function matchSpace(input: string): ParseResult | null {
  const normalizedInput = input.split("?")[0]; // 去除查询参数
  const match = normalizedInput.match(SPACE_REGEX);
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
