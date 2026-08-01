import { Controller, Get, Post, Query, Body } from "@nestjs/common";
import { DownloadService } from "../download/download.service.js";

@Controller("api/auth")
export class AuthController {
  constructor(private readonly service: DownloadService) {}

  /** 获取登录二维码 */
  @Get("/qrcode")
  async getQrCode() {
    return this.service.getQrCode();
  }

  /** 轮询扫码状态 */
  @Get("/qrcode/status")
  async getQrStatus(@Query("key") key: string) {
    if (!key) return { error: "缺少 key 参数" };
    const result = await this.service.pollQrStatus(key);
    if (result.status === "confirmed") {
      await this.service.confirmLogin(result.callbackUrl);
    }
    return result;
  }

  /** 获取当前登录用户信息 */
  @Get("/user")
  async getUserInfo() {
    return this.service.getUserInfo();
  }
}
