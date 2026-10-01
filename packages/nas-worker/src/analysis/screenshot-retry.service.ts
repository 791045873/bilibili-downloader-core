import { Injectable, Logger } from "@nestjs/common";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { FfmpegScreenshot } from "@bilibili-downloader/adapters/ffmpeg";
import { DatabaseService } from "@bilibili-downloader/server-common";
import { DownloadExecutorService } from "../download/download-executor.service.js";
import { AnalysisVideoResolver } from "./analysis-video-resolver.js";
import { CosStoreService } from "../knowledge/cos-store.service.js";
import { PathsService } from "../paths/paths.service.js";
import { resolveFromDownloadRoot } from "@bilibili-downloader/server-common";
import { createLogMessage } from "@bilibili-downloader/server-common";

export interface RetrySegment {
  seq: number;
  timestampSeconds: number | null;
  screenshotUrl: string | null;
}

/** 选出需重截的段：screenshot_url 为空 且 timestampSeconds 非空（幂等补空段） */
export function selectSegmentsForRetry(
  segments: RetrySegment[],
): Array<{ seq: number; timestampSeconds: number }> {
  return segments
    .filter((s) => !s.screenshotUrl && typeof s.timestampSeconds === "number")
    .map((s) => ({
      seq: s.seq,
      timestampSeconds: s.timestampSeconds as number,
    }));
}

interface ScreenshotSource {
  source: string;
  sourceType: "local" | "remote";
  headers?: Record<string, string>;
}

/**
 * 重试截图（screenshot_retry 执行体）：
 * 读段 timestampSeconds + 截图源 → 截图 → 上传 COS → 仅回写 summary_segment.screenshot_url。
 * 不调 LLM、不改 summary 文本/段内容/向量、不改 ai_summary_task 状态。仅补齐空截图，幂等。
 */
@Injectable()
export class ScreenshotRetryService {
  private readonly logger = new Logger(ScreenshotRetryService.name);
  private readonly screenshotter = new FfmpegScreenshot();

  constructor(
    private readonly db: DatabaseService,
    private readonly downloadService: DownloadExecutorService,
    private readonly videoResolver: AnalysisVideoResolver,
    private readonly cosStore: CosStoreService,
    private readonly paths: PathsService,
  ) {}

  async run(summaryTaskId: number): Promise<void> {
    const record = await this.db.getAiSummaryTaskById(summaryTaskId);
    if (
      !record ||
      record.status !== "completed" ||
      !record.bvid ||
      typeof record.cid !== "number"
    ) {
      this.logger.warn(
        createLogMessage("Screenshot retry aborted: record not rebuildable", {
          summaryTaskId,
          status: record?.status,
        }),
      );
      return;
    }
    const bvid = record.bvid;
    const cid = record.cid;

    const data = await this.db.getSummarySegmentsForScreenshotRetry(bvid, cid);
    if (!data) {
      this.logger.warn(
        createLogMessage("Screenshot retry aborted: no summary row", {
          summaryTaskId,
          bvid,
          cid,
        }),
      );
      return;
    }
    const targets = selectSegmentsForRetry(data.segments);
    if (targets.length === 0) {
      this.logger.log(
        createLogMessage("Screenshot retry: nothing to do", {
          summaryTaskId,
          bvid,
          cid,
        }),
      );
      return;
    }
    if (!this.cosStore.isConfigured()) {
      this.logger.warn(
        createLogMessage("Screenshot retry skipped: COS not configured", {
          summaryTaskId,
          bvid,
          cid,
          pending: targets.length,
        }),
      );
      return;
    }

    const source = await this.resolveSource(bvid, cid);
    if (!source) {
      this.logger.warn(
        createLogMessage(
          "Screenshot retry skipped: no usable video source (videoMissing)",
          { summaryTaskId, bvid, cid, pending: targets.length },
        ),
      );
      return;
    }

    const outputDir = join(
      this.paths.ANALYSIS_LLM_VIDEO_DIR,
      "screenshot-retry",
      `${bvid}-${cid}`,
    );
    await mkdir(outputDir, { recursive: true });

    let done = 0;
    let skipped = 0;
    for (const seg of targets) {
      try {
        const shot = await this.screenshotter.takeScreenshots({
          videoPath: source.source,
          timePoints: [seg.timestampSeconds],
          outputDir,
          filenamePrefix: `segment-${seg.seq}`,
          headers: source.sourceType === "remote" ? source.headers : undefined,
        });
        const local = shot.outputFiles[0];
        if (!local) {
          skipped++;
          continue;
        }
        const key = `summary/${bvid}-${cid}/screenshots/${basename(local)}`;
        const url = await this.cosStore.upload(local, key);
        await this.db.updateSegmentScreenshotUrl(data.summaryId, seg.seq, url);
        done++;
      } catch (err) {
        skipped++;
        this.logger.warn(
          createLogMessage("Screenshot retry: segment skipped", {
            summaryTaskId,
            bvid,
            cid,
            seq: seg.seq,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
    this.logger.log(
      createLogMessage("Screenshot retry finished", {
        summaryTaskId,
        bvid,
        cid,
        done,
        skipped,
        total: targets.length,
        sourceType: source.sourceType,
      }),
    );
  }

  /** 本地高清优先；缺失回退共享 resolver（远端/已完成本地/重下兜底） */
  private async resolveSource(
    bvid: string,
    cid: number,
  ): Promise<ScreenshotSource | undefined> {
    const task = await this.db.findLatestTaskByBvidAndCid(bvid, cid);
    const localHd = resolveFromDownloadRoot(
      task?.outputFile,
      this.paths.DOWNLOAD_ROOT,
    );
    if (localHd && (await this.downloadService.fileExists(localHd))) {
      return { source: localHd, sourceType: "local" };
    }
    try {
      return await this.videoResolver.resolve({
        metadata: {
          type: "bilibili",
          bvid,
          cid,
          videoUrl: `https://www.bilibili.com/video/${bvid}`,
        },
      });
    } catch (err) {
      this.logger.warn(
        createLogMessage("Screenshot retry: source resolve failed", {
          bvid,
          cid,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return undefined;
    }
  }
}
