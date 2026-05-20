import type { TaskStatus } from "../domain/TaskStatus.js";
import type { DownloadRequest } from "../domain/DownloadRequest.js";
import type { DownloadPlan } from "../domain/DownloadPlan.js";
import type { DownloadResult } from "../domain/DownloadResult.js";

/**
 * 下载事件 - UseCase 通过 EventEmitter 对外广播进度
 */
export type DownloadEvent =
  | TaskStartedEvent
  | StreamSelectedEvent
  | DownloadProgressEvent
  | MergeProgressEvent
  | TaskSucceededEvent
  | TaskFailedEvent;

/** 事件类型枚举 */
export enum DownloadEventType {
  TaskStarted = "task:started",
  StreamSelected = "stream:selected",
  DownloadProgress = "download:progress",
  MergeProgress = "merge:progress",
  TaskSucceeded = "task:succeeded",
  TaskFailed = "task:failed",
}

export interface TaskStartedEvent {
  type: DownloadEventType.TaskStarted;
  request: DownloadRequest;
  status: TaskStatus.Downloading;
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
  downloadedBytes?: number;
  /** 总字节数 */
  totalBytes?: number;
  /** 下载速度 (bytes/s) */
  speedBytesPerSec: number;
  /** 进度百分比 0-100 */
  percentage: number;
}

export interface MergeProgressEvent {
  type: DownloadEventType.MergeProgress;
}

export interface TaskSucceededEvent {
  type: DownloadEventType.TaskSucceeded;
  result: DownloadResult;
  status: TaskStatus.Success;
}

export interface TaskFailedEvent {
  type: DownloadEventType.TaskFailed;
  result: DownloadResult;
  status: TaskStatus.Failed;
}