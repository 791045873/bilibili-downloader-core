/**
 * 媒体下载端口 - 负责文件传输，不关心业务逻辑
 */
export interface MediaDownloaderPort {
  /**
   * 下载文件到指定路径
   * @returns 下载完成的本地文件路径
   */
  download(params: DownloadParams): Promise<string>;

  /**
   * 取消正在进行的下载
   */
  abort(): void;
}

export interface DownloadParams {
  /** 下载 URL */
  url: string;

  /** 目标文件路径 */
  filePath: string;

  /** Cookie 字符串 */
  cookieString?: string;

  /** Referer header，哔哩哔哩通常需要 https://www.bilibili.com */
  referer?: string;

  /** 进度回调 */
  onProgress?: (progress: DownloadProgress) => void;
}

export interface DownloadProgress {
  /** 已下载字节数 */
  downloadedBytes: number;
  /** 总字节数 */
  totalBytes: number;
  /** 下载速度 (bytes/s) */
  speedBytesPerSec: number;
  /** 进度百分比 0-100 */
  percentage: number;
}

export class DownloadError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly filePath: string,
  ) {
    super(message);
    this.name = "DownloadError";
  }
}