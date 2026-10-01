import { SetMetadata, createParamDecorator } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { AuthUser } from "./auth.constants.js";

export const PUBLIC_METADATA_KEY = "bdl:public";
export const ROLES_METADATA_KEY = "bdl:roles";

/** 放行：无需登录（仅登录/登出/me 等） */
export const Public = () => SetMetadata(PUBLIC_METADATA_KEY, true);

/**
 * 允许访问的角色。缺省（未标注）时**默认仅 admin**（fail-closed）：
 * 新增端点若未显式放开，一律只有 admin 可用。
 */
export const Roles = (...roles: string[]) =>
  SetMetadata(ROLES_METADATA_KEY, roles);

/** 取当前登录用户（由 AuthGuard 注入 request.user） */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!req.user) {
      throw new Error("CurrentUser used on a route without AuthGuard");
    }
    return req.user;
  },
);
