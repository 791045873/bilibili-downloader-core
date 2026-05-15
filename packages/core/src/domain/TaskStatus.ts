/**
 * 下载任务状态机
 *
 * Created -> Resolving -> Downloading -> Merging -> Completed
 *                                           \-> Failed
 * 任意状态均可 -> Cancelled
 */
export enum TaskStatus {
  Created = "created",
  Resolving = "resolving",
  Downloading = "downloading",
  Merging = "merging",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}

/** 不可逆的终态集合 */
export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.Completed,
  TaskStatus.Failed,
  TaskStatus.Cancelled,
]);