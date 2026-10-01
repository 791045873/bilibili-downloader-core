import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { DownloadTaskService } from "./download-task.service.js";
import {
  DatabaseService,
  JOB_KIND,
  downloadDedupKey,
  createLogMessage,
} from "@bilibili-downloader/server-common";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import type { DownloadDto } from "./download.dto.js";

/**
 * 下载作业生产者（cloud 半）。
 *
 * 职责：创建/恢复任务后入队 download 作业；停止/删除时取消活跃作业；
 * 启动时为残留 `created` 任务补入队（B6 幂等兜底，靠 dedupKey）。
 *
 * 物理隔离：**不** 注入 WorkerService（队列消费是 nas-worker 的职责），
 * 入队/取消均直接走 `DatabaseService`（worker_job 仓储）。
 * `downloading → failed` 的启动对账归 nas-worker（谁推进 downloading 谁对账）。
 */
@Injectable()
export class DownloadScheduler implements OnModuleInit {
  private readonly logger = new Logger(DownloadScheduler.name);

  constructor(
    private readonly downloadService: DownloadTaskService,
    private readonly db: DatabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    const tasks = await this.db.getTasks();
    let backfilled = 0;
    for (const t of tasks) {
      if (t.status === TaskStatus.Created && t.id != null) {
        await this.enqueueDownloadJob(t.id, t.bvid, t.cid);
        backfilled += 1;
      }
    }
    this.logger.log(
      createLogMessage("Download producer started", {
        taskCount: tasks.length,
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

  /** 恢复任务：置回 Created 后重新入队（dedupKey 幂等） */
  async resumeTask(id: number): Promise<{ message: string }> {
    const result = await this.downloadService.resumeTask(id);
    const task = await this.db.getTaskById(id);
    await this.enqueueDownloadJob(id, task?.bvid, task?.cid);
    return result;
  }

  /** 删除任务：先取消活跃 download 作业（避免 handler 认领后查无 task 重试），再删 task */
  async deleteTask(id: number): Promise<{ message: string }> {
    await this.cancelActiveDownloadJob(id);
    return this.downloadService.deleteTask(id);
  }

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
