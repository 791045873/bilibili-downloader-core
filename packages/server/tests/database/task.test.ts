import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TaskRecord } from "../src/database/database.service.js";
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

describe("task lifecycle", () => {
  it("insertTask 返回自增 id 并钉住默认值", async () => {
    const id = await db.insertTask({ status: "created" } as TaskRecord);
    const row = await db.getTaskById(id);
    expect(row).toBeDefined();
    expect(row!.status).toBe("created");
    expect(row!.progress).toBe(0);
    expect(row!.autoSummary).toBe(0);
    expect(row!.summaryStatus).toBeNull();
    expect(row!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(row!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("insertTask 忽略传入的 updatedAt（恒取 now）", async () => {
    const id = await db.insertTask({
      status: "created",
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2000-01-01T00:00:00.000Z",
    } as TaskRecord);
    const row = await db.getTaskById(id);
    expect(row!.createdAt).toBe("2000-01-01T00:00:00.000Z");
    expect(row!.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
  });

  it("updateTaskProgress 更新 progress 与 speed", async () => {
    const id = await db.insertTask({ status: "created" } as TaskRecord);
    await db.updateTaskProgress(id, 42.5, "1.2MB/s");
    const row = await db.getTaskById(id);
    expect(row!.progress).toBe(42.5);
    expect(row!.speed).toBe("1.2MB/s");
  });

  it("updateTaskStatus 动态 SET 且 success 置 completedAt", async () => {
    const id = await db.insertTask({ status: "downloading" } as TaskRecord);
    await db.updateTaskStatus(id, {
      status: "success",
      outputFile: "out.mp4",
      fileSize: 123456,
      durationMs: 9000,
    });
    const row = await db.getTaskById(id);
    expect(row!.status).toBe("success");
    expect(row!.outputFile).toBe("out.mp4");
    expect(row!.fileSize).toBe(123456);
    expect(row!.durationMs).toBe(9000);
    expect(row!.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(row!.errorCode).toBeNull();
  });

  it("updateTaskStatus failed 写入错误字段", async () => {
    const id = await db.insertTask({ status: "downloading" } as TaskRecord);
    await db.updateTaskStatus(id, {
      status: "failed",
      errorCode: "E1",
      errorMessage: "boom",
    });
    const row = await db.getTaskById(id);
    expect(row!.status).toBe("failed");
    expect(row!.errorCode).toBe("E1");
    expect(row!.errorMessage).toBe("boom");
    expect(row!.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("claimNextCreatedTask FIFO 且原子", async () => {
    const a = await db.insertTask({ status: "created" } as TaskRecord);
    await db.insertTask({ status: "created" } as TaskRecord);
    const claimed = await db.claimNextCreatedTask();
    expect(claimed!.id).toBe(a);
    expect(claimed!.status).toBe("downloading");
    const none = await db.claimNextCreatedTask();
    expect(none).toBeDefined();
  });

  it("并发 claimNextCreatedTask 恰好一次成功", async () => {
    await db.insertTask({ status: "created" } as TaskRecord);
    const results = await Promise.all([
      db.claimNextCreatedTask(),
      db.claimNextCreatedTask(),
    ]);
    const defined = results.filter((r) => r !== undefined);
    expect(defined).toHaveLength(1);
    expect(defined[0]!.status).toBe("downloading");
  });
});

describe("task queries", () => {
  it("listTasksPaginated 状态组展开与分页", async () => {
    await db.insertTask({ status: "created" } as TaskRecord);
    await db.insertTask({ status: "downloading" } as TaskRecord);
    await db.insertTask({ status: "success" } as TaskRecord);

    const active = await db.listTasksPaginated({
      page: 1,
      pageSize: 10,
      statusGroup: ["active"],
    });
    expect(active.total).toBe(2);
    expect(active.items.every((t) => ["created", "downloading"].includes(t.status))).toBe(true);

    const all = await db.listTasksPaginated({
      page: 1,
      pageSize: 2,
      statusGroup: ["all"],
    });
    expect(all.total).toBe(3);
    expect(all.items).toHaveLength(2);
    expect(all.hasMore).toBe(true);
    expect(all.items[0]!.createdAt! >= all.items[1]!.createdAt!).toBe(true);
  });

  it("task 读取侧 JOIN ai_summary_task 镜像 summaryStatus", async () => {
    const id = await db.insertTask({
      status: "success",
      bvid: "BV1",
      cid: 1,
    } as TaskRecord);
    await db.upsertAiSummaryTask({
      bvid: "BV1",
      cid: 1,
      status: "completed",
      summaryOutput: "summary-out",
    });
    const row = await db.getTaskById(id);
    expect(row!.summaryStatus).toBe("completed");
    expect(row!.summaryOutput).toBe("summary-out");
  });

  it("findTasksByBvidsAndCids 按 (bvid,cid) 去重取最新", async () => {
    await db.insertTask({ status: "success", bvid: "BV1", cid: 1 } as TaskRecord);
    await new Promise((r) => setTimeout(r, 10));
    const latest = await db.insertTask({ status: "created", bvid: "BV1", cid: 1 } as TaskRecord);
    await db.insertTask({ status: "created", bvid: "BV2", cid: 2 } as TaskRecord);

    const rows = await db.findTasksByBvidsAndCids([
      { bvid: "BV1", cid: 1 },
      { bvid: "BV2", cid: 2 },
      { bvid: "BV3", cid: 3 },
    ]);
    expect(rows).toHaveLength(2);
    const bv1 = rows.find((r) => r.bvid === "BV1")!;
    expect(bv1.id).toBe(latest);
  });

  it("findLatestTaskByBvidAndCid 与 findCompletedTaskByBvidAndCid", async () => {
    await db.insertTask({ status: "failed", bvid: "BV1", cid: 1 } as TaskRecord);
    await db.insertTask({ status: "created", bvid: "BV1", cid: 1 } as TaskRecord);
    const latest = await db.findLatestTaskByBvidAndCid("BV1", 1);
    expect(latest!.status).toBe("created");
    expect(await db.findCompletedTaskByBvidAndCid("BV1", 1)).toBeUndefined();
  });
});

describe("task deletion contracts", () => {
  it("deleteTask 删除 task 与子任务，保留 summary/summary_segment", async () => {
    const id = await db.insertTask({ status: "success", bvid: "BV1", cid: 1 } as TaskRecord);
    await db.insertAnalysisSubTask({
      taskId: id,
      bvid: "BV1",
      cid: 1,
      status: "failed",
      createdAt: new Date().toISOString(),
    });
    await db.upsertSummaryKnowledge({
      bvid: "BV1",
      cid: 1,
      videoTitle: "t",
      rawResponse: "{}",
      segments: [{ seq: 0, title: "s", content: "c" }],
    });

    await db.deleteTask(id);
    expect(await db.getTaskById(id)).toBeUndefined();
    expect(await db.getAnalysisSubTasks("BV1", 1)).toHaveLength(0);
    const kept = await internalsPool().query(`SELECT COUNT(*)::int AS count FROM summary`);
    const segments = await internalsPool().query(
      `SELECT COUNT(*)::int AS count FROM summary_segment`,
    );
    expect(kept.rows[0].count).toBe(1);
    expect(segments.rows[0].count).toBe(1);
  });

  it("clearTasks 清空 task 与 analysis_sub_task", async () => {
    const id = await db.insertTask({ status: "success" } as TaskRecord);
    await db.insertAnalysisSubTask({
      taskId: id,
      status: "failed",
      createdAt: new Date().toISOString(),
    });
    await db.clearTasks();
    const tasks = await db.getTasks();
    expect(tasks).toHaveLength(0);
  });
});

function internalsPool() {
  return (db as unknown as {
    pool: { query(sql: string): Promise<{ rows: any[] }> };
  }).pool;
}
