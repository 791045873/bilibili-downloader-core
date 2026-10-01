import { join } from "node:path";

/**
 * cloud-server 侧 B 站客户端的磁盘位置配置（N4：云端不依赖 PathsService / 不 join 媒体路径）。
 *
 * - cookie 文件：优先读 `COOKIE_FILE` env；缺省落在云端工作目录下 `.cloud-cookies.json`
 *   （Stage C 将改为 `app_settings` 物化 + 手动粘贴入口，此处为 Stage B 临时口径）。
 * - bili-api-sdk 磁盘缓存：优先读 `BILI_API_CACHE_DIR` env；缺省落在云端工作目录下
 *   `.bili-api-cache`（独立于媒体根目录，云端无 DOWNLOAD_ROOT）。
 */
export function resolveCloudCookieFilePath(): string {
  return process.env.COOKIE_FILE || join(process.cwd(), ".cloud-cookies.json");
}

export function resolveCloudBiliApiCacheDir(): string {
  return (
    process.env.BILI_API_CACHE_DIR || join(process.cwd(), ".bili-api-cache")
  );
}
