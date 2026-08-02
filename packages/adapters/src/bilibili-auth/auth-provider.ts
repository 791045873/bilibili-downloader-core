/**
 * Bilibili 二维码登录提供器
 *
 * 参考: downkyicore/DownKyi.Core/BiliApi/Login/LoginQR.cs
 *      downkyicore/DownKyi.Core/BiliApi/Login/LoginHelper.cs
 */

import type {
  AuthProviderPort,
  QrCodeResult,
  QrStatusResult,
  LoginCookie,
  UserInfo,
} from "@bilibili-downloader/core/ports";
import { DEFAULT_HEADERS } from "../bilibili/constants.js";
import type {
  BiliQrCodeResponse,
  BiliQrStatusResponse,
  BiliNavUserInfo,
} from "../bilibili/types.js";
import { CookieStore } from "./cookie-store.js";
import { logger } from "../logger.js";
import { summarizeText } from "../safe-error-context.js";

/** Bilibili 二维码登录 API 端点 */
const QR_GENERATE_URL =
  "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const QR_POLL_URL =
  "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";
/** 导航接口 (获取用户信息) */
const NAV_URL = "https://api.bilibili.com/x/web-interface/nav";

export class BilibiliAuthProvider implements AuthProviderPort {
  private readonly cookieStore = new CookieStore();

  async generateQrCode(): Promise<QrCodeResult> {
    const response = await fetch(QR_GENERATE_URL, {
      headers: DEFAULT_HEADERS,
    });

    const data = (await response.json()) as BiliQrCodeResponse;

    if (data.code !== 0) {
      throw new Error(`获取二维码失败: ${data.message}`);
    }

    return {
      qrcodeKey: data.data.qrcode_key,
      url: data.data.url,
    };
  }

  async pollQrStatus(qrcodeKey: string): Promise<QrStatusResult> {
    const url = `${QR_POLL_URL}?qrcode_key=${encodeURIComponent(qrcodeKey)}`;
    const response = await fetch(url, {
      headers: DEFAULT_HEADERS,
    });

    const data = (await response.json()) as BiliQrStatusResponse;

    if (data.code !== 0) {
      // API 级错误
      return { status: "expired", message: data.message || "未知错误" };
    }

    switch (data.data.code) {
      case 86101:
        return { status: "pending" };
      case 86090:
        return { status: "scanned" };
      case 86038:
        return {
          status: "expired",
          message: data.data.message || "二维码已过期",
        };
      case 0:
        return {
          status: "confirmed",
          callbackUrl: data.data.url,
        };
      default:
        return {
          status: "expired",
          message: `未知状态码: ${data.data.code}`,
        };
    }
  }

  extractCookies(callbackUrl: string): LoginCookie[] {
    const url = new URL(callbackUrl);
    const cookies: LoginCookie[] = [];

    for (const [name, value] of url.searchParams.entries()) {
      // 排除 Expires 和 gourl 字段
      if (name === "Expires" || name === "gourl") continue;

      cookies.push({
        name,
        value,
        domain: ".bilibili.com",
        path: "/",
      });
    }

    return cookies;
  }

  async saveCookies(cookies: LoginCookie[], cookieFile: string): Promise<void> {
    await this.cookieStore.save(cookieFile, cookies);
  }

  async loadCookies(cookieFile: string): Promise<LoginCookie[]> {
    return this.cookieStore.load(cookieFile);
  }

  toCookieString(cookies: LoginCookie[]): string {
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  async getUserInfo(cookieString: string): Promise<UserInfo | null> {
    try {
      const response = await fetch(NAV_URL, {
        headers: { ...DEFAULT_HEADERS, Cookie: cookieString },
      });
      const data = (await response.json()) as {
        code: number;
        data: BiliNavUserInfo;
      };

      if (data.code !== 0 || !data.data.isLogin) {
        return null;
      }

      return {
        mid: data.data.mid,
        name: data.data.uname,
        face: data.data.face,
        isLogin: data.data.isLogin,
      };
    } catch (err) {
      logger.warn(
        `获取 Bilibili 登录态用户信息失败，按未登录处理: ${summarizeText((err as Error).message)}`,
      );
      return null;
    }
  }
}
