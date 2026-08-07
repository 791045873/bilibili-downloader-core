// Bilibili API 适配器 - 视频信息、播放流、输入解析
// 底层 API 调用统一由 bilibili-api-sdk 提供

export {
  createBilibiliApiAdapter,
  type BilibiliApiAdapter,
} from "./bilibili-api.js";
export { BilibiliStreamProvider } from "./stream-provider.js";
export { BilibiliResourceParser } from "./resource-parser.js";
export { BilibiliFavoritesProvider } from "./favorites-provider.js";
export { BilibiliSpaceProvider } from "./space-provider.js";
export { BilibiliSubtitleProvider } from "./subtitle-provider.js";
export {
  createBilibiliSdkClient,
  BilibiliSdkClient,
  type BilibiliClient,
} from "./sdk-client.js";
export { QUALITY_MAP, CODEC_MAP } from "./constants.js";
