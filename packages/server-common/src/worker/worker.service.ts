import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import { hostname } from "node:os";
import {
  DatabaseService,
  type WorkerJobRecord,
} from "../database/database.service.js";
import { createLogMessage } from "../logging/server-log.util.js";

export type WorkerJobHandler = (job: WorkerJobRecord) => Promise<unknown>;

/**
 * 进程内 worker 轮询执行器（Phase 2）。
 *
 * 从 `worker_job` 认领作业并按 kind 分发到已注册 handler；执行期定时续租，
 * 成功/失败写终态（fencing 守卫）；独立 reaper 回收过期租约。本阶段仍单进程，
 * 不改部署形态；跨主机/多进程由租约+SKIP LOCKED 天然安全。
 */
@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private readonly handlers = new Map<string, WorkerJobHandler>();
  private readonly queue: string;
  private readonly workerId: string;
  private readonly leaseTtlSec: number;
  private readonly heartbeatMs: number;
  private readonly pollMs: number;
  private readonly reapMs: number;
  private readonly failBackoffSec: number;
  private readonly maxConcurrent: number;
  private readonly enabled: boolean;
  /** per-kind 并发上限缓存（env `WORKER_MAX_CONCURRENT_<KIND>`，缺省 = 全局，不另加限） */
  private readonly perKindLimits = new Map<string, number>();
  private running = 0;
  private readonly runningByKind = new Map<string, number>();
  private pollTimer?: ReturnType<typeof setInterval>;
  private reapTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly db: DatabaseService) {
    this.queue = process.env.WORKER_QUEUE || "nas";
    this.workerId =
      process.env.WORKER_ID || `${hostname()}#${process.pid}`;
    this.leaseTtlSec = Number(process.env.WORKER_LEASE_TTL_SEC) || 60;
    this.heartbeatMs = Number(process.env.WORKER_HEARTBEAT_MS) || 20000;
    this.pollMs = Number(process.env.WORKER_POLL_INTERVAL_MS) || 4000;
    this.reapMs = Number(process.env.WORKER_REAP_INTERVAL_MS) || 30000;
    this.failBackoffSec = Number(process.env.WORKER_FAIL_BACKOFF_SEC) || 30;
    this.maxConcurrent = Number(process.env.WORKER_MAX_CONCURRENT) || 2;
    this.enabled = process.env.WORKER_ENABLED !== "false";
  }

  registerHandler(kind: string, handler: WorkerJobHandler): void {
    if (this.handlers.has(kind)) {
      throw new Error(`Worker handler already registered for kind=${kind}`);
    }
    this.handlers.set(kind, handler);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(createLogMessage("Worker loop disabled", { queue: this.queue }));
      return;
    }
    this.pollTimer = setInterval(() => void this.drain(), this.pollMs);
    this.reapTimer = setInterval(() => void this.runReaperOnce(), this.reapMs);
    this.heartbeatTimer = setInterval(() => void this.beat(), this.heartbeatMs);
    void this.beat();
    this.logger.log(
      createLogMessage("Worker loop started", {
        queue: this.queue,
        workerId: this.workerId,
        pollMs: this.pollMs,
        leaseTtlSec: this.leaseTtlSec,
        maxConcurrent: this.maxConcurrent,
      }),
    );
  }

  onApplicationShutdown(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reapTimer) clearInterval(this.reapTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  /** 尽量认领并派发作业直至无空闲槽位或无可执行作业。返回本轮派发数量。 */
  async drain(): Promise<number> {
    let dispatched = 0;
    while (this.running < this.maxConcurrent) {
      if (!(await this.pollOnce())) break;
      dispatched += 1;
    }
    return dispatched;
  }

  /** 认领并执行单个作业（fire-and-forget 执行），认领成功返回 true。
   * 已达 per-kind 上限的 kind 本轮排除，避免某 kind（如长耗时 analyze）占满全局槽位。 */
  async pollOnce(): Promise<boolean> {
    const job = await this.db.claimNextJob(
      this.queue,
      this.workerId,
      this.leaseTtlSec,
      this.saturatedKinds(),
    );
    if (!job) return false;
    this.running += 1;
    this.runningByKind.set(job.kind, (this.runningByKind.get(job.kind) ?? 0) + 1);
    void this.runJob(job).finally(() => {
      this.running -= 1;
      this.runningByKind.set(
        job.kind,
        Math.max(0, (this.runningByKind.get(job.kind) ?? 1) - 1),
      );
    });
    return true;
  }

  /** 当前已达各自 per-kind 上限的 kind 列表（无 per-kind 配置的 kind 永不入列）。 */
  private saturatedKinds(): string[] {
    const saturated: string[] = [];
    for (const [kind, running] of this.runningByKind) {
      if (running >= this.perKindLimit(kind)) {
        saturated.push(kind);
      }
    }
    return saturated;
  }

  /** 某 kind 的并发上限：`WORKER_MAX_CONCURRENT_<KIND>`；download 兼容旧
   * `MAX_CONCURRENT_DOWNLOADS`；均未配置则取全局上限（即不额外限制）。 */
  private perKindLimit(kind: string): number {
    const cached = this.perKindLimits.get(kind);
    if (cached !== undefined) return cached;
    const envName = `WORKER_MAX_CONCURRENT_${kind.toUpperCase()}`;
    let value = Number(process.env[envName]);
    if ((!Number.isFinite(value) || value <= 0) && kind === "download") {
      value = Number(process.env.MAX_CONCURRENT_DOWNLOADS);
    }
    const limit =
      Number.isFinite(value) && value > 0 ? value : this.maxConcurrent;
    this.perKindLimits.set(kind, limit);
    return limit;
  }

  async runReaperOnce(): Promise<number> {
    try {
      const reaped = await this.db.reapExpiredJobs();
      if (reaped > 0) {
        this.logger.warn(
          createLogMessage("Reaped expired worker jobs", { count: reaped }),
        );
      }
      return reaped;
    } catch (err) {
      this.logger.error(
        createLogMessage("Worker reaper failed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return 0;
    }
  }

  private async runJob(job: WorkerJobRecord): Promise<void> {
    const handler = this.handlers.get(job.kind);
    if (!handler) {
      await this.db.failJob(
        job.id,
        this.workerId,
        `No handler for kind=${job.kind}`,
        this.failBackoffSec,
      );
      return;
    }
    const renew = setInterval(() => {
      void this.db.renewLease(job.id, this.workerId, this.leaseTtlSec);
    }, Math.max(1000, Math.floor((this.leaseTtlSec * 1000) / 3)));
    try {
      const result = await handler(job);
      await this.db.completeJob(job.id, this.workerId, result ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await this.db.failJob(
        job.id,
        this.workerId,
        message,
        this.failBackoffSec,
      );
      this.logger.error(
        createLogMessage("Worker job failed", {
          id: job.id,
          kind: job.kind,
          outcome,
          error: message,
        }),
        err instanceof Error ? err.stack : undefined,
      );
    } finally {
      clearInterval(renew);
    }
  }

  private async beat(): Promise<void> {
    try {
      await this.db.upsertWorkerHeartbeat(this.workerId, this.queue);
    } catch (err) {
      this.logger.warn(
        createLogMessage("Worker heartbeat failed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}
