/**
 * 下载请求 - 来自 Server/Docker 等运行时的统一输入
 */
export interface DownloadRequest {
  /** 输入资源标识: BV/AV/URL */
  input: string;

  /** 下载指定分 P (1-based)，不指定则下载第 1P */
  page?: number;

  /** 字幕语言选择: "none"-不下载 "all"-全部 string[]-指定语言 (如 ["zh-CN","en-US"]) */
  subtitleLanguages?: "none" | "all" | string[];

  /** 是否跳过已存在的输出文件，默认 true */
  skipExisting?: boolean;

  /** 文件名模板 */
  fileNameTemplate?: string;

  /** 输出目录路径 */
  outputDir: string;

  /** 视频编码偏好 (avc/hevc/av1)，可选 */
  videoCodec?: string;

  /** 清晰度 (qn 值: 16=360P, 32=480P, 64=720P, 80=1080P, 116=1080P60, 120=4K)，可选 */
  quality?: number;

  /** 音频质量偏好，可选 */
  audioQuality?: number;

  /** Cookie 文件路径，用于携带登录态请求，可选 */
  cookieFile?: string;

  /** 失败时是否保留临时文件 */
  keepTempOnFailure?: boolean;
}