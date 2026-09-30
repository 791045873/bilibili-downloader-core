import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { DownloadService } from "./download.service.js";
import { DatabaseService } from "@bilibili-downloader/server-common";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import type { DownloadDto } from "./download.dto.js";
import { createLogMessage } from "@bilibili-downloader/server-common";

/**
 * 下载任务调度器
 *
 * 职责：
 * - 高清下载并发控制（maxConcurrency）
 * - 任务创建/停止/恢复/删除的入口
 * - 事件驱动的 tryScheduleNext()
 * - 服务重启时恢复
 *
 * 低清分析下载与分析触发已迁移至 worker_job 作业队列（见 WorkerService），
 * 高清下载完成后经 onAnalysisTrigger 钩子入队 analyze 作业。
 */
@Injectable()
export class DownloadScheduler implements OnModuleInit {
  private readonly logger = new Logger(DownloadScheduler.name);
  private readonly maxConcurrency: number;
  private readonly runningSet = new Set<number>();

  onAnalysisTrigger?: (taskId: number) => void;

  constructor(
    private readonly downloadService: DownloadService,
    private readonly db: DatabaseService,
  ) {
    this.maxConcurrency = Number(process.env.MAX_CONCURRENT_DOWNLOADS) || 2;
  }

  async onModuleInit(): Promise<void> {
    // 恢复：将上次中断的 downloading 任务标记为 failed
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

    await this.downloadService.restoreTaskCacheFromDatabase();

    // 注册回调：下载完成时自动调度下一个 + 触发分析入队
    this.downloadService.onTaskFinished = (taskId: number) => {
      this.runningSet.delete(taskId);
      this.logger.log(
        createLogMessage("High resolution task slot released", {
          taskId,
          runningCount: this.runningSet.size,
          maxConcurrency: this.maxConcurrency,
        }),
      );
      void this.tryScheduleNext();
      this.onAnalysisTrigger?.(taskId);
    };

    // 启动调度
    await this.tryScheduleNext();
    this.logger.log(
      createLogMessage("Download scheduler started", {
        maxConcurrency: this.maxConcurrency,
        taskCount: tasks.length,
        count: recoveredTaskCount,
      }),
    );
  }

  /** 创建下载任务 + 触发调度（created=false 表示被去重门拒绝，未落库） */
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
      await this.tryScheduleNext();
    }
    return result;
  }

  /** 停止任务 */
  async stopTask(id: number): Promise<{ message: string }> {
    return this.downloadService.stopTask(id);
  }

  /** 恢复任务 + 触发调度 */
  async resumeTask(id: number): Promise<{ message: string }> {
    const result = await this.downloadService.resumeTask(id);
    await this.tryScheduleNext();
    return result;
  }

  /** 删除任务 */
  async deleteTask(id: number): Promise<{ message: string }> {
    // 如果正在运行，先中止
    if (this.runningSet.has(id)) {
      this.downloadService.abortTask(id);
      // 不等待执行结束，直接删除
    }
    return this.downloadService.deleteTask(id);
  }

  // ==================== 调度核心 ====================

  private async tryScheduleNext(): Promise<void> {
    while (this.runningSet.size < this.maxConcurrency) {
      // 原子抢占：created -> downloading（单语句守卫更新，防并发双抢）
      const task = await this.db.claimNextCreatedTask();
      if (!task) break; // 队列空

      const id = task.id!;
      this.runningSet.add(id);
      this.logger.log(
        createLogMessage("Claimed download task for execution", {
          taskId: id,
          bvid: task.bvid,
          cid: task.cid,
          status: TaskStatus.Downloading,
          runningCount: this.runningSet.size,
          maxConcurrency: this.maxConcurrency,
        }),
      );

      // fire-and-forget，不阻塞循环
      this.downloadService.executeTask(task).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          createLogMessage("Download task execution crashed", {
            taskId: id,
            bvid: task.bvid,
            cid: task.cid,
            error: message,
          }),
          err instanceof Error ? err.stack : undefined,
        );
      });
    }
  }
}
