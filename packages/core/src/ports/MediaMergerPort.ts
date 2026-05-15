/**
 * 媒体合并端口 - 音视频合并与格式转换
 */
export interface MediaMergerPort {
  /**
   * 合并音频和视频文件
   * @param videoFile 视频文件路径
   * @param audioFile 音频文件路径
   * @param outputFile 输出文件路径 (.mp4)
   * @returns 合并后的文件路径
   */
  merge(videoFile: string, audioFile: string, outputFile: string): Promise<string>;

  /**
   * 检查 ffmpeg 是否可用
   */
  isAvailable(): Promise<boolean>;
}

export class MergeError extends Error {
  constructor(
    message: string,
    public readonly videoFile: string,
    public readonly audioFile: string,
  ) {
    super(message);
    this.name = "MergeError";
  }
}