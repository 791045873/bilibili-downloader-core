import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import type { AiSummaryTaskRecord } from "../database/database.service.js";
import { KnowledgePublisherService } from "./knowledge-publisher.service.js";

export interface BackfillFailure {
  summaryTaskId: number;
  error: string;
}

export interface BackfillStatus {
  running: boolean;
  total: number;
  synced: number;
  skipped: number;
  failed: number;
  failures: BackfillFailure[];
}

@Injectable()
export class KnowledgeBackfillService {
  private readonly logger = new Logger(KnowledgeBackfillService.name);
  private running = false;
  private status: BackfillStatus = {
    running: false,
    total: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  constructor(
    private readonly db: DatabaseService,
    private readonly publisher: KnowledgePublisherService,
  ) {}

  async start(): Promise<{ started: boolean; total: number }> {
    if (this.running) {
      return { started: false, total: this.status.total };
    }
    const tasks = await this.db.listAiSummaryTasksForKnowledgeBackfill();
    if (tasks.length === 0) {
      return { started: true, total: 0 };
    }
    this.running = true;
    this.status = {
      running: true,
      total: tasks.length,
      synced: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    };
    void this.run(tasks).catch((err: unknown) => {
      this.logger.error(
        `Knowledge backfill batch crashed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.running = false;
      this.status.running = false;
    });
    return { started: true, total: tasks.length };
  }

  getStatus(): BackfillStatus {
    return this.status;
  }

  private async run(tasks: AiSummaryTaskRecord[]): Promise<void> {
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < tasks.length) {
        const task = tasks[cursor++];
        await this.publishOne(task);
      }
    };
    await Promise.all([worker(), worker()]);
    this.running = false;
    this.status.running = false;
    this.logger.log(
      `Knowledge backfill batch finished: total=${this.status.total} synced=${this.status.synced} skipped=${this.status.skipped} failed=${this.status.failed}`,
    );
  }

  private async publishOne(task: AiSummaryTaskRecord): Promise<void> {
    try {
      const current = await this.db.getAiSummaryTaskById(task.id!);
      if (!current || current.knowledgeStatus === "synced") {
        this.status.skipped++;
        return;
      }
      if (!current.bvid || typeof current.cid !== "number") {
        this.status.failed++;
        this.status.failures.push({
          summaryTaskId: current.id!,
          error: "记录缺少视频资源标识，无法发布",
        });
        return;
      }
      const latestTask = await this.db.findLatestTaskByBvidAndCid(
        current.bvid,
        current.cid,
      );
      await this.publisher.publish({
        bvid: current.bvid,
        cid: current.cid,
        videoTitle:
          latestTask?.title || current.title || `${current.bvid}-${current.cid}`,
        videoUrl: `https://www.bilibili.com/video/${current.bvid}`,
        modelName: current.modelName,
        rawResponse: current.rawResponse!,
        summaryPath: current.summaryOutput!,
      });
      const after = await this.db.getAiSummaryTaskById(current.id!);
      if (after?.knowledgeStatus === "synced") {
        this.status.synced++;
      } else {
        this.status.failed++;
        this.status.failures.push({
          summaryTaskId: current.id!,
          error: after?.knowledgeError ?? "发布未达到 synced 状态",
        });
      }
    } catch (err) {
      this.status.failed++;
      this.status.failures.push({
        summaryTaskId: task.id!,
        error: err instanceof Error ? err.message : String(err),
      });
      this.logger.warn(
        `Knowledge backfill failed for summary task ${task.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
