import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  initTestDb,
  truncateAll,
  type DatabaseService,
} from "../helpers/db.js";

// 构造 AuthService 前先设锁定阈值（构造函数读 env）
process.env.LOGIN_MAX_FAILURES = "3";
process.env.LOGIN_FAILURE_WINDOW_MINUTES = "15";
process.env.LOGIN_BLOCK_MINUTES = "15";
process.env.SESSION_TTL_HOURS = "1";

const { AuthService } = await import("../../src/user-auth/auth.service.js");
const { hashPassword } = await import("../../src/user-auth/password.util.js");

const db: DatabaseService = await initTestDb();
const auth = new AuthService(db);

afterAll(async () => {
  await db.onApplicationShutdown();
});

beforeEach(async () => {
  await truncateAll(db);
});

async function createUser(
  username: string,
  password: string,
  role = "admin",
): Promise<number> {
  return db.createUser({
    username,
    passwordHash: await hashPassword(password),
    role,
  });
}

describe("AuthService 登录", () => {
  it("正确凭据登录成功：返回用户与 token，DB 仅存 token 摘要", async () => {
    const userId = await createUser("admin", "correct-horse");
    const outcome = await auth.login("admin", "correct-horse", "ip-ok");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.user).toEqual({
      id: userId,
      username: "admin",
      role: "admin",
    });
    expect(outcome.result.token.length).toBeGreaterThan(20);

    // 原 token 不入库；仅摘要可查
    expect(
      await db.findUserSessionByTokenHash(outcome.result.token),
    ).toBeUndefined();
    const session = await db.findUserSessionByTokenHash(
      auth.hashToken(outcome.result.token),
    );
    expect(session?.userId).toBe(userId);
  });

  it("密码错误 / 用户不存在 / 已禁用 均返回统一 invalid", async () => {
    await createUser("admin", "correct-horse");
    expect(await auth.login("admin", "wrong", "ip-a")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await auth.login("ghost", "whatever", "ip-b")).toEqual({
      ok: false,
      reason: "invalid",
    });

    const disabledId = await createUser("bob", "bob-pass", "user");
    await db.disableUser(disabledId);
    expect(await auth.login("bob", "bob-pass", "ip-c")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("同 IP 连续失败达阈值后封禁（即使随后口令正确）", async () => {
    await createUser("admin", "correct-horse");
    const ip = "ip-lock";
    for (let i = 0; i < 3; i++) {
      expect(await auth.login("admin", "bad", ip)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
    const blocked = await auth.login("admin", "correct-horse", ip);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.reason).toBe("locked");
    if (blocked.reason !== "locked") return;
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // 其他 IP 不受影响
    expect((await auth.login("admin", "correct-horse", "ip-other")).ok).toBe(true);
  });

  it("登录成功清零该 IP 失败计数", async () => {
    await createUser("admin", "correct-horse");
    const ip = "ip-reset";
    await auth.login("admin", "bad", ip);
    await auth.login("admin", "bad", ip);
    expect((await auth.login("admin", "correct-horse", ip)).ok).toBe(true);
    expect(auth.blockedSeconds(ip)).toBe(0);
    // 计数已清零：再连续两次失败仍不封禁
    await auth.login("admin", "bad", ip);
    await auth.login("admin", "bad", ip);
    expect(auth.blockedSeconds(ip)).toBe(0);
  });
});

describe("AuthService 会话解析与吊销", () => {
  it("有效 token 解析出用户；未知 token 为未登录", async () => {
    const userId = await createUser("admin", "pw");
    const outcome = await auth.login("admin", "pw", "ip-1");
    if (!outcome.ok) throw new Error("login failed");
    expect(await auth.resolveUser(outcome.result.token)).toEqual({
      id: userId,
      username: "admin",
      role: "admin",
    });
    expect(await auth.resolveUser("not-a-token")).toBeUndefined();
    expect(await auth.resolveUser(undefined)).toBeUndefined();
  });

  it("过期会话视为未登录并被清理", async () => {
    const userId = await createUser("admin", "pw");
    const token = "expired-token";
    await db.createUserSession({
      userId,
      tokenHash: auth.hashToken(token),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await auth.resolveUser(token)).toBeUndefined();
    expect(
      await db.findUserSessionByTokenHash(auth.hashToken(token)),
    ).toBeUndefined();
  });

  it("用户被禁用后其会话立即失效", async () => {
    const userId = await createUser("bob", "pw", "user");
    const outcome = await auth.login("bob", "pw", "ip-2");
    if (!outcome.ok) throw new Error("login failed");
    await db.disableUser(userId);
    expect(await auth.resolveUser(outcome.result.token)).toBeUndefined();
  });

  it("logout 吊销当前会话；未知 token 为 no-op", async () => {
    await createUser("admin", "pw");
    const outcome = await auth.login("admin", "pw", "ip-3");
    if (!outcome.ok) throw new Error("login failed");
    await auth.logout(outcome.result.token);
    expect(await auth.resolveUser(outcome.result.token)).toBeUndefined();
    await expect(auth.logout("unknown")).resolves.toBeUndefined();
    await expect(auth.logout(undefined)).resolves.toBeUndefined();
  });

  it("cookieOptions 为 HttpOnly + SameSite=Lax + path=/", () => {
    const opts = auth.cookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBeGreaterThan(0);
  });
});
