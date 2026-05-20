/**
 * 下载任务状态机
 *
 * Created ──→ Stopped ──→ Created  (用户停止/恢复)
 * Created ──────────→ Downloading  (调度器触发)
 * Downloading ──→ Success (终态)
 * Downloading ──→ Failed  (终态)
 */
export enum TaskStatus {
  Created = "created",
  Stopped = "stopped",
  Downloading = "downloading",
  Success = "success",
  Failed = "failed",
}

/** 状态流转表 */
const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, ReadonlyArray<TaskStatus>>> = {
  [TaskStatus.Created]: [TaskStatus.Downloading, TaskStatus.Stopped],
  [TaskStatus.Stopped]: [TaskStatus.Created],
  [TaskStatus.Downloading]: [TaskStatus.Success, TaskStatus.Failed],
  [TaskStatus.Success]: [],
  [TaskStatus.Failed]: [],
};

/** 终态集合 */
export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.Success,
  TaskStatus.Failed,
]);

/** 校验状态流转是否合法 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}