import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  HttpException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { SESSION_COOKIE_NAME } from "./auth.constants.js";
import { readCookie } from "./cookie.util.js";

/**
 * 用户系统登录/登出/当前用户。
 * 与既有 B站扫码登录控制器共享 `api/auth` 前缀，但全路径不冲突（qrcode/user vs login/logout/me）。
 */
@Controller("api/auth")
export class UserAuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { username?: string; password?: string } = {},
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const username = (body.username ?? "").trim();
    const password = body.password ?? "";
    const outcome = await this.auth.login(username, password, clientIp(req));

    if (!outcome.ok) {
      if (outcome.reason === "locked") {
        res.setHeader("Retry-After", String(outcome.retryAfterSeconds));
        throw new HttpException(
          "登录失败次数过多，请稍后再试",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      // 统一口径：不区分用户名不存在 / 密码错误 / 已禁用
      throw new UnauthorizedException("用户名或密码不正确");
    }

    res.cookie(
      SESSION_COOKIE_NAME,
      outcome.result.token,
      this.auth.cookieOptions(),
    );
    return { user: outcome.result.user };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    await this.auth.logout(token);
    const { maxAge: _maxAge, ...clearOptions } = this.auth.cookieOptions();
    res.clearCookie(SESSION_COOKIE_NAME, clearOptions);
    return { ok: true };
  }

  @Get("me")
  async me(@Req() req: Request) {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    const user = await this.auth.resolveUser(token);
    if (!user) {
      throw new UnauthorizedException("未登录");
    }
    return { user };
  }
}

/** 取客户端 IP（登录失败锁定按 IP 计数） */
function clientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}
