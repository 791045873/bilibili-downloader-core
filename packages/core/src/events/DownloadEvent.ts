import type { TaskStatus } from "../domain/TaskStatus.js";
import type { DownloadRequest } from "../domain/DownloadRequest.js";
import type { DownloadPlan } from "../domain/DownloadPlan.js";
import type { DownloadResult } from "../domain/DownloadResult.js";

/**
 * 下载事件 - UseCase 通过 EventEmitter 对外广播进度
 */
export type DownloadEvent =
  | TaskStartedEvent
  | TaskResolvedEvent
  | StreamSelectedEvent
  | DownloadProgressEvent
  | MergeProgressEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskCancelledEvent;

/** 事件类型枚举 */
export enum DownloadEventType {
  TaskStarted = "task:started",
  TaskResolved = "task:resolved",
  StreamSelected = "stream:selected",
  DownloadProgress = "download:progress",
  MergeProgress = "merge:progress",
  TaskCompleted = "task:completed",
  TaskFailed = "task:failed",
  TaskCancelled = "task:cancelled",
}

export interface TaskStartedEvent {
  type: DownloadEventType.TaskStarted;
  request: DownloadRequest;
  status: TaskStatus.Created;
}

export interface TaskResolvedEvent {
  type: DownloadEventType.TaskResolved;
  request: DownloadRequest;
  plan: DownloadPlan;
  status: TaskStatus.Resolving;
}

export interface StreamSelectedEvent {
  type: DownloadEventType.StreamSelected;
  videoCodec: string;
  videoQuality: string;
  audioCodec: string;
  audioQuality: string;
}

export interface DownloadProgressEvent {
  type: DownloadEventType.DownloadProgress;
  /** 已下载字节数 */
  downloadedBytes: number;
  /** 总字节数 */
  totalBytes: number;
  /** 下载速度 (bytes/s) */
  speedBytesPerSec: number;
  /** 进度百分比 0-100 */
  percentage: number;
}

export interface MergeProgressEvent {
  type: DownloadEventType.MergeProgress;
}

export interface TaskCompletedEvent {
  type: DownloadEventType.TaskCompleted;
  result: DownloadResult;
  status: TaskStatus.Completed;
}

export interface TaskFailedEvent {
  type: DownloadEventType.TaskFailed;
  result: DownloadResult;
  status: TaskStatus.Failed;
}

export interface TaskCancelledEvent {
  type: DownloadEventType.TaskCancelled;
  result: DownloadResult;
  status: TaskStatus.Cancelled;
}