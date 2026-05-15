/**
 * Bilibili HTTP 客户端
 *
 * 封装 Cookie 注入、重试、通用请求头
 * 参考: downkyicore/DownKyi.Core/BiliApi/WebClient.cs
 */

import { DEFAULT_HEADERS, BILI_API_BASE } from "./constants.js";

export interface BilibiliWebClient {
  /** 发起 JSON API 请求 */
  requestJson<T>(url: string, cookieString?: string): Promise<T>;

  /** 发起请求，返回原始响应文本 */
  requestText(url: string, cookieString?: string): Promise<string>;

  /** 下载文件到磁盘 (返回 Buffer) */
  downloadBuffer(url: string, cookieString?: string): Promise<ArrayBuffer>;

  /** 更新 Cookie 字符串 */
  setCookieString(cookieString: string | undefined): void;
}

export function createBilibiliWebClient(
  options?: { cookieString?: string; maxRetries?: number },
): BilibiliWebClient {
  let cookieString = options?.cookieString;
  const maxRetries = options?.maxRetries ?? 2;

  function getHeaders(extraCookie?: string): Record<string, string> {
    const headers = { ...DEFAULT_HEADERS };
    const effectiveCookie = extraCookie ?? cookieString;
    if (effectiveCookie) {
      headers["Cookie"] = effectiveCookie;
    }
    return headers;
  }

  async function requestWithRetry(
    url: string,
    init: RequestInit,
    retries: number,
  ): Promise<Response> {
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(url, init);
        if (!response.ok && i < retries) {
          // 非 2xx 时重试
          await sleep(1000 * (i + 1));
          continue;
        }
        return response;
      } catch (err) {
        if (i >= retries) throw err;
        await sleep(1000 * (i + 1));
      }
    }
    throw new Error(`请求失败: ${url}`);
  }

  return {
    async requestJson<T>(url: string, extraCookie?: string): Promise<T> {
      const response = await requestWithRetry(
        url,
        { headers: getHeaders(extraCookie) },
        maxRetries,
      );
      return response.json() as Promise<T>;
    },

    async requestText(url: string, extraCookie?: string): Promise<string> {
      const response = await requestWithRetry(
        url,
        { headers: getHeaders(extraCookie) },
        maxRetries,
      );
      return response.text();
    },

    async downloadBuffer(url: string, extraCookie?: string): Promise<ArrayBuffer> {
      const response = await requestWithRetry(
        url,
        { headers: getHeaders(extraCookie) },
        maxRetries, // 下载重试更多
      );
      return response.arrayBuffer();
    },

    setCookieString(cs: string | undefined) {
      cookieString = cs;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}