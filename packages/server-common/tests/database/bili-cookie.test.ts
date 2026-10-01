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

describe("bili cookie 真源（app_settings 物化 + 版本刷新）", () => {
  it("缺省：无 cookie、version 为 0", async () => {
    expect(await db.getBiliCookie()).toEqual({ cookie: undefined, version: 0 });
    expect(await db.getBiliCookieVersion()).toBe(0);
  });

  it("setBiliCookie 自增 version 并返回最新值", async () => {
    expect(await db.setBiliCookie("SESSDATA=a")).toBe(1);
    expect(await db.getBiliCookie()).toEqual({ cookie: "SESSDATA=a", version: 1 });
    expect(await db.getBiliCookieVersion()).toBe(1);

    expect(await db.setBiliCookie("SESSDATA=b")).toBe(2);
    expect(await db.getBiliCookie()).toEqual({ cookie: "SESSDATA=b", version: 2 });
    expect(await db.getBiliCookieVersion()).toBe(2);
  });

  it("空串清除 cookie 但 version 仍递增", async () => {
    await db.setBiliCookie("SESSDATA=a");
    expect(await db.setBiliCookie("")).toBe(2);

    const result = await db.getBiliCookie();
    expect(result.cookie).toBeUndefined();
    expect(result.version).toBe(2);
    expect(await db.getBiliCookieVersion()).toBe(2);
  });

  it("非法/缺失 version 容错按 0", async () => {
    await db.setSettings({ "bili.cookie.version": "not-a-number" });
    expect(await db.getBiliCookieVersion()).toBe(0);
    // 下一次写入在容错基线 0 上自增为 1
    expect(await db.setBiliCookie("SESSDATA=a")).toBe(1);
  });
});
