/**
 * Aria2 JSON-RPC 下载器
 *
 * 通过 HTTP JSON-RPC 与 aria2c 进程通信。
 * 需要预先启动 aria2c: aria2c --enable-rpc --rpc-listen-port=6800
 */

import type {
  MediaDownloaderPort,
  DownloadParams,
  DownloadProgress,
} from "@bilibili-downloader/core/ports";
import { DownloadError } from "@bilibili-downloader/core/ports";
import { DEFAULT_HEADERS } from "../bilibili/constants.js";

export interface Aria2Options {
  rpcUrl?: string;
  secret?: string;
  pollInterval?: number;
}

export class Aria2Downloader implements MediaDownloaderPort {
  private rpcUrl: string;
  private secret?: string;
  private pollInterval: number;
  private activeGid: string | null = null;
  private abortController: AbortController | null = null;

  constructor(options: Aria2Options = {}) {
    this.rpcUrl = options.rpcUrl ?? "http://127.0.0.1:6800/jsonrpc";
    this.secret = options.secret;
    this.pollInterval = options.pollInterval ?? 1000;
  }

  async download(params: DownloadParams): Promise<string> {
    this.abortController = new AbortController();

    const headerLines: string[] = [];
    if (params.referer) {
      headerLines.push(`Referer: ${params.referer}`);
    }
    if (params.cookieString) {
      headerLines.push(`Cookie: ${params.cookieString}`);
    }
    headerLines.push(`User-Agent: ${DEFAULT_HEADERS["User-Agent"]}`);

    const lastSep = Math.max(
      params.filePath.lastIndexOf("\\"),
      params.filePath.lastIndexOf("/"),
    );
    const dir = params.filePath.substring(0, lastSep);
    const out = params.filePath.substring(lastSep + 1);

    const gid = await this.addUri({
      uris: [params.url],
      options: {
        dir,
        out,
        header: headerLines,
        "max-connection-per-server": "16",
        split: "16",
      },
    });

    this.activeGid = gid;

    return new Promise<string>((resolve, reject) => {
      const poll = async () => {
        if (this.abortController?.signal.aborted) {
          try { await this.rpcCall("aria2.remove", [gid]); } catch { /* */ }
          reject(new DownloadError("下载已取消", params.url, params.filePath));
          return;
        }

        try {
          const status = await this.getStatus(gid);

          if (status.status === "complete") {
            if (params.onProgress) {
              params.onProgress({
                downloadedBytes: Number.parseInt(status.totalLength),
                totalBytes: Number.parseInt(status.totalLength),
                speedBytesPerSec: 0,
                percentage: 100,
              });
            }
            resolve(params.filePath);
            return;
          }

          if (status.status === "error" || status.status === "removed") {
            reject(
              new DownloadError(
                `aria2 下载失败: ${status.errorMessage ?? "未知错误"}`,
                params.url,
                params.filePath,
              ),
            );
            return;
          }

          if (params.onProgress) {
            const downloaded = Number.parseInt(status.completedLength);
            const total = Number.parseInt(status.totalLength);
            const speed = Number.parseInt(status.downloadSpeed);
            params.onProgress({
              downloadedBytes: downloaded,
              totalBytes: total,
              speedBytesPerSec: speed,
              percentage: total > 0 ? Math.round((downloaded / total) * 100) : 0,
            });
          }

          setTimeout(poll, this.pollInterval);
        } catch (err) {
          reject(
            new DownloadError(
              `aria2 状态查询失败: ${(err as Error).message}`,
              params.url,
              params.filePath,
            ),
          );
        }
      };
      poll();
    });
  }

  abort(): void {
    this.abortController?.abort();
  }

  private async addUri(params: {
    uris: string[];
    options?: Record<string, string | string[]>;
  }): Promise<string> {
    return this.rpcCall<string>("aria2.addUri", [
      params.uris,
      params.options ?? {},
    ]);
  }

  private async getStatus(gid: string): Promise<Aria2Status> {
    return this.rpcCall<Aria2Status>("aria2.tellStatus", [
      gid,
      ["gid", "status", "totalLength", "completedLength", "downloadSpeed", "errorMessage"],
    ]);
  }

  private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const body = {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params: this.secret
        ? [`token:${this.secret}`, ...params]
        : params,
    };

    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`aria2 RPC 请求失败: HTTP ${response.status}`);
    }

    const result = (await response.json()) as Aria2RpcResponse<T>;
    if (result.error) {
      throw new Error(
        `aria2 RPC 错误: ${result.error.message} (code=${result.error.code})`,
      );
    }
    return result.result;
  }
}

interface Aria2RpcResponse<T> {
  jsonrpc: string;
  id: string;
  result: T;
  error?: { code: number; message: string };
}

interface Aria2Status {
  gid: string;
  status: "active" | "waiting" | "paused" | "error" | "complete" | "removed";
  totalLength: string;
  completedLength: string;
  downloadSpeed: string;
  errorMessage?: string;
}