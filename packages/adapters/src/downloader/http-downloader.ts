/**
 * HTTP 下载器
 *
 * 支持进度回调、重试、取消
 * 参考: downkyicore/DownKyi/Services/Download/BuiltinDownloadService.cs
 */

import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import type {
  MediaDownloaderPort,
  DownloadParams,
  DownloadProgress,
} from "@bilibili-downloader/core/ports";
import { DownloadError } from "@bilibili-downloader/core/ports";
import { DEFAULT_HEADERS } from "../bilibili/constants.js";

export class HttpDownloader implements MediaDownloaderPort {
  private abortController: AbortController | null = null;

  async download(params: DownloadParams): Promise<string> {
    this.abortController = new AbortController();

    const headers: Record<string, string> = { ...DEFAULT_HEADERS };

    if (params.cookieString) {
      headers["Cookie"] = params.cookieString;
    }

    if (params.referer) {
      headers["Referer"] = params.referer;
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(params.url, {
          headers,
          signal: this.abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentLength = Number.parseInt(
          response.headers.get("content-length") ?? "0",
          10,
        );
        const reader = response.body?.getReader();
        if (!reader || !response.body) {
          throw new Error("响应体为空");
        }

        const writeStream = createWriteStream(params.filePath);

        let downloadedBytes = 0;
        let lastTime = Date.now();
        let lastBytes = 0;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            downloadedBytes += value.length;

            // 写入文件 (write 返回 boolean 指示是否需要等待 drain)
            if (!writeStream.write(value)) {
              await new Promise<void>((resolve) =>
                writeStream.once("drain", resolve),
              );
            }

            // 进度回调
            if (params.onProgress) {
              const now = Date.now();
              const elapsed = (now - lastTime) / 1000;
              let speedBytesPerSec = 0;
              if (elapsed >= 0.5) {
                speedBytesPerSec = Math.round(
                  (downloadedBytes - lastBytes) / elapsed,
                );
                lastTime = now;
                lastBytes = downloadedBytes;
              }

              params.onProgress({
                speedBytesPerSec: speedBytesPerSec || 0,
                percentage: contentLength
                  ? Math.round((downloadedBytes / contentLength) * 100)
                  : 0,
              });
            }
          }
        } finally {
          writeStream.end();
          await finished(writeStream);
        }

        return params.filePath;
      } catch (err) {
        lastError = err as Error;

        if ((err as Error).name === "AbortError") {
          throw new DownloadError("下载已取消", params.url, params.filePath);
        }

        if (attempt < maxRetries) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
      }
    }

    throw new DownloadError(
      `下载失败 (已重试 ${maxRetries} 次): ${lastError?.message}`,
      params.url,
      params.filePath,
    );
  }

  abort(): void {
    this.abortController?.abort();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}