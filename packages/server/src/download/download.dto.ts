import type { MediaStreamInfo } from "@bilibili-downloader/core/domain";

/** 下载请求 */
export class DownloadDto {
  bvid!: string;
  cid!: number;
  title!: string;
  quality?: number;
  codec?: string;
  /** 下载文件存放的子路径，用于构建下载路径 */
  outputPath?: string;
}

/** 独立单视频下载请求（流已选好） */
export class SingleDownloadDto {
  bvid!: string;
  cid!: number;
  title!: string;
  videoStream!: MediaStreamInfo;
  audioStream!: MediaStreamInfo;
  quality?: number;
  codec?: string;
  downloadSubtitle?: boolean;
}