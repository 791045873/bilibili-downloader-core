import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

describe("app_settings", () => {
  it("getSettings 缺失键不含于结果", async () => {
    expect(await db.getSettings([])).toEqual({});
    expect(await db.getSettings(["missing"])).toEqual({});
  });

  it("setSettings upsert，空串删除", async () => {
    await db.setSettings({ a: "1", b: "" });
    expect(await db.getSettings(["a", "b"])).toEqual({ a: "1" });

    await db.setSettings({ a: "2" });
    expect(await db.getSettings(["a"])).toEqual({ a: "2" });

    await db.setSettings({ a: "" });
    expect(await db.getSettings(["a"])).toEqual({});
  });
});
