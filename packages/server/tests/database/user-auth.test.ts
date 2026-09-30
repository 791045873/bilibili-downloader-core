import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  initTestDb,
  truncateAll,
  type DatabaseService,
} from "../helpers/db.js";

const db: DatabaseService = await initTestDb();

afterAll(async () => {
  await db.onApplicationShutdown();
});

beforeEach(async () => {
  await truncateAll(db);
});

async function seedAdmin(username = "admin"): Promise<number> {
  return db.createUser({
    username,
    passwordHash: "scrypt$c2FsdA==$aGFzaA==",
    role: "admin",
  });
}

describe("user 仓储", () => {
  it("createUser 写入并可按 username / id 读回", async () => {
    const id = await seedAdmin();
    expect(id).toBeGreaterThan(0);
    const byName = await db.findUserByUsername("admin");
    expect(byName?.id).toBe(id);
    expect(byName?.role).toBe("admin");
    expect(byName?.disabledAt).toBeUndefined();
    const byId = await db.findUserById(id);
    expect(byId?.username).toBe("admin");
  });

  it("username 唯一：重复创建抛错", async () => {
    await seedAdmin();
    await expect(seedAdmin()).rejects.toThrow();
  });

  it("findUserByUsername / findUserById 不存在返回 undefined", async () => {
    expect(await db.findUserByUsername("nobody")).toBeUndefined();
    expect(await db.findUserById(99999)).toBeUndefined();
  });

  it("listUsers 按 id 升序；findFirstAdminUser 取首个 admin", async () => {
    const adminId = await seedAdmin();
    await db.createUser({
      username: "alice",
      passwordHash: "scrypt$c2FsdA==$aGFzaA==",
      role: "user",
    });
    const list = await db.listUsers();
    expect(list.map((u) => u.username)).toEqual(["admin", "alice"]);
    expect((await db.findFirstAdminUser())?.id).toBe(adminId);
  });

  it("findFirstAdminUser 无 admin 时返回 undefined", async () => {
    await db.createUser({
      username: "alice",
      passwordHash: "scrypt$c2FsdA==$aGFzaA==",
      role: "user",
    });
    expect(await db.findFirstAdminUser()).toBeUndefined();
  });

  it("disableUser 写 disabled_at", async () => {
    const id = await seedAdmin();
    await db.disableUser(id);
    expect((await db.findUserById(id))?.disabledAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T.*Z$/,
    );
  });
});

describe("user_session 仓储", () => {
  const future = () => new Date(Date.now() + 3600_000).toISOString();
  const past = () => new Date(Date.now() - 3600_000).toISOString();

  it("createUserSession / findUserSessionByTokenHash 往返", async () => {
    const userId = await seedAdmin();
    const id = await db.createUserSession({
      userId,
      tokenHash: "hash-a",
      expiresAt: future(),
    });
    expect(id).toBeGreaterThan(0);
    const found = await db.findUserSessionByTokenHash("hash-a");
    expect(found?.userId).toBe(userId);
    expect(found?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(await db.findUserSessionByTokenHash("nope")).toBeUndefined();
  });

  it("deleteUserSessionByTokenHash 精确吊销单条（登出）", async () => {
    const userId = await seedAdmin();
    await db.createUserSession({ userId, tokenHash: "h1", expiresAt: future() });
    await db.createUserSession({ userId, tokenHash: "h2", expiresAt: future() });
    await db.deleteUserSessionByTokenHash("h1");
    expect(await db.findUserSessionByTokenHash("h1")).toBeUndefined();
    expect(await db.findUserSessionByTokenHash("h2")).toBeDefined();
  });

  it("deleteUserSessionsByUserId 吊销该用户全部会话（禁用用户）", async () => {
    const userId = await seedAdmin();
    await db.createUserSession({ userId, tokenHash: "h1", expiresAt: future() });
    await db.createUserSession({ userId, tokenHash: "h2", expiresAt: future() });
    const removed = await db.deleteUserSessionsByUserId(userId);
    expect(removed).toBe(2);
    expect(await db.findUserSessionByTokenHash("h1")).toBeUndefined();
    expect(await db.findUserSessionByTokenHash("h2")).toBeUndefined();
  });

  it("purgeExpiredUserSessions 仅清理已过期", async () => {
    const userId = await seedAdmin();
    await db.createUserSession({ userId, tokenHash: "live", expiresAt: future() });
    await db.createUserSession({ userId, tokenHash: "dead", expiresAt: past() });
    const purged = await db.purgeExpiredUserSessions();
    expect(purged).toBe(1);
    expect(await db.findUserSessionByTokenHash("live")).toBeDefined();
    expect(await db.findUserSessionByTokenHash("dead")).toBeUndefined();
  });
});

describe("conversation 归属（会话隔离 + 存量回填）", () => {
  it("createConversation 可写 userId；未传时为空", async () => {
    const userId = await seedAdmin();
    const owned = await db.createConversation("mine", userId);
    const orphan = await db.createConversation("legacy");
    expect((await db.getConversation(owned))?.userId).toBe(userId);
    expect((await db.getConversation(orphan))?.userId).toBeUndefined();
  });

  it("listConversations(userId) 仅返回该用户会话；不传返回全部", async () => {
    const admin = await seedAdmin();
    const alice = await db.createUser({
      username: "alice",
      passwordHash: "scrypt$c2FsdA==$aGFzaA==",
      role: "user",
    });
    const mine = await db.createConversation("mine", alice);
    await db.createConversation("admins", admin);

    const aliceList = await db.listConversations(alice);
    expect(aliceList.map((c) => c.id)).toEqual([mine]);
    expect((await db.listConversations()).length).toBe(2);
  });

  it("getConversation(id, otherUserId) 视为不存在（抗 id 枚举）", async () => {
    const admin = await seedAdmin();
    const alice = await db.createUser({
      username: "alice",
      passwordHash: "scrypt$c2FsdA==$aGFzaA==",
      role: "user",
    });
    const adminConv = await db.createConversation("admins", admin);
    expect(await db.getConversation(adminConv, alice)).toBeUndefined();
    expect(await db.getConversation(adminConv, admin)).toBeDefined();
    expect(await db.getConversation(adminConv)).toBeDefined();
  });

  it("backfillConversationUserId 幂等：仅填 NULL 行，二次为 0", async () => {
    const admin = await seedAdmin();
    const alice = await db.createUser({
      username: "alice",
      passwordHash: "scrypt$c2FsdA==$aGFzaA==",
      role: "user",
    });
    const legacy = await db.createConversation("legacy");
    const owned = await db.createConversation("alice-owned", alice);

    expect(await db.backfillConversationUserId(admin)).toBe(1);
    expect((await db.getConversation(legacy))?.userId).toBe(admin);
    expect((await db.getConversation(owned))?.userId).toBe(alice);
    expect(await db.backfillConversationUserId(admin)).toBe(0);
  });
});
