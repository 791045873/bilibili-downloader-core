/**
 * 认证提供端口 - 二维码登录、Cookie 管理
 */
export interface AuthProviderPort {
  /**
   * 生成登录二维码
   * @returns qrcode_key 和二维码 URL
   */
  generateQrCode(): Promise<QrCodeResult>;

  /**
   * 轮询扫码状态
   * @param qrcodeKey 二维码 key
   * @returns 当前扫码状态
   */
  pollQrStatus(qrcodeKey: string): Promise<QrStatusResult>;

  /**
   * 从回调 URL 中提取 Cookie 信息
   * @param callbackUrl 登录成功后的回调 URL
   */
  extractCookies(callbackUrl: string): LoginCookie[];

  /**
   * 将 Cookie 保存到文件
   */
  saveCookies(cookies: LoginCookie[], cookieFile: string): Promise<void>;

  /**
   * 从文件加载 Cookie
   */
  loadCookies(cookieFile: string): Promise<LoginCookie[]>;

  /**
   * 将 Cookie 列表序列化为 HTTP Cookie header 值
   */
  toCookieString(cookies: LoginCookie[]): string;
}

export interface QrCodeResult {
  /** 二维码唯一标识，用于轮询 */
  qrcodeKey: string;
  /** 二维码 URL (内容为 B 站登录链接) */
  url: string;
}

export type QrStatusResult =
  | { status: "pending" }
  | { status: "scanned" }
  | { status: "expired"; message: string }
  | { status: "confirmed"; callbackUrl: string };

export interface LoginCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}