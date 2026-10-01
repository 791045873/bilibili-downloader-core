import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from "@nestjs/common";
import { DownloadTaskService } from "../download/download-task.service.js";

@Controller("api/auth")
export class AuthController {
  constructor(private readonly service: DownloadTaskService) {}

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

  /** 手动粘贴 B 站 cookie（受登录保护；不记录 cookie 明文）。 */
  @Post("/cookie")
  async setCookie(@Body() body: { cookie?: string }) {
    const cookie = body?.cookie;
    if (typeof cookie !== "string" || cookie.trim() === "") {
      throw new BadRequestException("cookie 不能为空");
    }
    await this.service.setCookieManually(cookie);
    return { message: "cookie 已更新" };
  }

  /** 获取当前登录用户信息 */
  @Get("/user")
  async getUserInfo() {
    return this.service.getUserInfo();
  }
}
