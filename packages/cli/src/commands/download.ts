/**
 * download 命令 - 下载 B 站视频 (自动识别单视频/合集)
 */

import { Command } from "commander";
import {
  DownloadSingleVideoUseCase,
  DownloadFavoritesUseCase,
} from "@bilibili-downloader/core/usecases";
import type { DownloadRequest } from "@bilibili-downloader/core/domain";
import { DownloadEventType } from "@bilibili-downloader/core/events";
import { ResourceType } from "@bilibili-downloader/core/ports";
import {
  createBilibiliApiAdapter,
  BilibiliFavoritesProvider,
} from "@bilibili-downloader/adapters/bilibili";
import { BilibiliAuthProvider } from "@bilibili-downloader/adapters/bilibili-auth";
import { HttpDownloader } from "@bilibili-downloader/adapters/downloader";
import { FfmpegMerger } from "@bilibili-downloader/adapters/ffmpeg";
import { NodeFileStore } from "@bilibili-downloader/adapters/fs";
import { TaskStatus } from "@bilibili-downloader/core/domain";

export function createDownloadCommand(): Command {
  return new Command("download")
    .alias("dl")
    .description("下载 B 站视频 (支持单视频/合集)")
    .argument("<input>", "BV/AV/URL/合集ID(ml开头)")
    .option("-o, --output <dir>", "输出目录", "./downloads")
    .option(
      "-q, --quality <qn>",
      "清晰度 (16=360P, 32=480P, 64=720P, 80=1080P, 120=4K)",
      "80",
    )
    .option("-c, --codec <codec>", "视频编码偏好 (avc/hevc/av1)")
    .option("--cookie-file <path>", "Cookie 文件路径")
    .option("--keep-temp", "失败时保留临时文件", false)
    .action(async (input: string, options) => {
      const quality = Number.parseInt(options.quality, 10);

      const baseRequest: DownloadRequest = {
        input,
        outputDir: options.output,
        quality,
        videoCodec: options.codec,
        cookieFile: options.cookieFile,
        keepTempOnFailure: options.keepTemp,
      };

      // 加载 Cookie
      const authProvider = new BilibiliAuthProvider();
      let cookieString: string | undefined;
      if (options.cookieFile) {
        try {
          const cookies = await authProvider.loadCookies(options.cookieFile);
          cookieString = authProvider.toCookieString(cookies);
          console.log(`已加载 ${cookies.length} 个 Cookie`);
        } catch (err) {
          console.error(`警告: 无法加载 Cookie: ${(err as Error).message}`);
        }
      }

      // 组装适配器
      const api = createBilibiliApiAdapter(cookieString);
      const downloader = new HttpDownloader();
      const merger = new FfmpegMerger();
      const fileStore = new NodeFileStore();

      if (!(await merger.isAvailable())) {
        console.error("错误: ffmpeg 未安装。请安装: https://ffmpeg.org/");
        process.exit(1);
      }

      const commonDeps = {
        resourceParser: api.resourceParser,
        streamProvider: api.streamProvider,
        mediaDownloader: downloader,
        mediaMerger: merger,
        fileStore,
        authProvider,
      };

      // 先解析输入，判断是单视频还是合集
      const parseResult = await api.resourceParser.parse(input);

      if (parseResult.type === ResourceType.Favorites && parseResult.mediaId) {
        // === 合集批量下载 ===
        const batchUseCase = new DownloadFavoritesUseCase({
          ...commonDeps,
          favoritesProvider: new BilibiliFavoritesProvider(api.webClient),
        });

        // 监听进度事件 (来自内部 DownloadSingleVideoUseCase)
        batchUseCase.on(DownloadEventType.DownloadProgress, (event: any) => {
          const pct = String(event.percentage).padStart(3);
          process.stdout.write(
            `\r  进度: ${pct}% | ${formatBytes(event.downloadedBytes)} / ${formatBytes(event.totalBytes)} | ${formatSpeed(event.speedBytesPerSec)}    `,
          );
        });

        process.on("SIGINT", () => {
          console.log("\n  正在取消...");
          batchUseCase.cancel();
        });

        await batchUseCase.execute(parseResult.mediaId, baseRequest, cookieString);
      } else {
        // === 单视频下载 ===
        const useCase = new DownloadSingleVideoUseCase(commonDeps);

        useCase.on(DownloadEventType.TaskStarted, () => {
          console.log(`\n开始下载: ${input}`);
          if (cookieString) console.log("  使用登录 Cookie");
        });

        useCase.on(DownloadEventType.TaskResolved, (event) => {
          console.log(`  标题: ${event.plan.title}`);
        });

        useCase.on(DownloadEventType.StreamSelected, (event) => {
          console.log(`  视频流: ${event.videoCodec}`);
          console.log(`  音频流: ${event.audioCodec}`);
        });

        useCase.on(DownloadEventType.DownloadProgress, (event) => {
          const pct = String(event.percentage).padStart(3);
          process.stdout.write(
            `\r  进度: ${pct}% | ${formatBytes(event.downloadedBytes)} / ${formatBytes(event.totalBytes)} | ${formatSpeed(event.speedBytesPerSec)}    `,
          );
        });

        useCase.on(DownloadEventType.MergeProgress, () => {
          console.log("\n  合并音视频...");
        });

        useCase.on(DownloadEventType.TaskCompleted, (event) => {
          console.log(`\n\n下载完成!`);
          console.log(`  文件: ${event.result.outputFile}`);
          console.log(`  大小: ${formatBytes(event.result.fileSize ?? 0)}`);
          console.log(`  耗时: ${formatTime(event.result.timing?.totalMs ?? 0)}`);
        });

        useCase.on(DownloadEventType.TaskFailed, (event) => {
          console.error(
            `\n\n下载失败: [${event.result.errorCode}] ${event.result.errorMessage}`,
          );
        });

        process.on("SIGINT", () => {
          console.log("\n  正在取消...");
          useCase.cancel();
        });

        const result = await useCase.execute(baseRequest);
        if (result.status === TaskStatus.Failed) {
          process.exit(1);
        }
      }
    });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) return `${minutes}分${secs}秒`;
  return `${secs}秒`;
}