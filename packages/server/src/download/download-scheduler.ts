import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { DownloadService } from "./download.service.js";
import {
  DatabaseService,
  WorkerService,
  JOB_KIND,
  downloadDedupKey,
  createLogMessage,
  type WorkerJobRecord,
  type DownloadJobPayload,
} from "@bilibili-downloader/server-common";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import type { DownloadDto } from "./download.dto.js";

/**
 * 下载任务调度器
 *
 * 职责（Phase 3 Stage B-4 起）：
 * - 下载作业的生产者：创建/恢复任务后入队 download 作业，停止/删除时取消活跃作业
 * - download kind 的 handler 宿主：从 worker_job 认领后执行下载并触发自动分析
 *
 * 高清下载并发由 WorkerService 的 per-kind 上限承担（download kind 读
 * `WORKER_MAX_CONCURRENT_DOWNLOAD` 回退 `MAX_CONCURRENT_DOWNLOADS`），不再进程内调度。
 */
@Injectable()
export class DownloadScheduler implements OnModuleInit {
  private readonly logger = new Logger(DownloadScheduler.name);

  onAnalysisTrigger?: (taskId: number) => void;

  constructor(
    private readonly downloadService: DownloadService,
    private readonly db: DatabaseService,
    private readonly worker: WorkerService,
  ) {}

  async onModuleInit(): Promise<void> {
    // 启动恢复：将上次中断的 downloading 任务标记为 failed。
    // 注：此对账在 Phase 3 Stage B-5 拆分后归 nas-worker（谁推进 downloading 谁对账）。
    const tasks = await this.db.getTasks();
    let recoveredTaskCount = 0;
    for (const t of tasks) {
      if (t.status === TaskStatus.Downloading) {
        await this.db.updateTaskStatus(t.id!, {
          status: TaskStatus.Failed,
          errorMessage: "服务重启，任务中断",
        });
        recoveredTaskCount += 1;
      }
    }

    this.worker.registerHandler(JOB_KIND.download, (job) =>
      this.handleDownloadJob(job),
    );

    // 入队漏失兜底（B6）：为所有 created 任务补入队 download 作业（dedupKey 幂等）。
    let backfilled = 0;
    for (const t of tasks) {
      if (t.status === TaskStatus.Created && t.id != null) {
        await this.enqueueDownloadJob(t.id, t.bvid, t.cid);
        backfilled += 1;
      }
    }

    this.logger.log(
      createLogMessage("Download scheduler started", {
        taskCount: tasks.length,
        count: recoveredTaskCount,
        backfilled,
      }),
    );
  }

  /** 创建下载任务 + 入队（created=false 表示被去重门拒绝，未落库） */
  async createDownload(
    dto: DownloadDto,
  ): Promise<
    | { created: true; id: number; message: string }
    | { created: false; message: string }
  > {
    const result = await this.downloadService.createTask(dto);
    if (result.created) {
      this.logger.log(
        createLogMessage("Download task queued for scheduling", {
          taskId: result.id,
          bvid: dto.bvid,
          cid: dto.cid,
          quality: dto.quality,
          codec: dto.codec,
          autoSummary: dto.autoSummary,
          hasOutputPath: Boolean(dto.outputPath),
        }),
      );
      await this.enqueueDownloadJob(result.id, dto.bvid, dto.cid);
    }
    return result;
  }

  /** 停止任务：置 Stopped 后取消活跃 download 作业 */
  async stopTask(id: number): Promise<{ message: string }> {
    const result = await this.downloadService.stopTask(id);
    await this.cancelActiveDownloadJob(id);
    return result;
  }

  /** 恢复任务：置回 Created 后重新入队（dedupKey 幂等；旧 job 已 canceled 不在活跃集合内） */
  async resumeTask(id: number): Promise<{ message: string }> {
    const result = await this.downloadService.resumeTask(id);
    const task = await this.db.getTaskById(id);
    await this.enqueueDownloadJob(id, task?.bvid, task?.cid);
    return result;
  }

  /** 删除任务：先取消活跃 download 作业（避免 handler 认领后查无 task 抛错重试），再删 task */
  async deleteTask(id: number): Promise<{ message: string }> {
    await this.cancelActiveDownloadJob(id);
    return this.downloadService.deleteTask(id);
  }

  // ==================== download handler ====================

  private async handleDownloadJob(job: WorkerJobRecord): Promise<void> {
    const payload = job.payload as DownloadJobPayload | null;
    const taskId = payload?.taskId;
    if (typeof taskId !== "number") {
      throw new Error(`download 作业缺少 payload.taskId (jobId=${job.id})`);
    }

    const task = await this.downloadService.getTaskById(taskId);
    if (!task) {
      this.logger.warn(
        createLogMessage("Download job skipped: task not found", {
          jobId: job.id,
          taskId,
        }),
      );
      return;
    }

    await this.downloadService.executeTask(task);
    // executeTask 内部已把失败写 DB、不抛，故此处 analyze 的 success 校验照旧生效。
    this.onAnalysisTrigger?.(taskId);
  }

  // ==================== 作业生产辅助 ====================

  private async enqueueDownloadJob(
    taskId: number,
    bvid: string | undefined,
    cid: number | undefined,
  ): Promise<void> {
    if (!bvid || typeof cid !== "number") {
      this.logger.warn(
        createLogMessage("Skip enqueue download job: missing bvid/cid", {
          taskId,
        }),
      );
      return;
    }
    await this.db.enqueueJob({
      kind: JOB_KIND.download,
      queue: "nas",
      refType: "task",
      refId: taskId,
      dedupKey: downloadDedupKey(bvid, cid),
      payload: { taskId },
    });
  }

  private async cancelActiveDownloadJob(taskId: number): Promise<void> {
    const job = await this.db.findActiveDownloadJobByTask(taskId);
    if (job) {
      await this.db.cancelWorkerJob(job.id);
    }
  }
}
