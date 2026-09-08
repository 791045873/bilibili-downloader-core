import { Injectable, Logger } from "@nestjs/common";
import { access, readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import { FfmpegMerger, FfmpegScreenshot } from "@bilibili-downloader/adapters/ffmpeg";
import {
  DatabaseService,
  type AiSummaryTaskRecord,
  type TaskRecord,
} from "../database/database.service.js";
import { PathsService } from "../paths/paths.service.js";
import { DownloadScheduler } from "../download/download-scheduler.js";
import { sanitizeFileName } from "../download/file-naming.js";
import { createLogMessage } from "../logging/server-log.util.js";
import { AnalysisEngine } from "./analysis-engine.js";
import { listLocalImageRefs, resolveSummaryOutputPath } from "./summary-dir.js";

export interface SummaryRepairItem {
  id?: number;
  bvid?: string;
  cid?: number;
  title?: string;
}

export interface SummaryRepairReport {
  totalCompleted: number;
  pendingCount: number;
  repaired: Array<
    SummaryRepairItem & { summaryPath: string; segmentCount: number; empty: boolean }
  >;
  skipped: Array<SummaryRepairItem & { reason: string }>;
  failed: Array<SummaryRepairItem & { reason: string }>;
  deferred: Array<SummaryRepairItem & { reason: string; queuedTaskId?: number }>;
}

interface DeferredCandidate {
  record: AiSummaryTaskRecord;
  task: TaskRecord;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function itemOf(record: AiSummaryTaskRecord): SummaryRepairItem {
  return { id: record.id, bvid: record.bvid, cid: record.cid, title: record.title };
}

/**
 * AI 总结本地文件修复（md + 相对截图），以 ai_summary_task 为唯一真源。
 *
 * 仅由用户手动触发（analysis-task.controller POST /api/summary-tasks/repair），
 * 同步执行并返回报告；进程内全局互斥。视频缺失的 task 不在本流程内下载，
 * 统一在末段经 DownloadScheduler 入队（deferred），由人工确认下载完成后
 * 重新触发本接口完成剩余修复（已修复项不再判定缺失，幂等）。
 */
@Injectable()
export class SummaryRepairService {
  private readonly logger = new Logger(SummaryRepairService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly paths: PathsService,
    private readonly downloadScheduler: DownloadScheduler,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  tryStart(): boolean {
    if (this.running) {
      return false;
    }
    this.running = true;
    return true;
  }

  async run(): Promise<SummaryRepairReport> {
    try {
      const report: SummaryRepairReport = {
        totalCompleted: 0,
        pendingCount: 0,
        repaired: [],
        skipped: [],
        failed: [],
        deferred: [],
      };

      const ffmpegAvailable = await new FfmpegScreenshot().isAvailable();
      if (!ffmpegAvailable) {
        this.logger.error(
          createLogMessage("Summary repair aborted because ffmpeg is unavailable"),
        );
      }

      const records = await this.db.listCompletedAiSummaryTasks();
      report.totalCompleted = records.length;

      const deferredCandidates: DeferredCandidate[] = [];
      for (const record of records) {
        const missing = await this.findMissing(record);
        if (!missing) {
          continue;
        }
        report.pendingCount++;
        if (!ffmpegAvailable) {
          report.failed.push({ ...itemOf(record), reason: "ffmpeg 不可用，无法重建截图" });
          continue;
        }
        await this.repairRecord(record, report, deferredCandidates);
      }

      await this.processDeferred(deferredCandidates, report);
      return report;
    } finally {
      this.running = false;
    }
  }

  /** 对齐 summary-integrity 语义：md 缺失或任一本地截图缺失返回 true */
  private async findMissing(record: AiSummaryTaskRecord): Promise<boolean> {
    if (!record.summaryOutput) {
      return true;
    }
    const mdPath = resolveSummaryOutputPath(record.summaryOutput, this.paths.DOWNLOAD_ROOT);
    let content: string;
    try {
      content = await readFile(mdPath, "utf-8");
    } catch {
      return true;
    }
    for (const ref of listLocalImageRefs(content)) {
      if (!(await fileExists(join(dirname(mdPath), ref)))) {
        return true;
      }
    }
    return false;
  }

  private async repairRecord(
    record: AiSummaryTaskRecord,
    report: SummaryRepairReport,
    deferredCandidates: DeferredCandidate[],
  ): Promise<void> {
    const item = itemOf(record);
    const label = `#${record.id} ${record.bvid}/${record.cid}`;
    try {
      if (!record.rawResponse) {
        report.skipped.push({ ...item, reason: "rawResponse 为空，无法重建总结内容" });
        return;
      }
      try {
        JSON.parse(record.rawResponse);
      } catch {
        report.failed.push({ ...item, reason: "rawResponse 不是有效 JSON" });
        return;
      }
      if (!record.bvid || typeof record.cid !== "number") {
        report.skipped.push({ ...item, reason: "缺少 bvid/cid 视频标识" });
        return;
      }

      const task = await this.db.findLatestTaskByBvidAndCid(record.bvid, record.cid);
      if (!task || !task.bvid || typeof task.cid !== "number") {
        report.skipped.push({ ...item, reason: "无对应的下载任务" });
        return;
      }

      let videoPath = task.outputFile;
      if (!videoPath || !(await fileExists(videoPath))) {
        const completedTask = await this.db.findCompletedTaskByBvidAndCid(
          record.bvid,
          record.cid,
        );
        if (completedTask?.outputFile && (await fileExists(completedTask.outputFile))) {
          videoPath = completedTask.outputFile;
        } else {
          deferredCandidates.push({ record, task });
          return;
        }
      }

      const result = await this.rebuildFromStoredResponse(record, task, videoPath);
      report.repaired.push({
        ...item,
        summaryPath: result.summaryPath,
        segmentCount: result.segmentCount,
        empty: result.emptySummary,
      });
      this.logger.log(
        createLogMessage("Summary repair rebuilt local files", {
          id: record.id,
          bvid: record.bvid,
          cid: record.cid,
          summaryPath: result.summaryPath,
          segmentCount: result.segmentCount,
          emptySummary: result.emptySummary,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.failed.push({ ...item, reason: message });
      this.logger.error(
        createLogMessage("Summary repair failed for record", {
          id: record.id,
          bvid: record.bvid,
          cid: record.cid,
          error: message,
        }),
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  /** 同 analysis-trigger.runRebuild 终态语义；不触发知识发布 */
  private async rebuildFromStoredResponse(
    record: AiSummaryTaskRecord,
    task: TaskRecord,
    videoPath: string,
  ) {
    const now = new Date().toISOString();
    const engine = new AnalysisEngine();
    const result = await engine.rebuild(
      {
        videoPath,
        screenshotVideoPath: videoPath,
        summaryDir: this.resolveSummaryDir(task),
        videoTitle: task.title || `${task.bvid}-${task.cid}`,
        metadata: {
          type: "bilibili",
          videoUrl: `https://www.bilibili.com/video/${task.bvid}`,
          bvid: task.bvid,
          cid: task.cid,
        },
      },
      record.rawResponse!,
      record.modelName ?? "",
    );

    await this.db.resetAiSummaryTaskIntegrity(record.id!);
    await this.db.upsertAiSummaryTask({
      bvid: task.bvid!,
      cid: task.cid!,
      title: task.title,
      sourceTaskId: task.id,
      status: "completed",
      summaryOutput: result.summaryPath,
      errorMessage: "",
      executionTiming: JSON.stringify(result.timing),
      lastTriggeredAt: now,
      lastCompletedAt: now,
    });
    return result;
  }

  /**
   * 末段统一处理需要重下视频的 task（主流程全部可本地修复项完成之后）。
   * 仅入队不等待；下载完成后由人工重新触发本接口。
   */
  private async processDeferred(
    candidates: DeferredCandidate[],
    report: SummaryRepairReport,
  ): Promise<void> {
    if (candidates.length === 0) {
      return;
    }

    const seen = new Set<string>();
    const deduped = candidates.filter(({ task }) => {
      const key = `${task.bvid}-${task.cid}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    const mergerAvailable = await new FfmpegMerger().isAvailable();
    if (!mergerAvailable) {
      for (const { record } of deduped) {
        report.failed.push({ ...itemOf(record), reason: "ffmpeg 不可用，下载后无法合并音视频" });
      }
      return;
    }

    for (const { record, task } of deduped) {
      const item = itemOf(record);
      try {
        if (task.status === TaskStatus.Created || task.status === TaskStatus.Downloading) {
          report.deferred.push({
            ...item,
            reason: "下载任务进行中，待完成后重新触发本接口",
          });
          continue;
        }
        const { id } = await this.downloadScheduler.createDownload({
          bvid: task.bvid!,
          cid: task.cid!,
          title: task.title ?? `${task.bvid}-${task.cid}`,
          quality: task.quality,
          codec: task.codec,
          outputPath: task.outputPath,
          fileNameTemplate: task.fileNameTemplate,
          subtitleLang: task.subtitleLang,
          autoSummary: false,
        });
        report.deferred.push({
          ...item,
          reason: "视频缺失，已按原任务画质入队重新下载",
          queuedTaskId: id,
        });
        this.logger.log(
          createLogMessage("Summary repair queued video re-download", {
            id: record.id,
            bvid: record.bvid,
            cid: record.cid,
            queuedTaskId: id,
            quality: task.quality,
          }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        report.failed.push({ ...item, reason: `入队重新下载失败: ${message}` });
        this.logger.error(
          createLogMessage("Summary repair failed to queue video re-download", {
            id: record.id,
            bvid: record.bvid,
            cid: record.cid,
            error: message,
          }),
          err instanceof Error ? err.stack : undefined,
        );
      }
    }
  }

  /** 复刻 AnalysisTriggerService.resolveSummaryDir（analysis-trigger.service.ts:624-675） */
  private resolveSummaryDir(task: TaskRecord): string {
    const base = this.paths.SUMMARY_BASE_DIR;
    const bvid = task.bvid;
    const cid = task.cid;
    if (!bvid || typeof cid !== "number") {
      return join(base, "analysis");
    }

    const titleBase = (task.title ?? "").trim();
    const titlePart = titleBase ? sanitizeFileName(titleBase) : "";
    const candidateName = titlePart ? `${titlePart}-${bvid}-${cid}` : `${bvid}-${cid}`;
    const suffix = `-${bvid}-${cid}`;

    let existingDir: string | undefined;
    try {
      existingDir = readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort((a, b) => {
          const aExact = a === candidateName ? -1 : 0;
          const bExact = b === candidateName ? -1 : 0;
          return aExact - bExact || a.localeCompare(b);
        })
        .find(
          (n) =>
            n === candidateName ||
            n.endsWith(suffix) ||
            n === `${bvid}-${cid}`,
        );
    } catch {
      // summary 根目录尚不存在，忽略
    }

    return join(base, existingDir ?? candidateName);
  }
}
