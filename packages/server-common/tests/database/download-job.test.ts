import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TaskRecord } from "../../src/database/database.service.js";
import { initTestDb, truncateAll, type DatabaseService } from "../helpers/db.js";

const db: DatabaseService = await initTestDb();

afterAll(async () => {
  await db.onApplicationShutdown();
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("claimCreatedTaskById 原子按 id 认领", () => {
  it("created 任务被原子认领：返回记录且 DB 置 downloading", async () => {
    const id = await db.insertTask({ status: "created" } as TaskRecord);
    const claimed = await db.claimCreatedTaskById(id);
    expect(claimed).toBeDefined();
    expect(claimed!.id).toBe(id);
    expect(claimed!.status).toBe("downloading");
    expect((await db.getTaskById(id))!.status).toBe("downloading");
  });

  it("非 created（success / downloading）认领失败：返回 undefined 且状态不变", async () => {
    const success = await db.insertTask({ status: "success" } as TaskRecord);
    expect(await db.claimCreatedTaskById(success)).toBeUndefined();
    expect((await db.getTaskById(success))!.status).toBe("success");

    const downloading = await db.insertTask({
      status: "downloading",
    } as TaskRecord);
    expect(await db.claimCreatedTaskById(downloading)).toBeUndefined();
    expect((await db.getTaskById(downloading))!.status).toBe("downloading");
  });

  it("两次连续认领同一 id：第一次成功、第二次 undefined（双认领守卫）", async () => {
    const id = await db.insertTask({ status: "created" } as TaskRecord);
    const first = await db.claimCreatedTaskById(id);
    const second = await db.claimCreatedTaskById(id);
    expect(first).toBeDefined();
    expect(first!.status).toBe("downloading");
    expect(second).toBeUndefined();
  });
});
