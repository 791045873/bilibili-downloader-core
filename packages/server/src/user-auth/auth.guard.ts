import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthService } from "./auth.service.js";
import { ROLE_ADMIN, SESSION_COOKIE_NAME } from "./auth.constants.js";
import type { AuthUser } from "./auth.constants.js";
import {
  PUBLIC_METADATA_KEY,
  ROLES_METADATA_KEY,
} from "./auth.decorators.js";
import { readCookie } from "./cookie.util.js";

/**
 * 全局守卫（fail-closed）：
 * - `@Public()` 放行；
 * - 其余必须持有有效会话，否则 401；
 * - 角色默认仅 `admin`；`@Roles(...)` 显式放开（如 QA 给 admin+user），不匹配则 403。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_METADATA_KEY,
      targets,
    );
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = readCookie(req.headers?.cookie, SESSION_COOKIE_NAME);
    const user = await this.auth.resolveUser(token);
    if (!user) {
      throw new UnauthorizedException("未登录");
    }
    req.user = user;

    const allowed =
      this.reflector.getAllAndOverride<string[]>(ROLES_METADATA_KEY, targets) ?? [
        ROLE_ADMIN,
      ];
    if (!allowed.includes(user.role)) {
      throw new ForbiddenException("无权访问");
    }
    return true;
  }
}
