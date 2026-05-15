/**
 * Bilibili 下载器 Web 服务器
 */

import express from "express";
import { createBilibiliWebClient } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliResourceParser } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliStreamProvider } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliFavoritesProvider } from "@bilibili-downloader/adapters/bilibili";
import { BilibiliAuthProvider } from "@bilibili-downloader/adapters/bilibili-auth";
import { HttpDownloader } from "@bilibili-downloader/adapters/downloader";
import { FfmpegMerger } from "@bilibili-downloader/adapters/ffmpeg";
import { NodeFileStore } from "@bilibili-downloader/adapters/fs";
import { TaskStore } from "@bilibili-downloader/adapters/task-store";
import { DownloadSingleVideoUseCase } from "@bilibili-downloader/core/usecases";
import { DownloadFavoritesUseCase } from "@bilibili-downloader/core/usecases";
import { ResourceType } from "@bilibili-downloader/core/ports";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import { DownloadEventType } from "@bilibili-downloader/core/events";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import HTML_PAGE from "./index.html";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? join(homedir(), "bilibili-downloads");
const COOKIE_FILE = process.env.COOKIE_FILE ?? "";
const TASK_STORE_PATH = join(OUTPUT_DIR, ".tasks.json");

interface TaskEntry {
  id: string;
  input: string;
  status: string;
  title?: string;
  outputFile?: string;
  fileSize?: number;
  error?: string;
  progress?: number;
  speed?: string;
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
}

const tasks = new Map<string, TaskEntry>();
const taskStore = new TaskStore(TASK_STORE_PATH);

async function main() {
  const cookieString = COOKIE_FILE ? await loadCookieString(COOKIE_FILE) : undefined;
  const webClient = createBilibiliWebClient({ cookieString });
  const fileStore = new NodeFileStore();
  const merger = new FfmpegMerger();

  await fileStore.ensureOutputDir(OUTPUT_DIR);

  if (!(await merger.isAvailable())) {
    console.error("⚠ ffmpeg 未安装，下载后无法合并!");
  }

  const commonDeps = {
    resourceParser: new BilibiliResourceParser(webClient),
    streamProvider: new BilibiliStreamProvider(webClient),
    mediaDownloader: new HttpDownloader(),
    mediaMerger: merger,
    fileStore,
    authProvider: new BilibiliAuthProvider(),
  };

  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => res.type("html").send(HTML_PAGE));

  app.post("/api/download", async (req, res) => {
    const { input, quality, codec } = req.body;
    if (!input) return res.status(400).json({ error: "缺少 input 参数" });

    const id = randomUUID();
    const task: TaskEntry = {
      id, input, status: "created",
      createdAt: new Date().toISOString(),
    };
    tasks.set(id, task);
    res.json({ id, message: "任务已创建" });

    executeDownload(id, input, quality, codec, commonDeps, webClient).catch(console.error);
  });

  app.get("/api/tasks", (_req, res) => {
    const list = Array.from(tasks.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    res.json(list);
  });

  app.post("/api/tasks/clear", async (_req, res) => {
    tasks.clear();
    await taskStore.clear();
    res.json({ message: "已清空" });
  });

  app.listen(PORT, () => {
    console.log(`\n🚀 Bilibili 下载器已启动`);
    console.log(`   Web 界面: http://localhost:${PORT}`);
    console.log(`   输出目录: ${OUTPUT_DIR}\n`);
  });
}

async function executeDownload(
  id: string, input: string, quality: number | undefined,
  codec: string | undefined, deps: any, webClient: any,
) {
  const task = tasks.get(id)!;
  task.status = "parsing";
  try {
    const parseResult = await deps.resourceParser.parse(input);
    if (parseResult.type === ResourceType.Favorites && parseResult.mediaId) {
      const favsUseCase = new DownloadFavoritesUseCase({
        ...deps,
        favoritesProvider: new BilibiliFavoritesProvider(webClient),
      });
      await favsUseCase.execute(parseResult.mediaId, {
        input, outputDir: OUTPUT_DIR, quality, videoCodec: codec,
        cookieFile: COOKIE_FILE, skipExisting: true,
      });
      task.status = "completed";
    } else {
      const useCase = new DownloadSingleVideoUseCase(deps);
      useCase.on(DownloadEventType.TaskResolved, (e) => { task.title = e.plan.title; });
      useCase.on(DownloadEventType.DownloadProgress, (e) => {
        task.progress = e.percentage;
        task.speed = formatBytes(e.speedBytesPerSec) + "/s";
      });
      const result = await useCase.execute({
        input, outputDir: OUTPUT_DIR, quality, videoCodec: codec,
        cookieFile: COOKIE_FILE, skipExisting: true,
      });
      task.status = result.status;
      task.outputFile = result.outputFile;
      task.fileSize = result.fileSize;
      task.error = result.errorMessage;
      task.durationMs = result.timing?.totalMs;
    }
    task.completedAt = new Date().toISOString();
  } catch (err) {
    task.status = "failed";
    task.error = (err as Error).message;
  }
  await taskStore.save({
    id, request: { input, outputDir: OUTPUT_DIR, quality, videoCodec: codec },
    status: task.status as TaskStatus,
    outputFile: task.outputFile,
    errorMessage: task.error,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    durationMs: task.durationMs,
  });
}

async function loadCookieString(file: string): Promise<string | undefined> {
  try {
    const auth = new BilibiliAuthProvider();
    const cookies = await auth.loadCookies(file);
    return auth.toCookieString(cookies);
  } catch { return undefined; }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

main().catch((err) => { console.error("启动失败:", err); process.exit(1); });