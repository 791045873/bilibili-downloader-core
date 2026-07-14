import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { DownloadService } from "./download.service.js";
import { DatabaseService } from "../database/database.service.js";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import type { DownloadDto } from "./download.dto.js";

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
  private readonly lowResQueue: LowResDownloadJob[] = [];

  onAnalysisTrigger?: (taskId: number) => void;
  onLowResFinished?: (
    taskId: number,
    analysisSubTaskId: number,
    result: { success: true; outputFile: string; quality: number } | { success: false; error: string },
  ) => void;

  constructor(
    private readonly downloadService: DownloadService,
    private readonly db: DatabaseService,
  ) {
    this.maxConcurrency = Number(process.env.MAX_CONCURRENT_DOWNLOADS) || 2;
    this.maxConcurrentLowRes = Number(process.env.MAX_CONCURRENT_LOW_RES_DOWNLOADS) || 1;
  }

  async onModuleInit(): Promise<void> {
    // 恢复：将上次中断的 downloading 任务标记为 failed
    const tasks = this.db.getTasks();
    for (const t of tasks) {
      if (t.status === TaskStatus.Downloading) {
        this.db.updateTaskStatus(t.id!, {
          status: TaskStatus.Failed,
          errorMessage: "服务重启，任务中断",
        });
      }
    }

    // 注册回调：下载完成时自动调度下一个
    this.downloadService.onTaskFinished = (taskId: number) => {
      this.runningSet.delete(taskId);
      this.tryScheduleNext();
      this.onAnalysisTrigger?.(taskId);
    };

    // 启动调度
    this.tryScheduleNext();
    this.logger.log(
      `下载调度器已启动，高分辨率并发: ${this.maxConcurrency}，低分辨率并发: ${this.maxConcurrentLowRes}`,
    );
  }

  /** 创建下载任务 + 触发调度 */
  async createDownload(dto: DownloadDto): Promise<{ id: number; message: string }> {
    const result = await this.downloadService.createTask(dto);
    this.tryScheduleNext();
    return result;
  }

  /** 停止任务 */
  async stopTask(id: number): Promise<{ message: string }> {
    return this.downloadService.stopTask(id);
  }

  /** 恢复任务 + 触发调度 */
  async resumeTask(id: number): Promise<{ message: string }> {
    const result = await this.downloadService.resumeTask(id);
    this.tryScheduleNext();
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
    const existsInQueue = this.lowResQueue.some(
      (j) => j.taskId === job.taskId && j.analysisSubTaskId === job.analysisSubTaskId,
    );
    const existsRunning = this.lowResRunningSet.has(job.analysisSubTaskId);
    if (existsInQueue || existsRunning) return;

    this.lowResQueue.push(job);
    this.tryScheduleLowRes();
  }

  // ==================== 调度核心 ====================

  private tryScheduleNext(): void {
    while (this.runningSet.size < this.maxConcurrency) {
      const task = this.db.findNextCreatedTask();
      if (!task) break; // 队列空

      // 原子抢占：created → downloading
      this.db.updateTaskStatus(task.id!, { status: TaskStatus.Downloading });

      const id = task.id!;
      this.runningSet.add(id);

      // fire-and-forget，不阻塞循环
      this.downloadService.executeTask(task).catch((err) => {
        this.logger.error(`任务 ${id} 执行失败`, err);
      });
    }
  }

  private tryScheduleLowRes(): void {
    while (
      this.lowResRunningSet.size < this.maxConcurrentLowRes
      && this.lowResQueue.length > 0
    ) {
      const job = this.lowResQueue.shift()!;
      this.lowResRunningSet.add(job.analysisSubTaskId);

      this.downloadService
        .executeLowResDownload(job.bvid, job.cid, job.title)
        .then((result) => {
          this.onLowResFinished?.(job.taskId, job.analysisSubTaskId, {
            success: true,
            outputFile: result.outputFile,
            quality: result.quality,
          });
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`低分辨率下载失败: task=${job.taskId}, subTask=${job.analysisSubTaskId}, ${msg}`);
          this.onLowResFinished?.(job.taskId, job.analysisSubTaskId, {
            success: false,
            error: msg,
          });
        })
        .finally(() => {
          this.lowResRunningSet.delete(job.analysisSubTaskId);
          this.tryScheduleLowRes();
        });
    }
  }
}