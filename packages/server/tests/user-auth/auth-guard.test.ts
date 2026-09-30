import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { AuthGuard } from "../../src/user-auth/auth.guard.js";
import type { AuthService } from "../../src/user-auth/auth.service.js";
import type { AuthUser } from "../../src/user-auth/auth.constants.js";
import {
  PUBLIC_METADATA_KEY,
  ROLES_METADATA_KEY,
} from "../../src/user-auth/auth.decorators.js";

const ADMIN: AuthUser = { id: 1, username: "admin", role: "admin" };
const USER: AuthUser = { id: 2, username: "bob", role: "user" };

function makeContext(cookie?: string) {
  const req: { headers: { cookie?: string }; user?: AuthUser } = {
    headers: { cookie },
  };
  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function makeReflector(meta: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (key: string) => meta[key],
  } as unknown as Reflector;
}

function makeAuth(user?: AuthUser): AuthService {
  return {
    resolveUser: async (token: string | undefined) =>
      token === "good" ? user : undefined,
  } as unknown as AuthService;
}

describe("AuthGuard（全局守卫 fail-closed）", () => {
  it("@Public 直接放行，且不解析会话", async () => {
    const guard = new AuthGuard(
      makeReflector({ [PUBLIC_METADATA_KEY]: true }),
      makeAuth(undefined),
    );
    const { ctx, req } = makeContext(undefined);
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(req.user).toBeUndefined();
  });

  it("无会话 → 401", async () => {
    const guard = new AuthGuard(makeReflector({}), makeAuth(ADMIN));
    const { ctx } = makeContext(undefined);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("无效 token → 401", async () => {
    const guard = new AuthGuard(makeReflector({}), makeAuth(ADMIN));
    const { ctx } = makeContext("bdl_session=bad");
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("默认（未标注 @Roles）仅 admin 可过；普通 user → 403", async () => {
    const adminGuard = new AuthGuard(makeReflector({}), makeAuth(ADMIN));
    const a = makeContext("bdl_session=good");
    expect(await adminGuard.canActivate(a.ctx)).toBe(true);
    expect(a.req.user).toEqual(ADMIN);

    const userGuard = new AuthGuard(makeReflector({}), makeAuth(USER));
    const u = makeContext("bdl_session=good");
    await expect(userGuard.canActivate(u.ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("@Roles(admin,user) 放开普通 user", async () => {
    const guard = new AuthGuard(
      makeReflector({ [ROLES_METADATA_KEY]: ["admin", "user"] }),
      makeAuth(USER),
    );
    const { ctx, req } = makeContext("bdl_session=good");
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(req.user).toEqual(USER);
  });

  it("@Roles(user) 时 admin 不在白名单 → 403（角色白名单严格匹配）", async () => {
    const guard = new AuthGuard(
      makeReflector({ [ROLES_METADATA_KEY]: ["user"] }),
      makeAuth(ADMIN),
    );
    const { ctx } = makeContext("bdl_session=good");
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
