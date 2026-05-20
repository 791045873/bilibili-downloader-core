/**
 * download 命令 - 下载 B 站视频 (自动识别单视频/合集)
 */

import { Command } from "commander";
import { ResolutionService, DownloadExecutionUseCase } from "@bilibili-downloader/core/usecases";
import type { DownloadResult } from "@bilibili-downloader/core/domain";
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

      const log = options.logFile
        ? new Logger({ filePath: options.logFile })
        : undefined;
      const taskStore = new TaskStore(options.taskStore);

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

      const api = createBilibiliApiAdapter(cookieString);
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

      const resolutionService = new ResolutionService(
        api.resourceParser,
        api.streamProvider,
        authProvider,
      );

      const executionDeps = {
        mediaDownloader: downloader,
        mediaMerger: merger,
        fileStore,
        subtitleProvider: new BilibiliSubtitleProvider(api.webClient),
      };

      // 先解析输入，判断是单视频还是合集
      const parseResult = await api.resourceParser.parse(input);

      if (parseResult.type === ResourceType.Favorites && parseResult.mediaId) {
        // === 合集批量下载 ===
        const favoritesProvider = new BilibiliFavoritesProvider(api.webClient);
        const info = await favoritesProvider.getFavoritesInfo(
          parseResult.mediaId,
          cookieString,
        );
        console.log(`\n合集: ${info.title}`);
        console.log(`共 ${info.mediaCount} 个视频\n`);

        const allVideos: { bvid: string; title: string }[] = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
          const result = await favoritesProvider.getFavoritesVideos(
            parseResult.mediaId,
            page,
            20,
            cookieString,
          );
          allVideos.push(...result.videos.map((v) => ({ bvid: v.bvid, title: v.title })));
          hasMore = result.hasMore;
          page++;
        }
        console.log(`已获取 ${allVideos.length} 个视频\n`);

        let completed = 0;
        let failed = 0;
        for (let i = 0; i < allVideos.length; i++) {
          const video = allVideos[i];
          const idx = i + 1;
          console.log(`[${idx}/${allVideos.length}] ${video.title}`);

          const result = await downloadVideo(
            resolutionService,
            executionDeps,
            video.bvid,
            options.output,
            { quality, codec: options.codec, cookieString },
          );

          if (result.status === TaskStatus.Success) {
            completed++;
            console.log(`  ✅ 完成`);
          } else {
            failed++;
            console.log(`  ❌ [${result.errorCode}] ${result.errorMessage}`);
          }
        }
        console.log(
          `\n合集下载完成: ${completed} 成功 / ${failed} 失败 / ${allVideos.length} 总计`,
        );
      } else {
        // === 单视频下载 ===
        if (options.allPages) {
          const resolved = await resolutionService.resolve(input, { cookieFile: options.cookieFile });
          const totalPages = resolved.pages.length;
          console.log(`\n多 P 视频: 共 ${totalPages} 个分 P`);

          let completed = 0;
          for (let i = 0; i < totalPages; i++) {
            const pageNum = i + 1;
            const pageResolved = await resolutionService.resolve(input, {
              page: pageNum,
              cookieFile: options.cookieFile,
            });
            console.log(`\n[${pageNum}/${totalPages}] ${pageResolved.title}`);

            const result = await downloadVideo(
              resolutionService,
              executionDeps,
              input,
              options.output,
              { page: pageNum, quality, codec: options.codec, cookieString },
            );
            if (result.status === TaskStatus.Success) completed++;
          }
          console.log(`\n全部分 P 下载完成: ${completed}/${totalPages} 成功`);
        } else {
          const result = await downloadVideo(
            resolutionService,
            executionDeps,
            input,
            options.output,
            {
              page: options.page,
              quality,
              codec: options.codec,
              cookieString,
            },
          );

          if (result.status === TaskStatus.Failed) process.exit(1);

          await saveTaskRecord(taskStore, { result, startTime }, log);
        }
      }
    });
}

// ==================== 下载辅助函数 ====================

async function downloadVideo(
  resolutionService: ResolutionService,
  executionDeps: any,
  input: string,
  outputDir: string,
  opts: {
    page?: number;
    quality?: number;
    codec?: string;
    cookieString?: string;
  },
): Promise<DownloadResult> {
  const resolved = await resolutionService.resolve(input, { page: opts.page });

  const streams = await resolutionService.resolveStreams({
    bvid: resolved.bvid,
    cid: resolved.cid,
    resourceType: resolved.resourceType,
    cookieString: opts.cookieString,
  });

  const videoStream = resolutionService.selectBestStream(
    streams.videoStreams,
    opts.codec,
    opts.quality,
  );
  const audioStream = resolutionService.selectBestStream(streams.audioStreams);

  if (!videoStream || !audioStream) {
    throw new Error("无法选择合适的视频或音频流");
  }

  console.log(`  视频流: ${videoStream.codec} qn=${videoStream.quality}`);
  console.log(`  音频流: ${audioStream.codec} qn=${audioStream.quality}`);

  const fileName = `${sanitizeFileName(resolved.title)}.mp4`;
  const outputFile = join(outputDir, fileName);

  const executionUseCase = new DownloadExecutionUseCase(executionDeps);

  executionUseCase.on(DownloadEventType.DownloadProgress, (e: any) => {
    const pct = String(e.percentage).padStart(3);
    process.stdout.write(
      `\r  进度: ${pct}%  `,
    );
  });
  executionUseCase.on(DownloadEventType.MergeProgress, () => {
    console.log("\n  合并音视频...");
  });

  const result = await executionUseCase.execute({
    bvid: resolved.bvid,
    cid: resolved.cid,
    title: resolved.title,
    outputFile,
    videoStream,
    audioStream,
    cookieString: opts.cookieString,
  });

  if (result.status === TaskStatus.Success) {
    console.log(`\n  ✅ 完成: ${formatBytes(result.fileSize ?? 0)} (${formatTime(result.timing?.totalMs ?? 0)})`);
  } else {
    console.log(`\n  ❌ 失败: [${result.errorCode}] ${result.errorMessage}`);
  }

  return result;
}

// ==================== 工具函数 ====================

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_");
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

async function saveTaskRecord(
  store: TaskStore,
  info: { result: DownloadResult; startTime: number },
  log?: Logger,
): Promise<void> {
  try {
    await store.save({
      id: randomUUID(),
      request: { input: "", outputDir: "" },
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