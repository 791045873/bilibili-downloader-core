import { Injectable } from "@nestjs/common";
import {
  DatabaseService,
  JOB_KIND,
  analyzeDedupKey,
  lowResDownloadDedupKey,
  screenshotRetryDedupKey,
  INTEGRITY_CHECK_DEDUP_KEY,
} from "@bilibili-downloader/server-common";

/**
 * 分析作业生产者（cloud HTTP 面）。
 *
 * 把 analysis/analysis-task controller 里散落的 `enqueueJob` 入队调用收敛到此处，
 * 统一走作业契约（kind/queue/dedupKey 构造器）。cloud 只生产、不消费、不执行。
 *
 * 注：下载完成后的自动 analyze 入队（含 resolvePromptId / resolveCreatorMid 全链路解析）
 * 由 nas-worker 承担（download handler 的 onAnalysisTrigger 在 nas 触发）；此处仅处理
 * 由用户 HTTP 请求显式触发的入队（promptId 为显式或 undefined，全链路解析在 nas trigger() 完成）。
 */
@Injectable()
export class AnalysisJobProducer {
  constructor(private readonly db: DatabaseService) {}

  async enqueueAnalyze(
    taskId: number,
    bvid: string,
    cid: number,
    promptId?: number,
  ): Promise<void> {
    await this.db.enqueueJob({
      kind: JOB_KIND.analyze,
      queue: "nas",
      refType: "task",
      refId: taskId,
      dedupKey: analyzeDedupKey(bvid, cid),
      payload: { taskId, promptId },
    });
  }

  async enqueueLowResDownload(input: {
    taskId: number;
    analysisSubTaskId: number;
    bvid: string;
    cid: number;
    title: string;
  }): Promise<void> {
    await this.db.enqueueJob({
      kind: JOB_KIND.lowResDownload,
      queue: "nas",
      refType: "task",
      refId: input.taskId,
      dedupKey: lowResDownloadDedupKey(input.bvid, input.cid),
      payload: {
        taskId: input.taskId,
        analysisSubTaskId: input.analysisSubTaskId,
        bvid: input.bvid,
        cid: input.cid,
        title: input.title,
      },
    });
  }

  async enqueueScreenshotRetry(summaryTaskId: number): Promise<void> {
    await this.db.enqueueJob({
      kind: JOB_KIND.screenshotRetry,
      queue: "nas",
      refType: "summary_task",
      refId: summaryTaskId,
      dedupKey: screenshotRetryDedupKey(summaryTaskId),
      payload: { summaryTaskId },
    });
  }

  async enqueueIntegrityCheck(): Promise<void> {
    await this.db.enqueueJob({
      kind: JOB_KIND.integrityCheck,
      queue: "nas",
      dedupKey: INTEGRITY_CHECK_DEDUP_KEY,
    });
  }
}
