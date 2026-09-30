import { Injectable, Logger } from "@nestjs/common";
import { access } from "node:fs/promises";
import { DatabaseService, type AiSummaryTaskRecord } from "../database/database.service.js";
import { PathsService } from "../paths/paths.service.js";
import { resolveFromDownloadRoot } from "../paths/path-anchor.js";
import { createLogMessage } from "../logging/server-log.util.js";

/** integrity_status 取值词表（NULL=未检查） */
export const INTEGRITY_STATUS = {
  complete: "complete",
  partial: "partial",
  missing: "missing",
} as const;

/** 结构化完整性明细（存入 integrity_detail 文本列，JSON 序列化） */
export interface IntegrityDetail {
  /** 内容缺失标记：无 summary 头 -> "summary"；零段 -> "segments" */
  contentMissing: string[];
  /** 缺失截图的段 seq 列表 */
  screenshotMissing: number[];
  /** 视频缺失标记（仅告警）：缺失 -> "video" */
  videoMissing: string[];
}

export interface IntegrityJudgeInput {
  hasSummary: boolean;
  segmentCount: number;
  screenshotMissingSeqs: number[];
  videoMissing: boolean;
}

/**
 * 纯函数：由采集到的三类事实判定完整性等级与结构化明细。
 * 严重度：内容 > 截图 > 视频（视频仅告警，不单独降级）。
 */
export function judgeIntegrity(
  input: IntegrityJudgeInput,
): { status: string; detail: IntegrityDetail } {
  const contentMissing: string[] = [];
  if (!input.hasSummary) {
    contentMissing.push("summary");
  } else if (input.segmentCount === 0) {
    contentMissing.push("segments");
  }
  const screenshotMissing = [...input.screenshotMissingSeqs];
  const videoMissing = input.videoMissing ? ["video"] : [];

  let status: string;
  if (contentMissing.length > 0) {
    status = INTEGRITY_STATUS.missing;
  } else if (screenshotMissing.length > 0) {
    status = INTEGRITY_STATUS.partial;
  } else {
    status = INTEGRITY_STATUS.complete;
  }
  return { status, detail: { contentMissing, screenshotMissing, videoMissing } };
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * AI 总结完整性检查（云端为真源，三类判据）：
 * - 内容：云 DB `summary` + `summary_segment` 完备（不读本地 md）
 * - 截图：`summary_segment.screenshot_url` 是否齐全
 * - 视频：NAS 本地视频文件是否存在（仅告警）
 *
 * 并发去重与状态查询经 worker_job（integrity_check）承担；本服务只读，
 * 仅写 `integrity_*` 三列（不触碰 updated_at）。结果幂等可覆盖。
 */
@Injectable()
export class SummaryIntegrityService {
  private readonly logger = new Logger(SummaryIntegrityService.name);
  constructor(
    private readonly db: DatabaseService,
    private readonly paths: PathsService,
  ) {}

  async run(): Promise<void> {
    const records = await this.db.listCompletedAiSummaryTasks();
    const downloadRoot = this.paths.DOWNLOAD_ROOT;
    let completeCount = 0;
    let partialCount = 0;
    let missingCount = 0;
    const checkedAt = new Date();
    for (const record of records) {
      const verdict = await this.checkRecord(record, downloadRoot);
      if (verdict.status === INTEGRITY_STATUS.complete) {
        completeCount++;
      } else if (verdict.status === INTEGRITY_STATUS.partial) {
        partialCount++;
      } else {
        missingCount++;
      }
      await this.db.updateAiSummaryTaskIntegrity([
        {
          id: record.id!,
          status: verdict.status,
          detail: JSON.stringify(verdict.detail),
          checkedAt,
        },
      ]);
    }
    this.logger.log(
      createLogMessage("Summary integrity check finished", {
        total: records.length,
        complete: completeCount,
        partial: partialCount,
        missing: missingCount,
      }),
    );
  }

  private async checkRecord(
    record: AiSummaryTaskRecord,
    downloadRoot: string,
  ): Promise<{ status: string; detail: IntegrityDetail }> {
    const summary = await this.db.getSummaryWithSegmentsByResource(
      record.bvid,
      record.cid,
    );
    const hasSummary = summary != null;
    const segments = summary?.segments ?? [];
    const screenshotMissingSeqs = segments
      .filter((s) => !s.screenshotUrl)
      .map((s) => s.seq);
    const videoMissing = await this.isVideoMissing(
      record.bvid,
      record.cid,
      downloadRoot,
    );
    return judgeIntegrity({
      hasSummary,
      segmentCount: segments.length,
      screenshotMissingSeqs,
      videoMissing,
    });
  }

  /** NAS 本地视频缺失：无完成下载任务 / 无 outputFile / 文件不存在 均视为缺失（仅告警） */
  private async isVideoMissing(
    bvid: string,
    cid: number,
    downloadRoot: string,
  ): Promise<boolean> {
    const task = await this.db.findCompletedTaskByBvidAndCid(bvid, cid);
    const abs = resolveFromDownloadRoot(task?.outputFile, downloadRoot);
    if (!abs) {
      return true;
    }
    return !(await fileExists(abs));
  }
}
