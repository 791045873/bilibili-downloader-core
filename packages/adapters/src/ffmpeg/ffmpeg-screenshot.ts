/**
 * ffmpeg 截屏工具
 *
 * 对指定时间点截取视频帧为 JPEG 图片
 */

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

export interface ScreenshotParams {
  /** 视频源，可以是本地文件路径或 HTTP URL */
  videoPath: string;
  /** 截图时间点列表（秒） */
  timePoints: number[];
  /** 截图输出目录 */
  outputDir: string;
  /** 文件名前缀 */
  filenamePrefix?: string;
  /** 自定义 HTTP headers，用于远端流请求（如 Referer）；本地路径时忽略 */
  headers?: Record<string, string>;
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
    const { videoPath, timePoints, outputDir, filenamePrefix = "frame", headers } = params;

    if (timePoints.length === 0) {
      return { outputFiles: [] };
    }

    const isRemote = this.isRemoteUrl(videoPath);
    let videoDuration: number;
    if (isRemote) {
      try {
        videoDuration = await this.getVideoDuration(videoPath, headers);
      } catch {
        videoDuration = Infinity;
      }
    } else {
      videoDuration = await this.getVideoDuration(videoPath);
    }

    const outputFiles: string[] = [];

    for (let i = 0; i < timePoints.length; i++) {
      const time = timePoints[i];
      const outputPath = `${outputDir}/${filenamePrefix}-frame-${i}.jpg`;
      const success = await this.screenshotFrame(videoPath, time, outputPath, videoDuration, isRemote, headers);

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
    isRemote: boolean,
    headers?: Record<string, string>,
  ): Promise<boolean> {
    if (time > videoDuration) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      const args: string[] = [
        "-ss", String(time),
      ];

      const headersStr = isRemote ? this.buildHeadersArg(headers) : null;
      if (headersStr) {
        args.push("-headers", headersStr);
      }

      args.push(
        "-i", videoPath,
        "-vframes", "1",
        "-q:v", "3",
        "-y",
        outputPath,
      );

      const proc = spawn(this.ffmpegPath, args, {
        stdio: ["ignore", "ignore", "ignore"],
      });

      proc.on("close", async (code) => {
        if (code !== 0) {
          resolve(false);
          return;
        }

        try {
          const outputStat = await stat(outputPath);
          resolve(outputStat.isFile() && outputStat.size > 0);
        } catch {
          resolve(false);
        }
      });

      proc.on("error", () => {
        resolve(false);
      });
    });
  }

  private async getVideoDuration(videoPath: string, headers?: Record<string, string>): Promise<number> {
    const cached = this.durationCache.get(videoPath);
    if (cached !== undefined) return cached;

    const duration = await this.probeVideoDuration(videoPath, headers);
    this.durationCache.set(videoPath, duration);
    return duration;
  }

  private probeVideoDuration(videoPath: string, headers?: Record<string, string>): Promise<number> {
    return new Promise((resolve, reject) => {
      const args: string[] = [];

      const headersStr = this.buildHeadersArg(headers);
      if (headersStr) {
        args.push("-headers", headersStr);
      }

      args.push(
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        videoPath,
      );

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

  private isRemoteUrl(path: string): boolean {
    return path.startsWith("http://") || path.startsWith("https://");
  }

  private buildHeadersArg(headers?: Record<string, string>): string | null {
    if (!headers || Object.keys(headers).length === 0) return null;
    return (
      Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n") + "\r\n"
    );
  }
}
