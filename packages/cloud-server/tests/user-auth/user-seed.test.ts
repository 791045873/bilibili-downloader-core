import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  initTestDb,
  truncateAll,
  type DatabaseService,
} from "../helpers/db.js";
import { UserSeedService } from "../../src/user-auth/user-seed.service.js";
import { verifyPassword } from "../../src/user-auth/password.util.js";

const db: DatabaseService = await initTestDb();
const seeder = new UserSeedService(db);

afterAll(async () => {
  await db.onApplicationShutdown();
});

beforeEach(async () => {
  await truncateAll(db);
  delete process.env.ADMIN_INITIAL_PASSWORD;
});

describe("UserSeedService 启动播种", () => {
  it("env 存在且无 admin → 创建 admin（口令为 env 值的 scrypt 摘要）", async () => {
    process.env.ADMIN_INITIAL_PASSWORD = "seed-secret-1";
    await seeder.onModuleInit();

    const admin = await db.findUserByUsername("admin");
    expect(admin?.role).toBe("admin");
    expect(admin?.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("seed-secret-1", admin!.passwordHash)).toBe(
      true,
    );
  });

  it("env 缺失 → 不创建任何账号（无默认口令）", async () => {
    await seeder.onModuleInit();
    expect(await db.findUserByUsername("admin")).toBeUndefined();
    expect(await db.listUsers()).toEqual([]);
  });

  it("admin 已存在 → 幂等，不改口令/角色（即使 env 变更）", async () => {
    process.env.ADMIN_INITIAL_PASSWORD = "seed-secret-1";
    await seeder.onModuleInit();
    const first = await db.findUserByUsername("admin");

    process.env.ADMIN_INITIAL_PASSWORD = "seed-secret-2";
    await seeder.onModuleInit();
    const second = await db.findUserByUsername("admin");

    expect(second?.id).toBe(first?.id);
    expect(second?.passwordHash).toBe(first?.passwordHash);
    expect((await db.listUsers()).length).toBe(1);
  });
});

describe("UserSeedService 存量会话回填", () => {
  it("播种 admin 后把 user_id 为空的存量会话回填归 admin，且重复启动为 no-op", async () => {
    const legacy = await db.createConversation("legacy");

    process.env.ADMIN_INITIAL_PASSWORD = "seed-secret-1";
    await seeder.onModuleInit();
    const admin = await db.findUserByUsername("admin");
    expect((await db.getConversation(legacy))?.userId).toBe(admin?.id);

    const after = await db.createConversation("post-seed", admin!.id);
    await seeder.onModuleInit();
    expect((await db.getConversation(after))?.userId).toBe(admin?.id);
  });

  it("无 admin（env 缺失）→ 回填为 no-op，存量 user_id 保持为空", async () => {
    const legacy = await db.createConversation("legacy");
    await seeder.onModuleInit();
    expect((await db.getConversation(legacy))?.userId).toBeUndefined();
  });
});
