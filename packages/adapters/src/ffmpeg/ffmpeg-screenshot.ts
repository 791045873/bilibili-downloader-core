/**
 * ffmpeg 截屏工具
 *
 * 对指定时间点截取视频帧为 JPEG 图片
 */

import { spawn } from "node:child_process";

export interface ScreenshotParams {
  /** 视频文件路径 */
  videoPath: string;
  /** 截图时间点列表（秒） */
  timePoints: number[];
  /** 截图输出目录 */
  outputDir: string;
  /** 文件名前缀 */
  filenamePrefix?: string;
}

export interface ScreenshotResult {
  /** 成功生成的文件路径列表（按截图成功顺序） */
  outputFiles: string[];
}

export class FfmpegScreenshot {
  private ffmpegPath: string;
  private ffprobePath: string;
  private readonly durationCache = new Map<string, number>();

  constructor(ffmpegPath = "ffmpeg", ffprobePath = "ffprobe") {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.ffmpegPath, ["-version"], {
        stdio: "ignore",
      });
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  /**
   * 在指定时间点截取视频帧
   */
  async takeScreenshots(params: ScreenshotParams): Promise<ScreenshotResult> {
    const { videoPath, timePoints, outputDir, filenamePrefix = "frame" } = params;

    if (timePoints.length === 0) {
      return { outputFiles: [] };
    }

    const videoDuration = await this.getVideoDuration(videoPath);
    const outputFiles: string[] = [];

    for (let i = 0; i < timePoints.length; i++) {
      const time = timePoints[i];
      const outputPath = `${outputDir}/${filenamePrefix}-frame-${i}.jpg`;
      const success = await this.screenshotFrame(videoPath, time, outputPath, videoDuration);

      if (success) {
        outputFiles.push(outputPath);
      }
    }

    return { outputFiles };
  }

  /**
   * 截取单帧
   */
  private screenshotFrame(
    videoPath: string,
    time: number,
    outputPath: string,
    videoDuration: number,
  ): Promise<boolean> {
    if (time > videoDuration) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      const args = [
        "-ss", String(time),
        "-i", videoPath,
        "-vframes", "1",
        "-q:v", "3",
        "-y",
        outputPath,
      ];

      const proc = spawn(this.ffmpegPath, args, {
        stdio: ["ignore", "ignore", "ignore"],
      });

      proc.on("close", (code) => {
        resolve(code === 0);
      });

      proc.on("error", () => {
        resolve(false);
      });
    });
  }

  private async getVideoDuration(videoPath: string): Promise<number> {
    const cached = this.durationCache.get(videoPath);
    if (cached !== undefined) return cached;

    const duration = await this.probeVideoDuration(videoPath);
    this.durationCache.set(videoPath, duration);
    return duration;
  }

  private probeVideoDuration(videoPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const args = [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        videoPath,
      ];

      let stdout = "";
      let stderr = "";
      const proc = spawn(this.ffprobePath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        const duration = Number.parseFloat(stdout.trim());
        if (code === 0 && Number.isFinite(duration) && duration >= 0) {
          resolve(duration);
          return;
        }

        reject(
          new Error(
            `ffprobe 获取视频时长失败 (exit ${code}): ${stderr.slice(-300)}`,
          ),
        );
      });

      proc.on("error", (err) => {
        reject(
          new Error(
            `无法启动 ffprobe: ${err.message}。请确认 ffprobe 已安装并在 PATH 中`,
          ),
        );
      });
    });
  }
}
