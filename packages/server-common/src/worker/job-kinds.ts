/**
 * worker_job 作业契约单一真源：kind 常量 + dedupKey 构造器 + payload 类型。
 *
 * 拆分为 cloud-server（生产者）/ nas-worker（消费者）后，入队与消费分处两包，
 * dedupKey 字符串若各处手写极易静默漂移、从而失去活跃状态去重（不报错、只双跑）。
 * 本模块把 kind 与 dedupKey 收敛到一处，两侧共同引用。
 */

export const JOB_KIND = {
  download: "download",
  analyze: "analyze",
  lowResDownload: "low_res_download",
  screenshotRetry: "screenshot_retry",
  integrityCheck: "integrity_check",
} as const;

export type JobKind = (typeof JOB_KIND)[keyof typeof JOB_KIND];

export interface DownloadJobPayload {
  taskId: number;
}

export interface AnalyzeJobPayload {
  taskId: number;
  promptId?: number;
  /** 低清下载完成后的续跑：绕过 claim 直接 runAnalysis */
  continuation?: boolean;
}

export interface LowResDownloadJobPayload {
  taskId: number;
  analysisSubTaskId: number;
  bvid: string;
  cid: number;
  title?: string;
  resourceType?: string;
}

export interface ScreenshotRetryJobPayload {
  summaryTaskId: number;
}

/** 下载执行作业（Phase 3 起 download 迁入 worker_job） */
export function downloadDedupKey(bvid: string, cid: number): string {
  return `download:${bvid}:${cid}`;
}

/** 常规 AI 总结分析作业（经 claim 推进 ai_summary_task） */
export function analyzeDedupKey(bvid: string, cid: number): string {
  return `analyze:${bvid}:${cid}`;
}

/** 低清下载完成后的分析续跑作业（与常规 analyze 刻意不同键，不互相去重） */
export function analyzeContinuationDedupKey(bvid: string, cid: number): string {
  return `analyze:cont:${bvid}:${cid}`;
}

/** 分析用低清视频下载作业 */
export function lowResDownloadDedupKey(bvid: string, cid: number): string {
  return `lowres:${bvid}:${cid}`;
}

/** 截图重试作业（按总结任务 id） */
export function screenshotRetryDedupKey(summaryTaskId: number): string {
  return `screenshot_retry:${summaryTaskId}`;
}

/** 完整性检查作业（全局单例，固定键） */
export const INTEGRITY_CHECK_DEDUP_KEY = "integrity_check";
