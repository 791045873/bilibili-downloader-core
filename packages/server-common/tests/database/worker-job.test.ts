import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { initTestDb, truncateAll, type DatabaseService } from "../helpers/db.js";

const db: DatabaseService = await initTestDb();

afterAll(async () => {
  await db.onApplicationShutdown();
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("worker_job 入队与去重", () => {
  it("enqueueJob 入队 queued 并钉住默认值", async () => {
    const job = await db.enqueueJob({ kind: "analyze", refType: "task", refId: 7 });
    expect(job.id).toBeGreaterThan(0);
    expect(job.kind).toBe("analyze");
    expect(job.queue).toBe("nas");
    expect(job.status).toBe("queued");
    expect(job.priority).toBe(0);
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(5);
    expect(job.refType).toBe("task");
    expect(job.refId).toBe(7);
    expect(job.cancelRequested).toBe(false);
  });

  it("enqueueJob 活跃 dedup_key 命中返回既有作业不重复插入", async () => {
    const a = await db.enqueueJob({ kind: "analyze", dedupKey: "bv1:1" });
    const b = await db.enqueueJob({ kind: "analyze", dedupKey: "bv1:1" });
    expect(b.id).toBe(a.id);
    const all = await internalsCount();
    expect(all).toBe(1);
  });

  it("enqueueJob 载荷可携带并回读", async () => {
    const job = await db.enqueueJob({ kind: "analyze", payload: { promptId: 3, mid: 42 } });
    const read = await db.getWorkerJobById(job.id);
    expect(read!.payload).toEqual({ promptId: 3, mid: 42 });
  });
});

describe("worker_job 认领与租约", () => {
  it("claimNextJob 按 priority DESC, id ASC 取一并置 running+租约", async () => {
    const low = await db.enqueueJob({ kind: "k", priority: 0 });
    const high = await db.enqueueJob({ kind: "k", priority: 5 });
    const claimed = await db.claimNextJob("nas", "w1", 60);
    expect(claimed!.id).toBe(high.id);
    expect(claimed!.status).toBe("running");
    expect(claimed!.leaseOwner).toBe("w1");
    expect(claimed!.leaseExpiresAt).not.toBeNull();
    const second = await db.claimNextJob("nas", "w1", 60);
    expect(second!.id).toBe(low.id);
    expect(await db.claimNextJob("nas", "w1", 60)).toBeUndefined();
  });

  it("claimNextJob 跳过未到期(available_at)与已请求取消的作业", async () => {
    await db.enqueueJob({ kind: "k", availableInSeconds: 3600 });
    const cancelled = await db.enqueueJob({ kind: "k" });
    await db.requestCancelJob(cancelled.id);
    expect(await db.claimNextJob("nas", "w1", 60)).toBeUndefined();
  });

  it("并发 claimNextJob 恰好一次成功", async () => {
    await db.enqueueJob({ kind: "k" });
    const results = await Promise.all([
      db.claimNextJob("nas", "w1", 60),
      db.claimNextJob("nas", "w2", 60),
    ]);
    expect(results.filter((r) => r !== undefined)).toHaveLength(1);
  });

  it("renewLease 仅本 owner 且 running 生效", async () => {
    await db.enqueueJob({ kind: "k" });
    const claimed = await db.claimNextJob("nas", "w1", 60);
    expect(await db.renewLease(claimed!.id, "w1", 120)).toBe(true);
    expect(await db.renewLease(claimed!.id, "intruder", 120)).toBe(false);
  });
});

describe("worker_job 终态与 fencing", () => {
  it("completeJob 仅本 owner 生效，抢占者无效", async () => {
    await db.enqueueJob({ kind: "k" });
    const claimed = await db.claimNextJob("nas", "w1", 60);
    expect(await db.completeJob(claimed!.id, "intruder", { ok: true })).toBe(false);
    expect(await db.completeJob(claimed!.id, "w1", { ok: true })).toBe(true);
    const read = await db.getWorkerJobById(claimed!.id);
    expect(read!.status).toBe("succeeded");
    expect(read!.result).toEqual({ ok: true });
    expect(read!.leaseOwner).toBeNull();
  });

  it("failJob 未达上限退避重回 queued，达上限置 failed", async () => {
    await db.enqueueJob({ kind: "k", maxAttempts: 2 });
    const c1 = await db.claimNextJob("nas", "w1", 60);
    expect(await db.failJob(c1!.id, "w1", "boom", 0)).toBe("requeued");
    let read = await db.getWorkerJobById(c1!.id);
    expect(read!.status).toBe("queued");
    expect(read!.attempts).toBe(1);
    expect(read!.lastError).toBe("boom");

    const c2 = await db.claimNextJob("nas", "w1", 60);
    expect(await db.failJob(c2!.id, "w1", "boom2", 0)).toBe("failed");
    read = await db.getWorkerJobById(c2!.id);
    expect(read!.status).toBe("failed");
    expect(read!.attempts).toBe(2);
  });

  it("failJob 抢占者(fencing 失败)返回 lost", async () => {
    await db.enqueueJob({ kind: "k" });
    const claimed = await db.claimNextJob("nas", "w1", 60);
    expect(await db.failJob(claimed!.id, "intruder", "x")).toBe("lost");
  });

  it("reapExpiredJobs 回收过期租约为 queued 并 attempts++", async () => {
    await db.enqueueJob({ kind: "k" });
    const claimed = await db.claimNextJob("nas", "w1", -1);
    const reaped = await db.reapExpiredJobs();
    expect(reaped).toBe(1);
    const read = await db.getWorkerJobById(claimed!.id);
    expect(read!.status).toBe("queued");
    expect(read!.attempts).toBe(1);
    expect(read!.leaseOwner).toBeNull();
  });

  it("reapExpiredJobs 达 max_attempts 时置 failed（毒作业不无限重试）", async () => {
    await db.enqueueJob({ kind: "k", maxAttempts: 1 });
    const claimed = await db.claimNextJob("nas", "w1", -1);
    expect(await db.reapExpiredJobs()).toBe(1);
    const read = await db.getWorkerJobById(claimed!.id);
    expect(read!.status).toBe("failed");
    expect(read!.attempts).toBe(1);
  });
});

describe("worker_job 取消与查询", () => {
  it("cancelWorkerJob：queued 直接置 canceled，且不再被认领", async () => {
    const job = await db.enqueueJob({ kind: "k" });
    const canceled = await db.cancelWorkerJob(job.id);
    expect(canceled!.status).toBe("canceled");
    expect(canceled!.cancelRequested).toBe(true);
    expect(await db.claimNextJob("nas", "w1", 60)).toBeUndefined();
  });

  it("cancelWorkerJob：running 保留状态并置 cancel_requested（协作式）", async () => {
    await db.enqueueJob({ kind: "k" });
    const claimed = await db.claimNextJob("nas", "w1", 60);
    const canceled = await db.cancelWorkerJob(claimed!.id);
    expect(canceled!.status).toBe("running");
    expect(canceled!.cancelRequested).toBe(true);
  });

  it("listWorkerJobs：按 kind/status 过滤并 limit", async () => {
    await db.enqueueJob({ kind: "analyze" });
    await db.enqueueJob({ kind: "analyze" });
    await db.enqueueJob({ kind: "low_res_download" });
    const analyze = await db.listWorkerJobs({ kind: "analyze" });
    expect(analyze).toHaveLength(2);
    expect(analyze.every((j) => j.kind === "analyze")).toBe(true);
    const queued = await db.listWorkerJobs({ status: "queued", limit: 2 });
    expect(queued).toHaveLength(2);
    expect(analyze[0]!.id).toBeGreaterThan(analyze[1]!.id);
  });

  it("getLatestWorkerJobByKind：取同 kind 最新一条", async () => {
    await db.enqueueJob({ kind: "integrity_check", dedupKey: "integrity_check" });
    const first = await db.getLatestWorkerJobByKind("integrity_check");
    await db.completeJob(
      (await db.claimNextJob("nas", "w1", 60))!.id,
      "w1",
      null,
    );
    const second = await db.enqueueJob({
      kind: "integrity_check",
      dedupKey: "integrity_check",
    });
    const latest = await db.getLatestWorkerJobByKind("integrity_check");
    expect(latest!.id).toBe(second.id);
    expect(latest!.id).toBeGreaterThan(first!.id);
  });
});

async function internalsCount(): Promise<number> {
  const pool = (db as unknown as {
    pool: { query(sql: string): Promise<{ rows: any[] }> };
  }).pool;
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM worker_job`);
  return rows[0].count;
}
