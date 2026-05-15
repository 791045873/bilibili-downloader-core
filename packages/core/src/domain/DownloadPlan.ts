/**
 * 下载执行计划 - 由 UseCase 在解析阶段生成
 */
export interface DownloadPlan {
  /** 资源 ID (bvid) */
  bvid: string;

  /** 分 P ID (cid) */
  cid: number;

  /** 视频标题 */
  title: string;

  /** 选择的视频流信息 */
  videoStream: MediaStreamInfo;

  /** 选择的音频流信息 */
  audioStream: MediaStreamInfo;

  /** 输出文件名 */
  outputFileName: string;
}

/** 媒体流信息 */
export interface MediaStreamInfo {
  /** 流 URL */
  url: string;

  /** 编码类型 (avc/hevc/av1/aac/mp4a) */
  codec: string;

  /** 清晰度标识 */
  quality: number;

  /** 文件格式 (mp4/m4s/flv/m4a) */
  format: string;
}