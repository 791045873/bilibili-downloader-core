/**
 * ffmpeg 截屏工具
 *
 * 对指定时间点截取视频帧为 JPEG 图片
 */

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { logger } from "../logger.js";
import {
  summarizePath,
  summarizeText,
  summarizeUrl,
} from "../safe-error-context.js";

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
    const {
      videoPath,
      timePoints,
      outputDir,
      filenamePrefix = "frame",
      headers,
    } = params;

    if (timePoints.length === 0) {
      return { outputFiles: [] };
    }

    const isRemote = this.isRemoteUrl(videoPath);
    let videoDuration: number;
    if (isRemote) {
      try {
        videoDuration = await this.getVideoDuration(videoPath, headers);
      } catch (err) {
        logger.warn(
          `远端视频时长探测失败，改用无限时长兜底: source=${summarizeUrl(videoPath)}, reason=${summarizeText((err as Error).message)}`,
        );
        videoDuration = Infinity;
      }
    } else {
      videoDuration = await this.getVideoDuration(videoPath);
    }

    const outputFiles: string[] = [];
    let failedCount = 0;
    let lastFailureReason: string | undefined;

    for (let i = 0; i < timePoints.length; i++) {
      const time = timePoints[i];
      const outputPath = `${outputDir}/${filenamePrefix}-frame-${i}.jpg`;
      const result = await this.screenshotFrame(
        videoPath,
        time,
        outputPath,
        videoDuration,
        isRemote,
        headers,
      );

      if (result.success) {
        outputFiles.push(outputPath);
      } else if (result.reason) {
        failedCount += 1;
        lastFailureReason = result.reason;
      }
    }

    if (failedCount > 0) {
      const source = isRemote
        ? summarizeUrl(videoPath)
        : summarizePath(videoPath);
      logger.warn(
        `截图阶段存在失败帧，已继续处理其余时间点: source=${source}, failed=${failedCount}/${timePoints.length}, lastReason=${summarizeText(lastFailureReason ?? "unknown")}`,
      );
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
  ): Promise<{ success: boolean; reason?: string }> {
    if (time > videoDuration) {
      return Promise.resolve({
        success: false,
        reason: `time ${time} exceeds duration ${videoDuration}`,
      });
    }

    return new Promise((resolve) => {
      const args: string[] = ["-ss", String(time)];

      const headersStr = isRemote ? this.buildHeadersArg(headers) : null;
      if (headersStr) {
        args.push("-headers", headersStr);
      }

      args.push(
        "-i",
        videoPath,
        "-vframes",
        "1",
        "-q:v",
        "3",
        "-y",
        outputPath,
      );

      const proc = spawn(this.ffmpegPath, args, {
        stdio: ["ignore", "ignore", "ignore"],
      });

      proc.on("close", async (code) => {
        if (code !== 0) {
          resolve({
            success: false,
            reason: `ffmpeg exited with code ${code}`,
          });
          return;
        }

        try {
          const outputStat = await stat(outputPath);
          resolve({
            success: outputStat.isFile() && outputStat.size > 0,
            reason:
              outputStat.isFile() && outputStat.size > 0
                ? undefined
                : `empty screenshot output ${summarizePath(outputPath)}`,
          });
        } catch (err) {
          resolve({
            success: false,
            reason: `screenshot output unreadable ${summarizePath(outputPath)}: ${summarizeText((err as Error).message)}`,
          });
        }
      });

      proc.on("error", (err) => {
        resolve({
          success: false,
          reason: `ffmpeg spawn failed: ${summarizeText(err.message)}`,
        });
      });
    });
  }

  async getVideoDuration(
    videoPath: string,
    headers?: Record<string, string>,
  ): Promise<number> {
    const cached = this.durationCache.get(videoPath);
    if (cached !== undefined) return cached;

    const duration = await this.probeVideoDuration(videoPath, headers);
    this.durationCache.set(videoPath, duration);
    return duration;
  }

  private probeVideoDuration(
    videoPath: string,
    headers?: Record<string, string>,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const args: string[] = [];

      const headersStr = this.buildHeadersArg(headers);
      if (headersStr) {
        args.push("-headers", headersStr);
      }

      args.push(
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
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
            `ffprobe 获取视频时长失败 (source=${this.isRemoteUrl(videoPath) ? summarizeUrl(videoPath) : summarizePath(videoPath)}, exit ${code}): ${summarizeText(stderr.slice(-300))}`,
          ),
        );
      });

      proc.on("error", (err) => {
        reject(
          new Error(
            `无法启动 ffprobe: ${summarizeText(err.message)}。请确认 ffprobe 已安装并在 PATH 中`,
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
