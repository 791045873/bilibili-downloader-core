import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { DownloadService } from "./download.service.js";
import { DatabaseService } from "../database/database.service.js";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import type { DownloadDto } from "./download.dto.js";
import { createLogMessage } from "../logging/server-log.util.js";

export interface LowResDownloadJob {
  taskId: number;
  analysisSubTaskId: number;
  bvid: string;
  cid: number;
  title: string;
}

/**
 * 下载任务调度器
 *
 * 职责：
 * - 并发控制（maxConcurrency）
 * - 任务创建/停止/恢复/删除的入口
 * - 事件驱动的 tryScheduleNext()
 * - 服务重启时恢复
 */
@Injectable()
export class DownloadScheduler implements OnModuleInit {
  private readonly logger = new Logger(DownloadScheduler.name);
  private readonly maxConcurrency: number;
  private readonly maxConcurrentLowRes: number;
  private readonly runningSet = new Set<number>();
  private readonly lowResRunningSet = new Set<number>();
  private readonly lowResRunningResources = new Set<string>();
  private readonly lowResQueue: LowResDownloadJob[] = [];

  onAnalysisTrigger?: (taskId: number) => void;
  onLowResFinished?: (
    taskId: number,
    analysisSubTaskId: number,
    result:
      | { success: true; outputFile: string; quality: number }
      | { success: false; error: string },
  ) => void;

  constructor(
    private readonly downloadService: DownloadService,
    private readonly db: DatabaseService,
  ) {
    this.maxConcurrency = Number(process.env.MAX_CONCURRENT_DOWNLOADS) || 2;
    this.maxConcurrentLowRes =
      Number(process.env.MAX_CONCURRENT_LOW_RES_DOWNLOADS) || 1;
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

    // 注册回调：下载完成时自动调度下一个
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
        maxConcurrentLowRes: this.maxConcurrentLowRes,
        taskCount: tasks.length,
        count: recoveredTaskCount,
      }),
    );
  }

  /** 创建下载任务 + 触发调度 */
  async createDownload(
    dto: DownloadDto,
  ): Promise<{ id: number; message: string }> {
    const result = await this.downloadService.createTask(dto);
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

  scheduleLowResDownload(job: LowResDownloadJob): void {
    // 资源级去重：同 bvid+cid 只允许一个排队/执行中的低清下载
    const existsInQueue = this.lowResQueue.some(
      (j) => j.bvid === job.bvid && j.cid === job.cid,
    );
    const existsRunning = this.lowResRunningResources.has(
      `${job.bvid}-${job.cid}`,
    );
    if (existsInQueue || existsRunning) {
      this.logger.warn(
        createLogMessage(
          "Skipped duplicate low resolution download scheduling",
          {
            taskId: job.taskId,
            analysisSubTaskId: job.analysisSubTaskId,
            bvid: job.bvid,
            cid: job.cid,
            existsInQueue,
            existsRunning,
            queueLength: this.lowResQueue.length,
          },
        ),
      );
      return;
    }

    this.lowResQueue.push(job);
    this.logger.log(
      createLogMessage("Queued low resolution download", {
        taskId: job.taskId,
        analysisSubTaskId: job.analysisSubTaskId,
        bvid: job.bvid,
        cid: job.cid,
        queueLength: this.lowResQueue.length,
        runningCount: this.lowResRunningSet.size,
        maxConcurrentLowRes: this.maxConcurrentLowRes,
      }),
    );
    this.tryScheduleLowRes();
  }

  // ==================== 调度核心 ====================

  private async tryScheduleNext(): Promise<void> {
    while (this.runningSet.size < this.maxConcurrency) {
      // 原子抢占：created → downloading（单语句守卫更新，防并发双抢）
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

  private tryScheduleLowRes(): void {
    while (
      this.lowResRunningSet.size < this.maxConcurrentLowRes &&
      this.lowResQueue.length > 0
    ) {
      const job = this.lowResQueue.shift()!;
      this.lowResRunningSet.add(job.analysisSubTaskId);
      this.lowResRunningResources.add(`${job.bvid}-${job.cid}`);
      this.logger.log(
        createLogMessage("Claimed low resolution download for execution", {
          taskId: job.taskId,
          analysisSubTaskId: job.analysisSubTaskId,
          bvid: job.bvid,
          cid: job.cid,
          queueLength: this.lowResQueue.length,
          runningCount: this.lowResRunningSet.size,
          maxConcurrentLowRes: this.maxConcurrentLowRes,
        }),
      );

      this.downloadService
        .executeLowResDownload(job.bvid, job.cid, job.title)
        .then((result) => {
          this.logger.log(
            createLogMessage("Low resolution download completed", {
              taskId: job.taskId,
              analysisSubTaskId: job.analysisSubTaskId,
              bvid: job.bvid,
              cid: job.cid,
              quality: result.quality,
              outputFile: result.outputFile,
            }),
          );
          this.onLowResFinished?.(job.taskId, job.analysisSubTaskId, {
            success: true,
            outputFile: result.outputFile,
            quality: result.quality,
          });
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            createLogMessage("Low resolution download failed", {
              taskId: job.taskId,
              analysisSubTaskId: job.analysisSubTaskId,
              bvid: job.bvid,
              cid: job.cid,
              error: msg,
            }),
            err instanceof Error ? err.stack : undefined,
          );
          this.onLowResFinished?.(job.taskId, job.analysisSubTaskId, {
            success: false,
            error: msg,
          });
        })
        .finally(() => {
          this.lowResRunningSet.delete(job.analysisSubTaskId);
          this.lowResRunningResources.delete(`${job.bvid}-${job.cid}`);
          this.logger.log(
            createLogMessage("Low resolution task slot released", {
              taskId: job.taskId,
              analysisSubTaskId: job.analysisSubTaskId,
              runningCount: this.lowResRunningSet.size,
              queueLength: this.lowResQueue.length,
              maxConcurrentLowRes: this.maxConcurrentLowRes,
            }),
          );
          this.tryScheduleLowRes();
        });
    }
  }
}
