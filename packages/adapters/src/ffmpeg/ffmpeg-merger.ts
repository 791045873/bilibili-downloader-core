/**
 * ffmpeg 音视频合并器
 *
 * 参考: downkyicore/DownKyi.Core/FFMpeg/FFMpeg.cs
 */

import { spawn } from "node:child_process";
import type { MediaMergerPort } from "@bilibili-downloader/core/ports";
import { MergeError } from "@bilibili-downloader/core/ports";
import { summarizePath, summarizeText } from "../safe-error-context.js";

export class FfmpegMerger implements MediaMergerPort {
  private ffmpegPath: string;

  constructor(ffmpegPath = "ffmpeg") {
    this.ffmpegPath = ffmpegPath;
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

  async merge(
    videoFile: string,
    audioFile: string,
    outputFile: string,
  ): Promise<string> {
    const safeVideoFile = summarizePath(videoFile);
    const safeAudioFile = summarizePath(audioFile);
    const safeOutputFile = summarizePath(outputFile);

    return new Promise((resolve, reject) => {
      const args = [
        "-i",
        videoFile,
        "-i",
        audioFile,
        "-c",
        "copy", // 不重新编码，直接封装
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-y", // 覆盖已存在文件
        outputFile,
      ];

      let stderr = "";

      const proc = spawn(this.ffmpegPath, args, {
        stdio: ["ignore", "ignore", "pipe"],
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(outputFile);
        } else {
          reject(
            new MergeError(
              `ffmpeg 合并失败 (exit code ${code}, output=${safeOutputFile}): ${summarizeText(stderr.slice(-500))}`,
              safeVideoFile,
              safeAudioFile,
            ),
          );
        }
      });

      proc.on("error", (err) => {
        reject(
          new MergeError(
            `无法启动 ffmpeg (output=${safeOutputFile}): ${summarizeText(err.message)}。请确认 ffmpeg 已安装并在 PATH 中`,
            safeVideoFile,
            safeAudioFile,
          ),
        );
      });
    });
  }
}
