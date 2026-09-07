import { Injectable, Logger } from "@nestjs/common";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseService, type AiSummaryTaskRecord } from "../database/database.service.js";
import { PathsService } from "../paths/paths.service.js";
import { createLogMessage } from "../logging/server-log.util.js";
import { listLocalImageRefs, resolveSummaryOutputPath } from "./summary-dir.js";

/** integrity_detail 缺失项展示上限，超出截断并保留总计数 */
const MAX_DETAIL_ITEMS = 40;

/** integrity_status 取值词表（NULL=未检查） */
export const INTEGRITY_STATUS = {
  complete: "complete",
  missing: "missing",
} as const;

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function truncateDetail(missing: string[]): string {
  if (missing.length <= MAX_DETAIL_ITEMS) {
    return missing.join("\n");
  }
  return `${missing.slice(0, MAX_DETAIL_ITEMS).join("\n")}\n…共 ${missing.length} 项缺失`;
}

/**
 * AI 总结本地原始内容完整性检查（md + 相对截图）
 *
 * 仅由用户手动触发（analysis-task.controller POST /api/summary-tasks/integrity-check），
 * 无自动/定时路径；进程内全局互斥，同一时刻至多一个全量检查。
 * 只读磁盘、不修改任何文件；结果逐条写回 ai_summary_task（不触碰 updated_at）。
 */
@Injectable()
export class SummaryIntegrityService {
  private readonly logger = new Logger(SummaryIntegrityService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly paths: PathsService,
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

  async run(): Promise<void> {
    try {
      const records = await this.db.listCompletedAiSummaryTasks();
      const downloadRoot = this.paths.DOWNLOAD_ROOT;
      let completeCount = 0;
      let missingCount = 0;
      const checkedAt = new Date();
      for (const record of records) {
        const verdict = await this.checkRecord(record, downloadRoot);
        if (verdict.status === INTEGRITY_STATUS.complete) {
          completeCount++;
        } else {
          missingCount++;
        }
        await this.db.updateAiSummaryTaskIntegrity([
          {
            id: record.id!,
            status: verdict.status,
            detail: verdict.detail,
            checkedAt,
          },
        ]);
      }
      this.logger.log(
        createLogMessage("Summary integrity check finished", {
          total: records.length,
          complete: completeCount,
          missing: missingCount,
        }),
      );
    } finally {
      this.running = false;
    }
  }

  private async checkRecord(
    record: AiSummaryTaskRecord,
    downloadRoot: string,
  ): Promise<{ status: string; detail: string | null }> {
    if (!record.summaryOutput) {
      return { status: INTEGRITY_STATUS.missing, detail: "无输出文档记录" };
    }
    const mdPath = resolveSummaryOutputPath(record.summaryOutput, downloadRoot);
    let content: string;
    try {
      content = await readFile(mdPath, "utf-8");
    } catch {
      return {
        status: INTEGRITY_STATUS.missing,
        detail: "总结文档不存在或不可读",
      };
    }

    const missing: string[] = [];
    for (const ref of listLocalImageRefs(content)) {
      if (!(await fileExists(join(dirname(mdPath), ref)))) {
        missing.push(ref);
      }
    }
    if (missing.length === 0) {
      return { status: INTEGRITY_STATUS.complete, detail: null };
    }
    return {
      status: INTEGRITY_STATUS.missing,
      detail: truncateDetail(missing),
    };
  }
}
