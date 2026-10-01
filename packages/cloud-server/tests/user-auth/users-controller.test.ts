import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  initTestDb,
  truncateAll,
  type DatabaseService,
} from "../helpers/db.js";
import { AuthService } from "../../src/user-auth/auth.service.js";
import { UsersController } from "../../src/user-auth/users.controller.js";
import { hashPassword } from "../../src/user-auth/password.util.js";
import type { AuthUser } from "../../src/user-auth/auth.constants.js";

const db: DatabaseService = await initTestDb();
const auth = new AuthService(db);
const controller = new UsersController(db, auth);

afterAll(async () => {
  await db.onApplicationShutdown();
});

beforeEach(async () => {
  await truncateAll(db);
});

async function makeAdmin(username = "admin"): Promise<AuthUser> {
  const id = await db.createUser({
    username,
    passwordHash: await hashPassword("admin-pass-1"),
    role: "admin",
  });
  return { id, username, role: "admin" };
}

describe("UsersController 创建用户", () => {
  it("创建成功并返回不含凭据的视图", async () => {
    const { user } = await controller.createUser({
      username: "alice",
      password: "alice-pass-1",
      role: "user",
    });
    expect(user).toEqual({ id: user.id, username: "alice", role: "user" });
    expect(JSON.stringify(user)).not.toContain("scrypt");
    const stored = await db.findUserByUsername("alice");
    expect(stored?.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  it("role 缺省为 user", async () => {
    const { user } = await controller.createUser({
      username: "bob",
      password: "bob-pass-12",
    });
    expect(user.role).toBe("user");
  });

  it("用户名非法 / 过短 → 400", async () => {
    await expect(
      controller.createUser({ username: "a", password: "long-enough-1" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.createUser({ username: "bad name", password: "long-enough-1" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("密码过短 → 400", async () => {
    await expect(
      controller.createUser({ username: "carol", password: "short" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("角色非法 → 400", async () => {
    await expect(
      controller.createUser({
        username: "dave",
        password: "dave-pass-12",
        role: "superuser",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("用户名重复 → 409", async () => {
    await controller.createUser({ username: "erin", password: "erin-pass-1" });
    await expect(
      controller.createUser({ username: "erin", password: "erin-pass-1" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("UsersController 列表", () => {
  it("列表不含 password_hash", async () => {
    await makeAdmin();
    await controller.createUser({ username: "alice", password: "alice-pass-1" });
    const { users } = await controller.listUsers();
    expect(users.map((u) => u.username)).toEqual(["admin", "alice"]);
    expect(JSON.stringify(users)).not.toContain("scrypt");
    expect(Object.keys(users[0])).not.toContain("passwordHash");
  });
});

describe("UsersController 禁用用户", () => {
  it("禁用并吊销其会话；幂等", async () => {
    const admin = await makeAdmin();
    const { user: alice } = await controller.createUser({
      username: "alice",
      password: "alice-pass-1",
    });
    const login = await auth.login("alice", "alice-pass-1", "ip-disable");
    expect(login.ok).toBe(true);

    const first = await controller.disableUser(alice.id, admin);
    expect(first.user.disabledAt).toBeTruthy();
    expect(first.sessionsRevoked).toBe(1);
    if (login.ok) {
      expect(await auth.resolveUser(login.result.token)).toBeUndefined();
    }

    const again = await controller.disableUser(alice.id, admin);
    expect(again.user.disabledAt).toBeTruthy();
    expect(again.sessionsRevoked).toBe(0);
  });

  it("用户不存在 → 404", async () => {
    const admin = await makeAdmin();
    await expect(controller.disableUser(99999, admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("不能禁用自己 → 403", async () => {
    const admin = await makeAdmin();
    await expect(controller.disableUser(admin.id, admin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("不能禁用最后一个可用 admin → 403；存在第二个 admin 时可禁用", async () => {
    const admin = await makeAdmin();
    const other = await makeAdmin("admin2");
    // 仅两个 admin：禁用另一个 admin 后只剩自己，仍允许（剩余 >= 1）
    const res = await controller.disableUser(other.id, admin);
    expect(res.user.disabledAt).toBeTruthy();

    // 现在只剩 admin 自己可用：再创建第三个 admin 并尝试用它禁用最后可用 admin
    const third = await db.createUser({
      username: "admin3",
      passwordHash: await hashPassword("admin3-pass"),
      role: "admin",
    });
    await db.disableUser(third);
    const disabledActor: AuthUser = {
      id: third,
      username: "admin3",
      role: "admin",
    };
    await expect(
      controller.disableUser(admin.id, disabledActor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
