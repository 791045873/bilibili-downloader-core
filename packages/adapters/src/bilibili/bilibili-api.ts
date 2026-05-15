/**
 * Bilibili API 适配器 - 聚合导出
 */

import { createBilibiliWebClient, type BilibiliWebClient } from "./web-client.js";
import { BilibiliResourceParser } from "./resource-parser.js";
import { BilibiliStreamProvider } from "./stream-provider.js";

export interface BilibiliApiAdapter {
  webClient: BilibiliWebClient;
  resourceParser: BilibiliResourceParser;
  streamProvider: BilibiliStreamProvider;
}

/**
 * 创建 Bilibili API 适配器
 */
export function createBilibiliApiAdapter(
  cookieString?: string,
): BilibiliApiAdapter {
  const webClient = createBilibiliWebClient({ cookieString });

  return {
    webClient,
    resourceParser: new BilibiliResourceParser(webClient),
    streamProvider: new BilibiliStreamProvider(webClient),
  };
}