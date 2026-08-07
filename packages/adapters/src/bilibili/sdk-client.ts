/**
 * Bilibili SDK 客户端包装器
 *
 * 封装 bilibili-api-sdk 的 BilibiliClient，提供:
 * - 全局 Cookie 管理 (登录后整体切换)
 * - 单次调用 Cookie 覆盖 (与旧 WebClient 的 extraCookie 语义一致)
 */

import { BilibiliClient } from "bilibili-api-sdk";

export type { BilibiliClient };

export class BilibiliSdkClient {
  readonly client: BilibiliClient;
  private globalCookie: string | undefined;
  private appliedCookie: string | undefined;

  constructor(cookieString?: string) {
    this.globalCookie = cookieString;
    this.appliedCookie = cookieString;
    this.client = new BilibiliClient({ cookies: cookieString });
  }

  /** 更新全局 Cookie (如扫码登录成功后) */
  setCookieString(cookieString: string | undefined): void {
    this.globalCookie = cookieString;
    this.apply(cookieString);
  }

  /**
   * 按本次调用应用 Cookie: 显式传入优先，否则用全局 Cookie。
   * 仅当与上次应用值不同时才重置 jar。
   */
  useCookie(cookieString?: string): void {
    const effective = cookieString ?? this.globalCookie;
    if (effective === this.appliedCookie) return;
    this.apply(effective);
  }

  private apply(cookieString: string | undefined): void {
    this.client.setCookies(cookieString);
    this.appliedCookie = cookieString;
  }
}

export function createBilibiliSdkClient(
  cookieString?: string,
): BilibiliSdkClient {
  return new BilibiliSdkClient(cookieString);
}
