import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { initTestDb, truncateAll, type DatabaseService } from "../helpers/db.js";
import { WorkerService } from "../../src/worker/worker.service.js";
import type { WorkerJobRecord } from "../../src/database/database.service.js";

const db: DatabaseService = await initTestDb();

afterAll(async () => {
  await db.onApplicationShutdown();
});

beforeEach(async () => {
  await truncateAll(db);
});

function makeWorker(): WorkerService {
  return new WorkerService(db);
}

async function waitForStatus(
  id: number,
  status: string,
  timeoutMs = 3000,
): Promise<WorkerJobRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await db.getWorkerJobById(id);
    if (job && job.status === status) return job;
    if (Date.now() > deadline) {
      throw new Error(
        `job ${id} did not reach status=${status} (last=${job?.status})`,
      );
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("worker loop 派发与终态", () => {
  it("pollOnce 认领并执行 handler，成功写 succeeded + result", async () => {
    const worker = makeWorker();
    const seen: number[] = [];
    worker.registerHandler("test_ok", async (job) => {
      seen.push(job.id);
      return { done: true };
    });
    const job = await db.enqueueJob({ kind: "test_ok" });
    expect(await worker.pollOnce()).toBe(true);
    const done = await waitForStatus(job.id, "succeeded");
    expect(seen).toEqual([job.id]);
    expect(done.result).toEqual({ done: true });
    expect(done.leaseOwner).toBeNull();
  });

  it("handler 抛错 → failJob 退避重回 queued，attempts++", async () => {
    const worker = makeWorker();
    worker.registerHandler("test_fail", async () => {
      throw new Error("boom");
    });
    const job = await db.enqueueJob({ kind: "test_fail" });
    await worker.pollOnce();
    const requeued = await waitForStatus(job.id, "queued");
    expect(requeued.attempts).toBe(1);
    expect(requeued.lastError).toBe("boom");
  });

  it("未注册 kind → failJob 不崩溃", async () => {
    const worker = makeWorker();
    const job = await db.enqueueJob({ kind: "unknown_kind" });
    await worker.pollOnce();
    const requeued = await waitForStatus(job.id, "queued");
    expect(requeued.attempts).toBe(1);
    expect(requeued.lastError).toContain("No handler");
  });

  it("pollOnce 无作业返回 false", async () => {
    const worker = makeWorker();
    expect(await worker.pollOnce()).toBe(false);
  });

  it("drain 依次派发多个作业", async () => {
    const worker = makeWorker();
    worker.registerHandler("test_ok", async () => ({ ok: 1 }));
    const a = await db.enqueueJob({ kind: "test_ok" });
    const b = await db.enqueueJob({ kind: "test_ok" });
    const dispatched = await worker.drain();
    expect(dispatched).toBe(2);
    await waitForStatus(a.id, "succeeded");
    await waitForStatus(b.id, "succeeded");
  });

  it("runReaperOnce 回收过期租约", async () => {
    const worker = makeWorker();
    await db.enqueueJob({ kind: "test_ok" });
    const claimed = await db.claimNextJob("nas", "dead-worker", -1);
    expect(await worker.runReaperOnce()).toBe(1);
    const read = await db.getWorkerJobById(claimed!.id);
    expect(read!.status).toBe("queued");
  });
});
