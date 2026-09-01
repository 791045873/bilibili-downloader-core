import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  initTestDb,
  internals,
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

describe("analysis_sub_task", () => {
  it("insert/update 状态流转与资源级查询", async () => {
    const taskId = await db.insertTask({ status: "success", bvid: "BV1", cid: 1 } as any);
    const sid = await db.insertAnalysisSubTask({
      taskId,
      bvid: "BV1",
      cid: 1,
      quality: 80,
      status: "created",
      createdAt: new Date().toISOString(),
    });
    await db.updateAnalysisSubTaskStatus(sid, {
      status: "success",
      outputFile: "s.jpg",
      completedAt: new Date().toISOString(),
    });
    const rows = await db.getAnalysisSubTasks("BV1", 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].taskId).toBe(taskId);
    expect(rows[0].status).toBe("success");
    expect(rows[0].outputFile).toBe("s.jpg");
    expect(rows[0].completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("partial unique index：活跃记录 (bvid,cid,quality) 唯一，failed 不受限", async () => {
    const taskId = await db.insertTask({ status: "success" } as any);
    await db.insertAnalysisSubTask({
      taskId,
      bvid: "BV1",
      cid: 1,
      quality: 80,
      status: "created",
      createdAt: new Date().toISOString(),
    });
    await expect(
      db.insertAnalysisSubTask({
        taskId,
        bvid: "BV1",
        cid: 1,
        quality: 80,
        status: "created",
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow();

    await db.insertAnalysisSubTask({
      taskId,
      bvid: "BV1",
      cid: 1,
      quality: 80,
      status: "failed",
      createdAt: new Date().toISOString(),
    });
    expect(await db.getAnalysisSubTasks("BV1", 1)).toHaveLength(2);
  });

  it("一次性 supersede 迁移：旧活跃记录标 failed 并重建唯一索引（幂等）", async () => {
    const taskId = await db.insertTask({ status: "success" } as any);
    const pool = internals(db).pool;
    await pool.query(`DROP INDEX IF EXISTS idx_analysis_sub_task_active`);

    await db.insertAnalysisSubTask({
      taskId,
      bvid: "BV1",
      cid: 1,
      quality: 80,
      status: "created",
      createdAt: new Date().toISOString(),
    });
    await db.insertAnalysisSubTask({
      taskId,
      bvid: "BV1",
      cid: 1,
      quality: 80,
      status: "created",
      createdAt: new Date(Date.now() + 1000).toISOString(),
    });

    await (db as any).initSchema();
    const rows = await db.getAnalysisSubTasks("BV1", 1);
    const statuses = rows.map((r) => r.status).sort();
    expect(statuses).toEqual(["created", "failed"]);
    expect(
      rows.find((r) => r.status === "failed")!.errorMessage,
    ).toBe("superseded by newer record");

    await (db as any).initSchema();
    expect((await db.getAnalysisSubTasks("BV1", 1)).length).toBe(2);
  });
});
