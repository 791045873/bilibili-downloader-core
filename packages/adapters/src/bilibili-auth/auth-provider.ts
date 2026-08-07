/**
 * Bilibili 二维码登录提供器
 *
 * 基于 bilibili-api-sdk 的 LoginApi 实现。
 */

import type {
  AuthProviderPort,
  QrCodeResult,
  QrStatusResult,
  LoginCookie,
  UserInfo,
} from "@bilibili-downloader/core/ports";
import { BilibiliClient, BiliError } from "bilibili-api-sdk";
import { CookieStore } from "./cookie-store.js";
import { logger } from "../logger.js";
import { summarizeText } from "../safe-error-context.js";

export class BilibiliAuthProvider implements AuthProviderPort {
  private readonly cookieStore = new CookieStore();
  /** 扫码流程专用客户端 (吸收 poll 响应的 Set-Cookie) */
  private loginClient: BilibiliClient | null = null;

  async generateQrCode(): Promise<QrCodeResult> {
    this.loginClient = new BilibiliClient({ autoInit: false });

    try {
      const data = await this.loginClient.login.qrGenerate();
      return {
        qrcodeKey: data.qrcode_key,
        url: data.url,
      };
    } catch (err) {
      throw new Error(`获取二维码失败: ${(err as Error).message}`);
    }
  }

  async pollQrStatus(qrcodeKey: string): Promise<QrStatusResult> {
    const client = this.loginClient ?? new BilibiliClient({ autoInit: false });

    let data: { code: number; message: string; url: string };
    try {
      data = await client.login.qrPoll(qrcodeKey);
    } catch (err) {
      // API 级错误
      const message =
        err instanceof BiliError && err.message
          ? err.message
          : (err as Error).message || "未知错误";
      return { status: "expired", message };
    }

    switch (data.code) {
      case 86101:
        return { status: "pending" };
      case 86090:
        return { status: "scanned" };
      case 86038:
        return {
          status: "expired",
          message: data.message || "二维码已过期",
        };
      case 0:
        return {
          status: "confirmed",
          callbackUrl: data.url,
        };
      default:
        return {
          status: "expired",
          message: `未知状态码: ${data.code}`,
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
      const client = new BilibiliClient({
        cookies: cookieString,
        autoInit: false,
      });
      const data = await client.login.nav();

      if (!data.isLogin) {
        return null;
      }

      return {
        mid: data.mid,
        name: data.uname,
        face: data.face,
        isLogin: data.isLogin,
      };
    } catch (err) {
      logger.warn(
        `获取 Bilibili 登录态用户信息失败，按未登录处理: ${summarizeText((err as Error).message)}`,
      );
      return null;
    }
  }
}
