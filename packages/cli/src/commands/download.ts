/**
 * download 命令 - 下载 B 站视频 (自动识别单视频/合集)
 */

import { Command } from "commander";
import {
  DownloadSingleVideoUseCase,
  DownloadFavoritesUseCase,
} from "@bilibili-downloader/core/usecases";
import type { DownloadRequest, DownloadResult } from "@bilibili-downloader/core/domain";
import { DownloadEventType } from "@bilibili-downloader/core/events";
import { ResourceType } from "@bilibili-downloader/core/ports";
import {
  createBilibiliApiAdapter,
  BilibiliFavoritesProvider,
  BilibiliSubtitleProvider,
} from "@bilibili-downloader/adapters/bilibili";
import { BilibiliAuthProvider } from "@bilibili-downloader/adapters/bilibili-auth";
import { HttpDownloader } from "@bilibili-downloader/adapters/downloader";
import { Aria2Downloader } from "@bilibili-downloader/adapters/downloader";
import { FfmpegMerger } from "@bilibili-downloader/adapters/ffmpeg";
import { NodeFileStore } from "@bilibili-downloader/adapters/fs";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import { Logger } from "@bilibili-downloader/adapters/logger";
import { TaskStore } from "@bilibili-downloader/adapters/task-store";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

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
    .option("-p, --page <n>", "下载指定分 P (1-based)", parseInt)
    .option("--all-pages", "下载所有分 P", false)
    .option("--downloader <type>", "下载器 (http/aria2)", "http")
    .option("--subtitle", "下载字幕 (.srt)", false)
    .option("--no-skip", "不跳过已存在的文件 (强制重新下载)", false)
    .option("--log-file <path>", "日志文件路径")
    .option("--task-store <path>", "任务记录文件", join(homedir(), ".bilibili-downloader", "tasks.json"))
    .action(async (input: string, options) => {
      const startTime = Date.now();
      const quality = Number.parseInt(options.quality, 10);

      // 初始化日志
      const log = options.logFile
        ? new Logger({ filePath: options.logFile })
        : undefined;
      const taskStore = new TaskStore(options.taskStore);

      const baseRequest: DownloadRequest = {
        input,
        outputDir: options.output,
        quality,
        videoCodec: options.codec,
        cookieFile: options.cookieFile,
        keepTempOnFailure: options.keepTemp,
        downloadSubtitle: options.subtitle,
        skipExisting: !options.noSkip,
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
      // 选择下载器
      const downloader =
        options.downloader === "aria2"
          ? new Aria2Downloader()
          : new HttpDownloader();
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
        subtitleProvider: new BilibiliSubtitleProvider(api.webClient),
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
        // === 单视频下载 (支持分 P) ===
        // 创建事件监听工厂
        const createListeners = (useCase: DownloadSingleVideoUseCase, label: string) => {
          useCase.on(DownloadEventType.TaskStarted, () => {
            console.log(`\n${label}`);
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
            console.log(`\n  ✅ 完成: ${formatBytes(event.result.fileSize ?? 0)} (${formatTime(event.result.timing?.totalMs ?? 0)})`);
          });
          useCase.on(DownloadEventType.TaskFailed, (event) => {
            console.log(`\n  ❌ 失败: [${event.result.errorCode}] ${event.result.errorMessage}`);
          });
        };

        if (options.allPages) {
          // 下载所有分 P: 先获取页数，再逐一下载
          const videoInfo = await api.streamProvider.getVideoInfo(parseResult.bvid);
          const totalPages = videoInfo.pages.length;
          console.log(`\n多 P 视频: 共 ${totalPages} 个分 P`);

          let completed = 0;
          for (let i = 0; i < totalPages; i++) {
            const pageNum = i + 1;
            const pageName = videoInfo.pages[i].title;
            const label = `[${pageNum}/${totalPages}] ${pageName}`;

            const pageUseCase = new DownloadSingleVideoUseCase(commonDeps);
            createListeners(pageUseCase, label);

            const result = await pageUseCase.execute({
              ...baseRequest,
              page: pageNum,
            });
            if (result.status === TaskStatus.Completed) completed++;
          }
          console.log(`\n全部分 P 下载完成: ${completed}/${totalPages} 成功`);
        } else {
          // 单分 P 下载 (默认 P1，或用 --page 指定)
          const useCase = new DownloadSingleVideoUseCase(commonDeps);
          createListeners(useCase, `开始下载: ${input}`);

          process.on("SIGINT", () => {
            console.log("\n  正在取消...");
            useCase.cancel();
          });

          const request = options.page
            ? { ...baseRequest, page: options.page }
            : baseRequest;

          const result = await useCase.execute(request);
          if (result.status === TaskStatus.Failed) process.exit(1);

          await saveTaskRecord(taskStore, {
            request: request,
            result,
            startTime,
          }, log);
        }
      }
    });
}

async function saveTaskRecord(
  store: TaskStore,
  info: { request: DownloadRequest; result: DownloadResult; startTime: number },
  log?: Logger,
): Promise<void> {
  try {
    await store.save({
      id: randomUUID(),
      request: info.request,
      status: info.result.status,
      outputFile: info.result.outputFile,
      errorMessage: info.result.errorMessage,
      createdAt: new Date(info.startTime).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: info.result.timing?.totalMs,
    });
  } catch (err) {
    log?.error("保存任务记录失败:", (err as Error).message);
  }
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