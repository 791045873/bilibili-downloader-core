import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { initTestDb, truncateAll, type DatabaseService } from "../helpers/db.js";

const pg: DatabaseService = await initTestDb();
const prisma = new PrismaService();

afterAll(async () => {
  await prisma.onApplicationShutdown();
  await pg.onApplicationShutdown();
});

beforeAll(async () => {
  await truncateAll(pg);
  await (
    pg as unknown as {
      pool: { query(sql: string, values?: unknown[]): Promise<unknown> };
    }
  ).pool.query(`INSERT INTO app_settings (key, value) VALUES ('p1', 'v1')`);
  await pg.insertTask({
    status: "success",
    bvid: "BV1",
    cid: 12345678901,
    fileSize: 98765432101,
    createdAt: new Date().toISOString(),
  } as never);
});

describe("PrismaService", () => {
  it("可经 db.orm 读取 app_settings", async () => {
    const row = await prisma.db.orm.public.AppSettings.where({ key: "p1" }).first();
    expect(row).toEqual({ key: "p1", value: "v1" });
  });

  it("Task 运行时类型钉住：int8→BigInt，timestamptz→Temporal.Instant", async () => {
    const row = await prisma.db.orm.public.Task.where({ bvid: "BV1" }).first();
    expect(row).toBeDefined();
    const record = row as unknown as Record<string, unknown>;
    expect(record.id!.constructor.name).toBe("BigInt");
    expect(record.cid!.constructor.name).toBe("BigInt");
    expect(record.fileSize!.constructor.name).toBe("BigInt");
    expect(record.createdAt!.constructor.name).toBe("Instant");
    expect(String(record.createdAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(row!.status).toBe("success");
  });

  it("DATABASE_URL 缺失时构造即抛错（与 DatabaseService 同语义）", () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => new PrismaService()).toThrow("DATABASE_URL is required");
    } finally {
      process.env.DATABASE_URL = original;
    }
  });

  it("惰性连接：构造成功但不发查询不建连（指向不可达端口）", async () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:59999/none";
    const lazy = new PrismaService();
    try {
      await expect(
        lazy.db.orm.public.AppSettings.where({ key: "p1" }).first(),
      ).rejects.toThrow();
    } finally {
      process.env.DATABASE_URL = original;
    }
  });
});
