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

describe("claimAiSummaryTask", () => {
  it("新建认领 → claimed，置 pending 与 lastTriggeredAt", async () => {
    const { claimed, record } = await db.claimAiSummaryTask({
      bvid: "BV1",
      cid: 1,
      title: "t1",
      promptId: 7,
    });
    expect(claimed).toBe(true);
    expect(record!.status).toBe("pending");
    expect(record!.lastTriggeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(record!.promptId).toBe(7);
  });

  it("pending/analyzing 期间拒绝认领", async () => {
    await db.claimAiSummaryTask({ bvid: "BV1", cid: 1 });
    const second = await db.claimAiSummaryTask({ bvid: "BV1", cid: 1, title: "t2" });
    expect(second.claimed).toBe(false);
    const analyzing = await db.upsertAiSummaryTask({ bvid: "BV1", cid: 1, status: "analyzing" });
    expect(analyzing.status).toBe("analyzing");
    const third = await db.claimAiSummaryTask({ bvid: "BV1", cid: 1 });
    expect(third.claimed).toBe(false);
  });

  it("终态后 re-claim 重置执行字段、覆盖认领字段、保留 lastCompletedAt", async () => {
    await db.claimAiSummaryTask({ bvid: "BV1", cid: 1, title: "old", promptId: 1 });
    await db.upsertAiSummaryTask({
      bvid: "BV1",
      cid: 1,
      status: "completed",
      summaryOutput: "out",
      executionTiming: "1.2s",
      rawResponse: "raw-old",
      modelName: "m-old",
      lastCompletedAt: "2026-01-01T00:00:00.000Z",
    });

    const { claimed, record } = await db.claimAiSummaryTask({
      bvid: "BV1",
      cid: 1,
      title: "new",
      promptId: 9,
    });
    expect(claimed).toBe(true);
    expect(record!.status).toBe("pending");
    expect(record!.title).toBe("new");
    expect(record!.promptId).toBe(9);
    expect(record!.summaryOutput).toBe("out");
    expect(record!.executionTiming).toBeNull();
    expect(record!.rawResponse).toBeNull();
    expect(record!.modelName).toBeNull();
    expect(record!.lastCompletedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(record!.lastTriggeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("并发认领：pending 期间恰好一次 claimed:true", async () => {
    await db.upsertAiSummaryTask({ bvid: "BV1", cid: 1, status: "failed" });
    const results = await Promise.all([
      db.claimAiSummaryTask({ bvid: "BV1", cid: 1 }),
      db.claimAiSummaryTask({ bvid: "BV1", cid: 1 }),
    ]);
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
  });
});

describe("upsertAiSummaryTask 字段保留语义", () => {
  it("未提供的字段保留既有值（含 createdAt）", async () => {
    await db.upsertAiSummaryTask({
      bvid: "BV1",
      cid: 1,
      title: "t",
      status: "completed",
      promptId: 3,
      executionTiming: "2s",
      rawResponse: "raw",
      modelName: "m",
      createdAt: "2026-02-02T00:00:00.000Z",
      lastCompletedAt: "2026-02-02T01:00:00.000Z",
    });

    const updated = await db.upsertAiSummaryTask({
      bvid: "BV1",
      cid: 1,
      status: "completed",
      summaryOutput: "out",
    });
    expect(updated.promptId).toBe(3);
    expect(updated.executionTiming).toBe("2s");
    expect(updated.rawResponse).toBe("raw");
    expect(updated.modelName).toBe("m");
    expect(updated.createdAt).toBe("2026-02-02T00:00:00.000Z");
    expect(updated.lastCompletedAt).toBeNull();
    expect(updated.summaryOutput).toBe("out");
  });

  it("显式提供的字段覆盖既有值", async () => {
    await db.upsertAiSummaryTask({
      bvid: "BV1",
      cid: 1,
      status: "completed",
      rawResponse: "old",
    });
    const updated = await db.upsertAiSummaryTask({
      bvid: "BV1",
      cid: 1,
      status: "completed",
      rawResponse: "new",
    });
    expect(updated.rawResponse).toBe("new");
  });
});

describe("deleteAiSummaryTask", () => {
  it("终态可删并返回 true；pending/analyzing 拒绝并返回 false", async () => {
    await db.upsertAiSummaryTask({ bvid: "BV1", cid: 1, status: "completed" });
    const completed = await db.getAiSummaryTaskByResource("BV1", 1);
    expect(await db.deleteAiSummaryTask(completed!.id!)).toBe(true);
    expect(await db.getAiSummaryTaskByResource("BV1", 1)).toBeUndefined();

    await db.claimAiSummaryTask({ bvid: "BV1", cid: 1 });
    const pending = await db.getAiSummaryTaskByResource("BV1", 1);
    expect(await db.deleteAiSummaryTask(pending!.id!)).toBe(false);
    expect(await db.getAiSummaryTaskByResource("BV1", 1)).toBeDefined();
  });
});

describe("listAiSummaryTasksPaginated", () => {
  it("status 多选 + search ILIKE 转义 + updatedFrom/To", async () => {
    await db.upsertAiSummaryTask({
      bvid: "BV1",
      cid: 1,
      title: "task_a_1",
      status: "completed",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    await db.upsertAiSummaryTask({
      bvid: "BV2",
      cid: 2,
      title: "taskaxa1",
      status: "failed",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    const byStatus = await db.listAiSummaryTasksPaginated({
      page: 1,
      pageSize: 10,
      filter: { status: ["completed"] },
    });
    expect(byStatus.total).toBe(1);
    expect(byStatus.items[0].title).toBe("task_a_1");

    const bySearch = await db.listAiSummaryTasksPaginated({
      page: 1,
      pageSize: 10,
      filter: { search: "a_1" },
    });
    expect(bySearch.total).toBe(1);
    expect(bySearch.items[0].title).toBe("task_a_1");

    const byRange = await db.listAiSummaryTasksPaginated({
      page: 1,
      pageSize: 10,
      filter: {
        updatedFrom: "2026-03-15T00:00:00.000Z",
        updatedTo: "2026-04-15T00:00:00.000Z",
      },
    });
    expect(byRange.total).toBe(1);
    expect(byRange.items[0].title).toBe("taskaxa1");

    const paged = await db.listAiSummaryTasksPaginated({
      page: 1,
      pageSize: 1,
    });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(2);
    expect(paged.hasMore).toBe(true);
  });
});

describe("updateSummaryKnowledgeStatus", () => {
  it("写回 knowledge_status / knowledge_error", async () => {
    await db.upsertAiSummaryTask({ bvid: "BV1", cid: 1, status: "completed" });
    await db.updateSummaryKnowledgeStatus("BV1", 1, "synced");
    const row = await db.getAiSummaryTaskByResource("BV1", 1);
    expect(row!.knowledgeStatus).toBe("synced");
    expect(row!.knowledgeError).toBeNull();

    await db.updateSummaryKnowledgeStatus("BV1", 1, "failed", "cos error");
    const failed = await db.getAiSummaryTaskByResource("BV1", 1);
    expect(failed!.knowledgeStatus).toBe("failed");
    expect(failed!.knowledgeError).toBe("cos error");
  });
});

describe("reconcileStaleAnalysisState", () => {
  it("created 子任务与 pending/analyzing 总结置 failed，终态不受影响", async () => {
    const taskId = await db.insertTask({ status: "created", bvid: "BV1", cid: 1 } as any);
    await db.insertAnalysisSubTask({
      taskId,
      bvid: "BV1",
      cid: 1,
      status: "created",
      createdAt: new Date().toISOString(),
    });
    await db.insertAnalysisSubTask({
      taskId,
      bvid: "BV1",
      cid: 2,
      status: "failed",
      createdAt: new Date().toISOString(),
    });
    await db.upsertAiSummaryTask({ bvid: "BV1", cid: 1, status: "analyzing" });
    await db.upsertAiSummaryTask({ bvid: "BV2", cid: 2, status: "completed" });

    const result = await db.reconcileStaleAnalysisState();
    expect(result.failedSubTasks).toBe(1);
    expect(result.failedSummaryTasks).toBe(1);

    const subRows = await db.getAnalysisSubTasks("BV1", 1);
    expect(subRows[0].status).toBe("failed");
    expect(subRows[0].errorMessage).toBe("服务重启，低清下载中断");
    expect(subRows[0].completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

    const summary = await db.getAiSummaryTaskByResource("BV1", 1);
    expect(summary!.status).toBe("failed");
    expect(summary!.errorMessage).toBe("服务重启，AI 总结中断，请重新触发");

    const done = await db.getAiSummaryTaskByResource("BV2", 2);
    expect(done!.status).toBe("completed");

    const again = await db.reconcileStaleAnalysisState();
    expect(again.failedSubTasks).toBe(0);
    expect(again.failedSummaryTasks).toBe(0);
  });
});

// 一次性状态合并迁移用例已随迁移归档移除（见 packages/server/scripts/one-off-migrations/README.md）。
