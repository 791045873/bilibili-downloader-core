import type { TaskStatus } from "./TaskStatus.js";

/**
 * 下载结果 - UseCase 执行完成后的最终产物
 */
export interface DownloadResult {
  /** 最终状态 */
  status: TaskStatus.Success | TaskStatus.Failed;

  /** 输出文件绝对路径 (成功时) */
  outputFile?: string;

  /** 文件大小 (字节, 成功时) */
  fileSize?: number;

  /** 错误码 (失败时) */
  errorCode?: DownloadErrorCode;

  /** 错误消息 (失败时) */
  errorMessage?: string;

  /** 各阶段耗时 (毫秒) */
  timing?: {
    totalMs: number;
    resolveMs: number;
    downloadMs: number;
    mergeMs: number;
  };
}

/** 下载错误码 */
export enum DownloadErrorCode {
  /** 输入解析失败 (无效 BV/AV/URL) */
  INPUT_PARSE_ERROR = "INPUT_PARSE_ERROR",

  /** 资源不存在 / 已失效 */
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",

  /** 需要登录 */
  LOGIN_REQUIRED = "LOGIN_REQUIRED",

  /** 网络请求失败 */
  NETWORK_ERROR = "NETWORK_ERROR",

  /** 下载失败 */
  DOWNLOAD_ERROR = "DOWNLOAD_ERROR",

  /** 合并失败 */
  MERGE_ERROR = "MERGE_ERROR",

  /** 磁盘空间不足 */
  DISK_FULL = "DISK_FULL",

  /** 未知错误 */
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}