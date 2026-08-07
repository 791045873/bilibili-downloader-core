/**
 * Bilibili API 适配器 - 聚合导出
 */

import { createBilibiliSdkClient, type BilibiliSdkClient } from "./sdk-client.js";
import { BilibiliResourceParser } from "./resource-parser.js";
import { BilibiliStreamProvider } from "./stream-provider.js";
import { BilibiliSubtitleProvider } from "./subtitle-provider.js";

export interface BilibiliApiAdapter {
  sdkClient: BilibiliSdkClient;
  resourceParser: BilibiliResourceParser;
  streamProvider: BilibiliStreamProvider;
  subtitleProvider: BilibiliSubtitleProvider;
}

/**
 * 创建 Bilibili API 适配器
 */
export function createBilibiliApiAdapter(
  cookieString?: string,
): BilibiliApiAdapter {
  const sdkClient = createBilibiliSdkClient(cookieString);

  return {
    sdkClient,
    resourceParser: new BilibiliResourceParser(),
    streamProvider: new BilibiliStreamProvider(sdkClient),
    subtitleProvider: new BilibiliSubtitleProvider(sdkClient),
  };
}
