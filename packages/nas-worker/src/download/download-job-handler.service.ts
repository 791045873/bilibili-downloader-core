import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { DownloadExecutorService } from "./download-executor.service.js";
import {
  DatabaseService,
  WorkerService,
  JOB_KIND,
  createLogMessage,
  type WorkerJobRecord,
  type DownloadJobPayload,
} from "@bilibili-downloader/server-common";
import { TaskStatus } from "@bilibili-downloader/core/domain";

/**
 * download kind 的消费宿主（nas 半）。
 *
 * 职责：
 * - 注册 download handler（构造器注册，先于 WorkerService 轮询，避免「无 handler」误判）；
 * - 启动恢复：上次中断的 `downloading` 任务标记 `failed`（谁推进 downloading 谁对账）；
 * - handler：认领 download 作业 → executeTask → 触发自动分析（onAnalysisTrigger）。
 *
 * `onAnalysisTrigger` 由 nas 的 AnalysisJobHandlers 在其 onModuleInit 中注入。
 */
@Injectable()
export class DownloadJobHandler implements OnModuleInit {
  private readonly logger = new Logger(DownloadJobHandler.name);

  onAnalysisTrigger?: (taskId: number) => void;

  constructor(
    private readonly downloadExecutor: DownloadExecutorService,
    private readonly db: DatabaseService,
    private readonly worker: WorkerService,
  ) {
    // 注册时机：构造器注册，确保早于 WorkerService.onModuleInit 的轮询启动。
    this.worker.registerHandler(JOB_KIND.download, (job) =>
      this.handleDownloadJob(job),
    );
  }

  async onModuleInit(): Promise<void> {
    // 启动恢复：将上次中断的 downloading 任务标记为 failed。
    const tasks = await this.db.getTasks();
    let recoveredTaskCount = 0;
    for (const t of tasks) {
      if (t.status === TaskStatus.Downloading && t.id != null) {
        await this.db.updateTaskStatus(t.id, {
          status: TaskStatus.Failed,
          errorMessage: "服务重启，任务中断",
        });
        recoveredTaskCount += 1;
      }
    }
    this.logger.log(
      createLogMessage("Download job handler started", {
        taskCount: tasks.length,
        count: recoveredTaskCount,
      }),
    );
  }

  private async handleDownloadJob(job: WorkerJobRecord): Promise<void> {
    const payload = job.payload as DownloadJobPayload | null;
    const taskId = payload?.taskId;
    if (typeof taskId !== "number") {
      throw new Error(`download 作业缺少 payload.taskId (jobId=${job.id})`);
    }

    const task = await this.downloadExecutor.getTaskById(taskId);
    if (!task) {
      this.logger.warn(
        createLogMessage("Download job skipped: task not found", {
          jobId: job.id,
          taskId,
        }),
      );
      return;
    }

    await this.downloadExecutor.executeTask(task);
    // executeTask 内部已把失败写 DB、不抛，故此处 analyze 的 success 校验照旧生效。
    this.onAnalysisTrigger?.(taskId);
  }
}
