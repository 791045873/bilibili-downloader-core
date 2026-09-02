import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import { Pool, types as pgTypes } from "pg";
import { Temporal } from "temporal-polyfill";
import { and, or } from "@prisma/orm-postgres/orm-client";
import type { ModelAccessor } from "@prisma/orm-postgres/orm-client";
import type { Contract } from "../prisma/contract.d";
import { createLogMessage } from "../logging/server-log.util.js";
import { PrismaService, createPrismaClient } from "./prisma.service.js";
import {
  BUILTIN_AI_PROMPT_CONTENT,
  BUILTIN_AI_PROMPT_NAME,
} from "../analysis/prompt-template.js";

pgTypes.setTypeParser(20, (value: string) => Number(value));
pgTypes.setTypeParser(1114, (value: string) => toIsoTimestamp(value));
pgTypes.setTypeParser(1184, (value: string) => toIsoTimestamp(value));

/**
 * 任务记录（对应 task 表）
 */
export interface TaskRecord {
  id?: number;
  bvid?: string;
  cid?: number;
  title?: string;
  quality?: number;
  codec?: string;
  fileNameTemplate?: string;
  outputPath?: string;
  subtitleLang?: string;
  autoSummary?: number;
  summaryStatus?: string;
  summaryOutput?: string;
  /** 下载任务显式选中的提示词（下载完成后自动总结时使用） */
  promptId?: number;
  status: string;
  progress?: number;
  speed?: string;
  outputFile?: string;
  fileSize?: number;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
}

/** 提示词记录（对应 ai_prompt 表） */
export interface AiPromptRecord {
  id?: number;
  name: string;
  content: string;
  isSystem?: number;
  isDefault?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AnalysisSubTaskRecord {
  id?: number;
  taskId: number;
  bvid?: string;
  cid?: number;
  quality?: number;
  status: string;
  outputFile?: string;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export interface AiSummaryTaskRecord {
  id?: number;
  bvid: string;
  cid: number;
  title?: string;
  sourceTaskId?: number;
  /** 本次执行实际使用的提示词（认领时解析写入） */
  promptId?: number;
  status: string;
  summaryOutput?: string;
  errorMessage?: string;
  executionTiming?: string;
  /** 本次执行记录：成功=模型返回 content 原文；失败=错误信息 */
  rawResponse?: string;
  modelName?: string;
  /** 知识发布状态（pending / synced / failed） */
  knowledgeStatus?: string;
  /** 知识发布失败信息 */
  knowledgeError?: string;
  createdAt?: string;
  updatedAt?: string;
  lastTriggeredAt?: string;
  lastCompletedAt?: string;
}

export type TaskStatusGroup =
  | "all"
  | "active"
  | "created"
  | "downloading"
  | "success"
  | "failed"
  | "stopped";

export interface PaginatedTaskResult {
  items: TaskRecord[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface AiSummaryTaskListFilter {
  status?: string[];
  search?: string;
  updatedFrom?: string;
  updatedTo?: string;
}

export interface PaginatedAiSummaryTaskResult {
  items: AiSummaryTaskRecord[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  private readonly databaseUrl: string;
  private readonly progressBuckets = new Map<number, number>();
  private readonly prismaDb: ReturnType<typeof createPrismaClient>;
  private readonly ownsPrismaClient: boolean;

  constructor(prisma?: PrismaService) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL is required. Set it to a PostgreSQL connection string.",
      );
    }
    this.databaseUrl = databaseUrl;
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      connectionTimeoutMillis: 10_000,
    });
    this.ownsPrismaClient = !prisma;
    this.prismaDb = prisma?.db ?? createPrismaClient();
    this.logger.log(
      createLogMessage("PostgreSQL pool created", {
        sourceType: "postgres",
      }),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.connectWithRetry();
    await this.initSchema();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
    if (this.ownsPrismaClient) {
      await this.prismaDb.close();
    }
  }

  private async connectWithRetry(maxAttempts = 10): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const client = await this.pool.connect();
        client.release();
        this.logger.log(
          createLogMessage("PostgreSQL database connected", {
            sourceType: "postgres",
            databaseUrl: sanitizeDatabaseUrl(this.databaseUrl),
          }),
        );
        return;
      } catch (err) {
        if (attempt === maxAttempts) {
          throw new Error(
            `Failed to connect to PostgreSQL after ${maxAttempts} attempts: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        const delayMs = 1000 * attempt;
        this.logger.warn(
          createLogMessage("PostgreSQL connection retry", {
            attempt,
            delayMs,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // ==================== Schema ====================

  private async initSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS task (
        id BIGSERIAL PRIMARY KEY,
        bvid TEXT,
        cid BIGINT,
        title TEXT,
        quality INTEGER,
        codec TEXT,
        "fileNameTemplate" TEXT,
        "outputPath" TEXT,
        subtitle_lang TEXT,
        auto_summary INTEGER DEFAULT 0,
        summary_status TEXT DEFAULT 'none',
        summary_output TEXT,
        prompt_id INTEGER,
        status TEXT NOT NULL DEFAULT 'created',
        progress DOUBLE PRECISION DEFAULT 0,
        speed TEXT,
        "outputFile" TEXT,
        "fileSize" BIGINT,
        "errorCode" TEXT,
        "errorMessage" TEXT,
        "durationMs" BIGINT,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL,
        "completedAt" TIMESTAMPTZ
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_task_status ON task(status);
      CREATE INDEX IF NOT EXISTS idx_task_created ON task("createdAt");
      CREATE INDEX IF NOT EXISTS idx_task_bvid_cid ON task(bvid, cid);
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS analysis_sub_task (
        id BIGSERIAL PRIMARY KEY,
        task_id BIGINT NOT NULL REFERENCES task(id),
        bvid TEXT,
        cid BIGINT,
        quality INTEGER,
        status TEXT NOT NULL DEFAULT 'created',
        output_file TEXT,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analysis_sub_task_task_id
      ON analysis_sub_task(task_id);
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ai_summary_task (
        id BIGSERIAL PRIMARY KEY,
        bvid TEXT NOT NULL,
        cid BIGINT NOT NULL,
        title TEXT,
        source_task_id BIGINT,
        prompt_id INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        summary_output TEXT,
        error_message TEXT,
        execution_timing TEXT,
        raw_response TEXT,
        model_name TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        last_triggered_at TIMESTAMPTZ,
        last_completed_at TIMESTAMPTZ,
        knowledge_status TEXT,
        knowledge_error TEXT,
        UNIQUE (bvid, cid)
      )
    `);
    await this.pool.query(`
      ALTER TABLE ai_summary_task ADD COLUMN IF NOT EXISTS knowledge_status TEXT;
      ALTER TABLE ai_summary_task ADD COLUMN IF NOT EXISTS knowledge_error TEXT;
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_summary_task_updated_at
      ON ai_summary_task(updated_at DESC);
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ai_prompt (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        is_system INTEGER DEFAULT 0,
        is_default INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ai_prompt_creator (
        mid BIGINT PRIMARY KEY,
        prompt_id BIGINT NOT NULL
      )
    `);

    // 云端知识库：一份视频总结（对应一个 bvid+cid 的 completed 总结）
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS summary (
        id BIGSERIAL PRIMARY KEY,
        bvid TEXT NOT NULL,
        cid BIGINT NOT NULL,
        video_title TEXT NOT NULL,
        video_url TEXT,
        model_name TEXT,
        raw_response JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (bvid, cid)
      )
    `);
    // 一条技巧 = 一个 RAG chunk（embedding 列 Phase 2 再补）
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS summary_segment (
        id BIGSERIAL PRIMARY KEY,
        summary_id BIGINT NOT NULL REFERENCES summary(id) ON DELETE CASCADE,
        seq INT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp_seconds INT,
        frame_description TEXT,
        screenshot_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (summary_id, seq)
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_summary_segment_summary_id
      ON summary_segment(summary_id);
    `);

    // 空表播种内置提示词（幂等：仅空表执行）
    const promptCount = await this.pool.query(
      `SELECT COUNT(*) AS count FROM ai_prompt`,
    );
    if (Number(promptCount.rows[0].count) === 0) {
      const now = new Date().toISOString();
      await this.pool.query(
        `INSERT INTO ai_prompt (name, content, is_system, is_default, created_at, updated_at)
         VALUES ($1, $2, 1, 1, $3, $3)`,
        [BUILTIN_AI_PROMPT_NAME, BUILTIN_AI_PROMPT_CONTENT, now],
      );
      this.logger.log(
        createLogMessage("Seeded builtin AI summary prompt", {
          isSystem: true,
          isDefault: true,
        }),
      );
    }

    // 状态单一来源迁移：把历史 task.summary_status 合并进 ai_summary_task（幂等，仅首次建表后有数据时生效）
    await this.pool.query(`
      INSERT INTO ai_summary_task (
        bvid, cid, title, status, summary_output, error_message,
        created_at, updated_at, last_triggered_at, last_completed_at
      )
      SELECT
        t.bvid, t.cid, t.title, t.summary_status, t.summary_output, NULL,
        COALESCE(t."completedAt", t."createdAt", now()),
        COALESCE(t."completedAt", t."createdAt", now()),
        NULL,
        CASE
          WHEN t.summary_status = 'completed' THEN COALESCE(t."completedAt", t."createdAt")
          ELSE NULL
        END
      FROM task t
      WHERE t.bvid IS NOT NULL
        AND t.cid IS NOT NULL
        AND t.summary_status IS NOT NULL
        AND t.summary_status != 'none'
      ON CONFLICT (bvid, cid) DO NOTHING
    `);

    // 子任务资源级键迁移：analysis_sub_task 按 (bvid,cid,quality) 活跃唯一（幂等）
    try {
      await this.pool.query(`
        UPDATE analysis_sub_task
        SET status = 'failed',
            error_message = COALESCE(error_message, 'superseded by newer record')
        WHERE id NOT IN (
          SELECT MAX(id) FROM analysis_sub_task GROUP BY bvid, cid, quality
        )
      `);
      await this.pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_sub_task_active
        ON analysis_sub_task(bvid, cid, quality)
        WHERE status != 'failed'
      `);
    } catch (err) {
      this.logger.warn(
        createLogMessage(
          "Analysis sub task unique index creation failed; continuing without hard uniqueness",
          {
            error: err instanceof Error ? err.message : String(err),
          },
        ),
      );
    }
  }

  // ==================== CRUD ====================

  /** 插入新任务，返回自增 id */
  async insertTask(record: TaskRecord): Promise<number> {
    const now = Temporal.Instant.fromEpochMilliseconds(Date.now());
    const created = await this.prismaDb.orm.public.Task.create({
      bvid: record.bvid ?? null,
      cid: record.cid != null ? BigInt(record.cid) : null,
      title: record.title ?? null,
      quality: record.quality ?? null,
      codec: record.codec ?? null,
      fileNameTemplate: record.fileNameTemplate ?? null,
      outputPath: record.outputPath ?? null,
      subtitleLang: record.subtitleLang ?? null,
      status: record.status ?? "created",
      progress: record.progress ?? 0,
      speed: record.speed ?? null,
      autoSummary: record.autoSummary ?? 0,
      summaryStatus: record.summaryStatus ?? "none",
      summaryOutput: record.summaryOutput ?? null,
      promptId: record.promptId ?? null,
      outputFile: record.outputFile ?? null,
      fileSize: record.fileSize != null ? BigInt(record.fileSize) : null,
      errorCode: record.errorCode ?? null,
      errorMessage: record.errorMessage ?? null,
      durationMs: record.durationMs != null ? BigInt(record.durationMs) : null,
      createdAt: toInstant(record.createdAt ?? now)!,
      updatedAt: now,
      completedAt: toInstant(record.completedAt),
    });
    const id = Number(created.id);
    this.logger.log(
      createLogMessage("Persisted download task", {
        taskId: id,
        bvid: record.bvid,
        cid: record.cid,
        status: record.status,
        quality: record.quality,
        codec: record.codec,
        autoSummary: record.autoSummary,
        promptId: record.promptId,
        outputPath: record.outputPath,
      }),
    );
    return id;
  }

  /** 更新任务进度（每秒调用一次） */
  async updateTaskProgress(
    id: number,
    progress: number,
    speed?: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `UPDATE task SET progress = $1, speed = $2, "updatedAt" = $3 WHERE id = $4`,
      [progress, speed ?? null, now, id],
    );

    const bucket = Math.floor(Math.max(0, Math.min(progress, 100)) / 10);
    if (this.progressBuckets.get(id) !== bucket || progress >= 100) {
      this.progressBuckets.set(id, bucket);
      this.logger.log(
        createLogMessage("Persisted task progress snapshot", {
          taskId: id,
          progress: Math.round(progress),
          status: "downloading",
        }),
      );
    }
  }

  /**
   * 更新任务状态（完成/失败时）。AI 总结状态由 ai_summary_task 单一来源，不在此写入。
   */
  async updateTaskStatus(
    id: number,
    fields: {
      status: string;
      autoSummary?: number;
      promptId?: number;
      outputFile?: string;
      fileSize?: number;
      errorCode?: string;
      errorMessage?: string;
      durationMs?: number;
      progress?: number;
    },
  ): Promise<void> {
    const previous = await this.getTaskById(id);
    const now = Temporal.Instant.fromEpochMilliseconds(Date.now());
    await this.prismaDb.orm.public.Task.where({ id: BigInt(id) }).update({
      status: fields.status,
      updatedAt: now,
      ...(fields.autoSummary !== undefined ? { autoSummary: fields.autoSummary } : {}),
      ...(fields.promptId !== undefined ? { promptId: fields.promptId } : {}),
      ...(fields.outputFile !== undefined ? { outputFile: fields.outputFile } : {}),
      ...(fields.fileSize !== undefined ? { fileSize: BigInt(fields.fileSize) } : {}),
      ...(fields.errorCode !== undefined ? { errorCode: fields.errorCode } : {}),
      ...(fields.errorMessage !== undefined ? { errorMessage: fields.errorMessage } : {}),
      ...(fields.durationMs !== undefined ? { durationMs: BigInt(fields.durationMs) } : {}),
      ...(fields.progress !== undefined ? { progress: fields.progress } : {}),
      ...(fields.status === "success" || fields.status === "failed"
        ? { completedAt: now }
        : {}),
    });

    const statusChanged = previous?.status !== fields.status;
    const shouldLog =
      statusChanged ||
      fields.errorMessage !== undefined ||
      fields.outputFile !== undefined ||
      fields.autoSummary !== undefined ||
      fields.promptId !== undefined ||
      fields.durationMs !== undefined;

    if (shouldLog) {
      const details = {
        taskId: id,
        bvid: previous?.bvid,
        cid: previous?.cid,
        fromStatus: previous?.status,
        toStatus: fields.status,
        status: fields.status,
        autoSummary: fields.autoSummary,
        promptId: fields.promptId,
        outputFile: fields.outputFile,
        error: fields.errorMessage,
        durationMs: fields.durationMs,
        progress: fields.progress,
      };

      if (fields.status === "failed") {
        this.logger.error(
          createLogMessage("Persisted task status change", details),
        );
      } else {
        this.logger.log(
          createLogMessage("Persisted task status change", details),
        );
      }
    }

    if (fields.status === "success" || fields.status === "failed") {
      this.progressBuckets.delete(id);
    }
  }

  private mapTaskRow(row: {
    id: bigint;
    bvid: string | null;
    cid: bigint | null;
    title: string | null;
    quality: number | null;
    codec: string | null;
    fileNameTemplate: string | null;
    outputPath: string | null;
    subtitleLang: string | null;
    autoSummary: number | null;
    promptId: number | null;
    status: string;
    progress: number | null;
    speed: string | null;
    outputFile: string | null;
    fileSize: bigint | null;
    errorCode: string | null;
    errorMessage: string | null;
    durationMs: bigint | null;
    createdAt: unknown;
    updatedAt: unknown;
    completedAt: unknown;
  }): TaskRecord {
    return {
      id: Number(row.id),
      bvid: row.bvid,
      cid: row.cid == null ? null : Number(row.cid),
      title: row.title,
      quality: row.quality,
      codec: row.codec,
      fileNameTemplate: row.fileNameTemplate,
      outputPath: row.outputPath,
      subtitleLang: row.subtitleLang,
      autoSummary: row.autoSummary,
      promptId: row.promptId,
      status: row.status,
      progress: row.progress,
      speed: row.speed,
      outputFile: row.outputFile,
      fileSize: row.fileSize == null ? null : Number(row.fileSize),
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      durationMs: row.durationMs == null ? null : Number(row.durationMs),
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
      completedAt: toIsoString(row.completedAt),
      summaryStatus: null,
      summaryOutput: null,
    } as unknown as TaskRecord;
  }

  private async mergeSummaryMirror(
    rows: TaskRecord[],
  ): Promise<TaskRecord[]> {
    const keys = new Set<string>();
    for (const row of rows) {
      if (row.bvid != null && row.cid != null) {
        keys.add(`${row.bvid}|${row.cid}`);
      }
    }
    if (keys.size > 0) {
      const mirrors = await this.prismaDb.orm.public.AiSummaryTask
        .where((m) =>
          or(
            ...[...keys].map((key) => {
              const [bvid, cid] = key.split("|");
              return and(m.bvid.eq(bvid!), m.cid.eq(BigInt(Number(cid))));
            }),
          ),
        )
        .all();
      const byKey = new Map<string, { status: string; summaryOutput: string | null }>(
        mirrors.map((m) => [`${m.bvid}|${Number(m.cid)}`, { status: m.status, summaryOutput: m.summaryOutput }]),
      );
      for (const row of rows) {
        if (row.bvid != null && row.cid != null) {
          const mirror = byKey.get(`${row.bvid}|${row.cid}`);
          if (mirror) {
            row.summaryStatus = mirror.status;
            row.summaryOutput = mirror.summaryOutput as unknown as string | undefined;
          }
        }
      }
    }
    return rows;
  }

  private expandTaskStatusGroup(statusGroups: TaskStatusGroup[]): string[] {
    const expanded = new Set<string>();
    for (const group of statusGroups) {
      if (group === "all") {
        continue;
      }
      if (group === "active") {
        expanded.add("created");
        expanded.add("downloading");
      } else {
        expanded.add(group);
      }
    }
    return [...expanded];
  }

  /** 获取所有任务 */
  async getTasks(): Promise<TaskRecord[]> {
    const rows = await this.prismaDb.orm.public.Task
      .orderBy((m) => m.createdAt.desc())
      .all();
    return this.mergeSummaryMirror(rows.map((row) => this.mapTaskRow(row)));
  }

  async listTasksPaginated(params: {
    page: number;
    pageSize: number;
    statusGroup: TaskStatusGroup[];
  }): Promise<PaginatedTaskResult> {
    const { page, pageSize, statusGroup } = params;
    const offset = (page - 1) * pageSize;
    const statuses = this.expandTaskStatusGroup(statusGroup);
    const counted = await this.prismaDb.orm.public.Task
      .where((m) =>
        statuses.length > 0
          ? m.status.in(statuses)
          : (m.id.isNotNull() as never),
      )
      .aggregate((f) => ({ count: f.count() }));
    const total = counted.count;
    const items = await this.prismaDb.orm.public.Task
      .where((m) =>
        statuses.length > 0
          ? m.status.in(statuses)
          : (m.id.isNotNull() as never),
      )
      .orderBy((m) => m.createdAt.desc())
      .limit(pageSize)
      .offset(offset)
      .all();
    const mapped = await this.mergeSummaryMirror(
      items.map((row) => this.mapTaskRow(row)),
    );

    return {
      items: mapped,
      page,
      pageSize,
      total,
      hasMore: offset + items.length < total,
    };
  }

  /** 获取单个任务 */
  async getTaskById(id: number): Promise<TaskRecord | undefined> {
    const row = await this.prismaDb.orm.public.Task
      .where({ id: BigInt(id) })
      .first();
    if (!row) return undefined;
    const [merged] = await this.mergeSummaryMirror([this.mapTaskRow(row)]);
    return merged;
  }

  /** 取队首 "created" 任务（调度器抢占用；当前无消费方，待 P4 处置） */
  async findNextCreatedTask(): Promise<TaskRecord | undefined> {
    const row = await this.prismaDb.orm.public.Task
      .where({ status: "created" })
      .orderBy((m) => m.createdAt.asc())
      .first();
    if (!row) return undefined;
    const [merged] = await this.mergeSummaryMirror([this.mapTaskRow(row)]);
    return merged;
  }

  /**
   * 原子抢占队首 created 任务（created → downloading）。
   * 单语句守卫更新，避免异步化后两步操作产生的并发双抢。
   */
  async claimNextCreatedTask(): Promise<TaskRecord | undefined> {
    const now = new Date().toISOString();
    const { rows } = await this.pool.query(
      `UPDATE task SET status = 'downloading', "updatedAt" = $1
       WHERE id = (
         SELECT id FROM task WHERE status = 'created' ORDER BY "createdAt" ASC LIMIT 1
       )
       RETURNING id`,
      [now],
    );
    if (rows.length === 0) {
      return undefined;
    }
    const id = Number(rows[0].id);
    this.logger.log(
      createLogMessage("Persisted task status change", {
        taskId: id,
        fromStatus: "created",
        toStatus: "downloading",
        status: "downloading",
      }),
    );
    return this.getTaskById(id);
  }

  /** 删除任务 */
  async deleteTask(id: number): Promise<void> {
    await this.prismaDb.orm.public.AnalysisSubTask
      .where({ taskId: BigInt(id) })
      .deleteAll();
    await this.prismaDb.orm.public.Task.where({ id: BigInt(id) }).delete();
    this.progressBuckets.delete(id);
    this.logger.log(
      createLogMessage("Deleted task row from database", {
        taskId: id,
      }),
    );
  }

  /** 清空所有任务 */
  async clearTasks(): Promise<void> {
    await this.prismaDb.orm.public.AnalysisSubTask
      .where((m) => m.id.isNotNull())
      .deleteAll();
    await this.prismaDb.orm.public.Task
      .where((m) => m.id.isNotNull())
      .deleteAll();
    this.progressBuckets.clear();
    this.logger.log("Cleared task table from database");
  }

  /** 按 bvid+cid 批量查询最新任务（用于前端入队去重判定） */
  async findTasksByBvidsAndCids(
    pairs: { bvid: string; cid: number }[],
  ): Promise<
    Pick<
      TaskRecord,
      | "id"
      | "bvid"
      | "cid"
      | "status"
      | "createdAt"
      | "autoSummary"
      | "summaryStatus"
    >[]
  > {
    if (pairs.length === 0) return [];
    const rows = await this.prismaDb.orm.public.Task
      .where((m) =>
        or(
          ...pairs.map((pair) =>
            and(m.bvid.eq(pair.bvid), m.cid.eq(BigInt(pair.cid))),
          ),
        ),
      )
      .orderBy((m) => m.createdAt.desc())
      .all();
    const merged = await this.mergeSummaryMirror(
      rows.map((row) => this.mapTaskRow(row)),
    );
    return merged
      .reduce(
        (acc, row) => {
          if (!acc.some((r) => r.bvid === row.bvid && r.cid === row.cid)) {
            acc.push(row);
          }
          return acc;
        },
        [] as TaskRecord[],
      )
      .map((row) => ({
        id: row.id,
        bvid: row.bvid,
        cid: row.cid,
        status: row.status,
        createdAt: row.createdAt,
        autoSummary: row.autoSummary,
        summaryStatus: row.summaryStatus,
      }));
  }

  /** 按 bvid+cid 查询最新任务 */
  async findLatestTaskByBvidAndCid(
    bvid: string,
    cid: number,
  ): Promise<TaskRecord | undefined> {
    const row = await this.prismaDb.orm.public.Task
      .where({ bvid, cid: BigInt(cid) })
      .orderBy((m) => m.createdAt.desc())
      .first();
    if (!row) return undefined;
    const [merged] = await this.mergeSummaryMirror([this.mapTaskRow(row)]);
    return merged;
  }

  /** 查询某个视频分P最近完成下载任务（用于截图源本地回退） */
  async findCompletedTaskByBvidAndCid(
    bvid: string,
    cid: number,
  ): Promise<TaskRecord | undefined> {
    const row = await this.prismaDb.orm.public.Task
      .where({ bvid, cid: BigInt(cid), status: "success" })
      .orderBy((m) => m.createdAt.desc())
      .first();
    if (!row) return undefined;
    const [merged] = await this.mergeSummaryMirror([this.mapTaskRow(row)]);
    return merged;
  }

  // ==================== 应用设置（键值） ====================

  /** 批量读取应用设置，返回 key → value（缺失的 key 不含在结果中） */
  async getSettings(keys: string[]): Promise<Record<string, string>> {
    if (keys.length === 0) return {};
    const rows = await this.prismaDb.orm.public.AppSettings
      .where((m) => m.key.in(keys))
      .all();
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value as string;
    }
    return result;
  }

  /** 批量写入应用设置（upsert），value 为空串视为删除该键 */
  async setSettings(entries: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      if (value === "") {
        await this.prismaDb.orm.public.AppSettings.where({ key }).delete();
      } else {
        await this.prismaDb.orm.public.AppSettings.upsert({
          create: { key, value },
          update: { value },
          conflictOn: { key },
        });
      }
    }
  }

  async insertAnalysisSubTask(record: AnalysisSubTaskRecord): Promise<number> {
    const created = await this.prismaDb.orm.public.AnalysisSubTask.create({
      taskId: BigInt(record.taskId),
      bvid: record.bvid ?? null,
      cid: record.cid != null ? BigInt(record.cid) : null,
      quality: record.quality ?? null,
      status: record.status ?? "created",
      outputFile: record.outputFile ?? null,
      errorMessage: record.errorMessage ?? null,
      createdAt: toInstant(record.createdAt)!,
      completedAt: toInstant(record.completedAt),
    });
    const id = Number(created.id);
    this.logger.log(
      createLogMessage("Persisted analysis sub task", {
        taskId: record.taskId,
        analysisSubTaskId: id,
        bvid: record.bvid,
        cid: record.cid,
        quality: record.quality,
        status: record.status,
      }),
    );
    return id;
  }

  async updateAnalysisSubTaskStatus(
    id: number,
    fields: {
      status: string;
      outputFile?: string;
      errorMessage?: string;
      completedAt?: string;
    },
  ): Promise<void> {
    const prevRow = await this.prismaDb.orm.public.AnalysisSubTask
      .where({ id: BigInt(id) })
      .first();
    const prev = prevRow
      ? {
          taskId: Number(prevRow.taskId),
          bvid: prevRow.bvid ?? undefined,
          cid: prevRow.cid == null ? undefined : Number(prevRow.cid),
          quality: prevRow.quality ?? undefined,
          status: prevRow.status,
        }
      : undefined;

    await this.prismaDb.orm.public.AnalysisSubTask
      .where({ id: BigInt(id) })
      .update({
        status: fields.status,
        ...(fields.outputFile !== undefined ? { outputFile: fields.outputFile } : {}),
        ...(fields.errorMessage !== undefined ? { errorMessage: fields.errorMessage } : {}),
        ...(fields.completedAt !== undefined ? { completedAt: toInstant(fields.completedAt) } : {}),
      });

    const details = {
      taskId: prev?.taskId,
      analysisSubTaskId: id,
      bvid: prev?.bvid,
      cid: prev?.cid,
      quality: prev?.quality,
      fromStatus: prev?.status,
      toStatus: fields.status,
      status: fields.status,
      outputFile: fields.outputFile,
      error: fields.errorMessage,
    };

    if (fields.status === "failed") {
      this.logger.error(
        createLogMessage("Persisted analysis sub task status change", details),
      );
    } else {
      this.logger.log(
        createLogMessage("Persisted analysis sub task status change", details),
      );
    }
  }

  /** 按资源（bvid+cid）查询分析子任务 —— 资源级键，跨任务溯源 */
  async getAnalysisSubTasks(
    bvid: string,
    cid: number,
  ): Promise<AnalysisSubTaskRecord[]> {
    const rows = await this.prismaDb.orm.public.AnalysisSubTask
      .where({ bvid, cid: BigInt(cid) })
      .orderBy((m) => m.createdAt.asc())
      .all();
    return rows.map((row) => ({
      id: Number(row.id),
      taskId: Number(row.taskId),
      bvid: row.bvid,
      cid: row.cid == null ? null : Number(row.cid),
      quality: row.quality,
      status: row.status,
      outputFile: row.outputFile,
      errorMessage: row.errorMessage,
      createdAt: toIsoString(row.createdAt),
      completedAt: toIsoString(row.completedAt),
    })) as AnalysisSubTaskRecord[];
  }

  private mapAiSummaryTaskRow(row: {
    id: bigint;
    bvid: string;
    cid: bigint;
    title: string | null;
    sourceTaskId: bigint | null;
    promptId: number | null;
    status: string;
    summaryOutput: string | null;
    errorMessage: string | null;
    executionTiming: string | null;
    rawResponse: string | null;
    modelName: string | null;
    knowledgeStatus: string | null;
    knowledgeError: string | null;
    createdAt: unknown;
    updatedAt: unknown;
    lastTriggeredAt: unknown;
    lastCompletedAt: unknown;
  }): AiSummaryTaskRecord {
    return {
      id: Number(row.id),
      bvid: row.bvid,
      cid: Number(row.cid),
      title: row.title,
      sourceTaskId: row.sourceTaskId == null ? null : Number(row.sourceTaskId),
      promptId: row.promptId,
      status: row.status,
      summaryOutput: row.summaryOutput,
      errorMessage: row.errorMessage,
      executionTiming: row.executionTiming,
      rawResponse: row.rawResponse,
      modelName: row.modelName,
      knowledgeStatus: row.knowledgeStatus,
      knowledgeError: row.knowledgeError,
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
      lastTriggeredAt: toIsoString(row.lastTriggeredAt),
      lastCompletedAt: toIsoString(row.lastCompletedAt),
    } as AiSummaryTaskRecord;
  }

  async getAiSummaryTaskByResource(
    bvid: string,
    cid: number,
  ): Promise<AiSummaryTaskRecord | undefined> {
    const row = await this.prismaDb.orm.public.AiSummaryTask
      .where({ bvid, cid: BigInt(cid) })
      .first();
    return row ? this.mapAiSummaryTaskRow(row) : undefined;
  }

  async listAiSummaryTasksPaginated(params: {
    page: number;
    pageSize: number;
    filter?: AiSummaryTaskListFilter;
  }): Promise<PaginatedAiSummaryTaskResult> {
    const { page, pageSize, filter } = params;
    const offset = (page - 1) * pageSize;
    const where = this.aiSummaryTaskWhere(filter);
    const counted = await this.prismaDb.orm.public.AiSummaryTask
      .where(where)
      .aggregate((f) => ({ count: f.count() }));
    const total = counted.count;
    const rows = await this.prismaDb.orm.public.AiSummaryTask
      .where(where)
      .orderBy((m) => m.updatedAt.desc())
      .limit(pageSize)
      .offset(offset)
      .all();

    return {
      items: rows.map((row) => this.mapAiSummaryTaskRow(row)),
      page,
      pageSize,
      total,
      hasMore: offset + rows.length < total,
    };
  }

  async getAiSummaryTaskById(
    id: number,
  ): Promise<AiSummaryTaskRecord | undefined> {
    const row = await this.prismaDb.orm.public.AiSummaryTask
      .where({ id: BigInt(id) })
      .first();
    return row ? this.mapAiSummaryTaskRow(row) : undefined;
  }

  /** 删除 AI 总结任务记录（仅删 DB，不删磁盘；进行中记录条件拒绝，避免删后被管道以新 id 复活） */
  async deleteAiSummaryTask(id: number): Promise<boolean> {
    const result = await this.prismaDb.orm.public.AiSummaryTask
      .where({ id: BigInt(id) })
      .where((m) => m.status.notIn(["pending", "analyzing"]))
      .delete();
    const deleted = Array.isArray(result) ? result.length > 0 : result != null;
    if (deleted) {
      this.logger.log(
        createLogMessage("Deleted ai_summary_task row from database", {
          summaryTaskId: id,
        }),
      );
      return true;
    }
    return false;
  }

  private aiSummaryTaskWhere(filter?: AiSummaryTaskListFilter) {
    return (m: ModelAccessor<Contract, "AiSummaryTask">) =>
      and(
        ...(filter?.status && filter.status.length > 0
          ? [m.status.in(filter.status)]
          : []),
        ...(filter?.search
          ? [m.title.ilike(`%${escapeLikePattern(filter.search)}%`)]
          : []),
        ...(filter?.updatedFrom
          ? [m.updatedAt.gte(toInstant(filter.updatedFrom))]
          : []),
        ...(filter?.updatedTo
          ? [m.updatedAt.lte(toInstant(filter.updatedTo))]
          : []),
      );
  }

  /** 原子认领 AI 总结：pending/analyzing 时拒绝认领，否则置为 pending。
   * 单语句 INSERT ... ON CONFLICT DO UPDATE WHERE，PostgreSQL 保证互斥，防并发双跑。
   * 守卫语义无 Prisma 等价表达，保留 raw SQL（master plan 既定约束）。
   */
  async claimAiSummaryTask(record: {
    bvid: string;
    cid: number;
    title?: string;
    sourceTaskId?: number;
    promptId?: number;
  }): Promise<{ claimed: boolean; record: AiSummaryTaskRecord | undefined }> {
    const now = new Date().toISOString();
    const res = await this.pool.query(
      `
        INSERT INTO ai_summary_task (
          bvid, cid, title, source_task_id, prompt_id, status, summary_output, error_message,
          created_at, updated_at, last_triggered_at, last_completed_at
        )
        VALUES (
          $1, $2, $3, $4, $5, 'pending', NULL, NULL,
          $6, $6, $6, NULL
        )
        ON CONFLICT (bvid, cid) DO UPDATE SET
          title = EXCLUDED.title,
          source_task_id = EXCLUDED.source_task_id,
          prompt_id = EXCLUDED.prompt_id,
          status = 'pending',
          execution_timing = NULL,
          raw_response = NULL,
          model_name = NULL,
          updated_at = EXCLUDED.updated_at,
          last_triggered_at = EXCLUDED.last_triggered_at
        WHERE ai_summary_task.status NOT IN ('pending', 'analyzing')
      `,
      [
        record.bvid,
        record.cid,
        record.title ?? null,
        record.sourceTaskId ?? null,
        record.promptId ?? null,
        now,
      ],
    );

    return {
      claimed: (res.rowCount ?? 0) > 0,
      record: await this.getAiSummaryTaskByResource(record.bvid, record.cid),
    };
  }

  /**
   * 启动对账：低清下载队列为进程内存态，重启即失效。
   * 遗留 created 子任务标 failed；遗留 pending/analyzing 的总结标 failed。
   * ai_summary_task 为状态单一来源，task 镜像由读取侧 JOIN 覆盖，无需同步。
   */
  async reconcileStaleAnalysisState(): Promise<{
    failedSubTasks: number;
    failedSummaryTasks: number;
  }> {
    const now = new Date().toISOString();
    const lowResMsg = "服务重启，低清下载中断";
    const summaryMsg = "服务重启，AI 总结中断，请重新触发";

    const subRes = await this.prismaDb.orm.public.AnalysisSubTask
      .where((m) => m.status.in(["created"]))
      .updateAll({
        status: "failed",
        errorMessage: lowResMsg,
        completedAt: toInstant(now),
      });

    const sumRes = await this.prismaDb.orm.public.AiSummaryTask
      .where((m) => m.status.in(["pending", "analyzing"]))
      .updateAll({
        status: "failed",
        errorMessage: summaryMsg,
        updatedAt: toInstant(now),
        lastCompletedAt: toInstant(now),
      });

    return {
      failedSubTasks: subRes.length,
      failedSummaryTasks: sumRes.length,
    };
  }

  async upsertAiSummaryTask(
    record: AiSummaryTaskRecord,
  ): Promise<AiSummaryTaskRecord> {
    const now = new Date().toISOString();
    const existing = await this.getAiSummaryTaskByResource(
      record.bvid,
      record.cid,
    );
    const createdAt = existing?.createdAt ?? record.createdAt ?? now;
    // promptId 未提供时保留既有值（认领时写入本次解析结果，终态更新/普通状态更新不覆盖）
    const promptId =
      record.promptId !== undefined
        ? record.promptId
        : (existing?.promptId ?? null);
    // executionTiming 未提供时保留既有值（避免普通状态更新清空最近成功耗时）
    const executionTiming =
      record.executionTiming !== undefined
        ? record.executionTiming
        : (existing?.executionTiming ?? null);
    // rawResponse/modelName 未提供时保留既有值（与 executionTiming 同语义；
    // 新一次认领已把它们清空，终态才写入本次结果：成功=模型返回 content 原文，失败=错误信息）
    const rawResponse =
      record.rawResponse !== undefined
        ? record.rawResponse
        : (existing?.rawResponse ?? null);
    const modelName =
      record.modelName !== undefined
        ? record.modelName
        : (existing?.modelName ?? null);
    await this.prismaDb.orm.public.AiSummaryTask.upsert({
      create: {
        bvid: record.bvid,
        cid: BigInt(record.cid),
        title: record.title ?? null,
        sourceTaskId: record.sourceTaskId != null ? BigInt(record.sourceTaskId) : null,
        promptId: promptId ?? null,
        status: record.status,
        summaryOutput: record.summaryOutput ?? null,
        errorMessage: record.errorMessage ?? null,
        executionTiming,
        rawResponse,
        modelName,
        createdAt: toInstant(createdAt)!,
        updatedAt: toInstant(record.updatedAt ?? now)!,
        lastTriggeredAt: toInstant(record.lastTriggeredAt),
        lastCompletedAt: toInstant(record.lastCompletedAt),
      },
      update: {
        title: record.title ?? null,
        sourceTaskId: record.sourceTaskId != null ? BigInt(record.sourceTaskId) : null,
        promptId: promptId ?? null,
        status: record.status,
        summaryOutput: record.summaryOutput ?? null,
        errorMessage: record.errorMessage ?? null,
        executionTiming,
        rawResponse,
        modelName,
        updatedAt: toInstant(record.updatedAt ?? now)!,
        lastTriggeredAt: toInstant(record.lastTriggeredAt),
        lastCompletedAt: toInstant(record.lastCompletedAt),
      },
      conflictOn: { bvid: record.bvid, cid: BigInt(record.cid) },
    });

    const persisted = await this.getAiSummaryTaskByResource(
      record.bvid,
      record.cid,
    );
    if (!persisted) {
      throw new Error("AI summary task upsert failed");
    }

    this.logger.log(
      createLogMessage("Persisted AI summary task", {
        bvid: persisted.bvid,
        cid: persisted.cid,
        taskId: persisted.sourceTaskId,
        status: persisted.status,
        summaryStatus: persisted.status,
      }),
    );

    return persisted;
  }

  // ==================== AI 总结提示词（ai_prompt / ai_prompt_creator） ====================

  /** 提示词列表：内置排前，其余按创建时间升序 */
  async listAiPrompts(): Promise<AiPromptRecord[]> {
    const rows = await this.prismaDb.orm.public.AiPrompt
      .orderBy([(m) => m.isSystem.desc(), (m) => m.createdAt.asc()])
      .all();
    return rows.map((row) => ({
      id: bigintToNumber(row.id),
      name: row.name,
      content: row.content,
      isSystem: row.isSystem ?? undefined,
      isDefault: row.isDefault ?? undefined,
      createdAt: toIsoString(row.createdAt) ?? undefined,
      updatedAt: toIsoString(row.updatedAt) ?? undefined,
    }));
  }

  async getAiPromptById(id: number): Promise<AiPromptRecord | undefined> {
    const row = await this.prismaDb.orm.public.AiPrompt
      .where({ id: BigInt(id) })
      .first();
    if (!row) return undefined;
    return {
      id: bigintToNumber(row.id),
      name: row.name,
      content: row.content,
      isSystem: row.isSystem ?? undefined,
      isDefault: row.isDefault ?? undefined,
      createdAt: toIsoString(row.createdAt) ?? undefined,
      updatedAt: toIsoString(row.updatedAt) ?? undefined,
    };
  }

  async insertAiPrompt(record: {
    name: string;
    content: string;
    isSystem?: number;
    isDefault?: number;
  }): Promise<AiPromptRecord> {
    const now = Temporal.Instant.fromEpochMilliseconds(Date.now());
    const created = await this.prismaDb.orm.public.AiPrompt.create({
      name: record.name,
      content: record.content,
      isSystem: record.isSystem ?? 0,
      isDefault: record.isDefault ?? 0,
      createdAt: now,
      updatedAt: now,
    });
    const id = bigintToNumber(created.id)!;
    this.logger.log(
      createLogMessage("Persisted AI summary prompt", {
        promptId: id,
        isDefault: record.isDefault ?? 0,
        isSystem: record.isSystem ?? 0,
      }),
    );
    const persisted = await this.getAiPromptById(id);
    if (!persisted) {
      throw new Error("AI prompt insert failed");
    }
    return persisted;
  }

  async updateAiPrompt(
    id: number,
    fields: { name?: string; content?: string },
  ): Promise<AiPromptRecord | undefined> {
    const now = Temporal.Instant.fromEpochMilliseconds(Date.now());
    await this.prismaDb.orm.public.AiPrompt.where({ id: BigInt(id) }).update({
      updatedAt: now,
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.content !== undefined ? { content: fields.content } : {}),
    });
    return this.getAiPromptById(id);
  }

  async deleteAiPrompt(id: number): Promise<void> {
    await this.prismaDb.orm.public.AiPrompt.where({ id: BigInt(id) }).delete();
    this.logger.log(
      createLogMessage("Deleted AI summary prompt", {
        promptId: id,
      }),
    );
  }

  async clearAiPromptDefault(): Promise<void> {
    await this.prismaDb.orm.public.AiPrompt
      .where((m) => m.id.isNotNull())
      .updateAll({ isDefault: 0 });
  }

  async setAiPromptDefault(id: number): Promise<void> {
    await this.prismaDb.orm.public.AiPrompt.where({ id: BigInt(id) }).update({
      isDefault: 1,
      updatedAt: Temporal.Instant.fromEpochMilliseconds(Date.now()),
    });
  }

  async getDefaultAiPromptId(): Promise<number | undefined> {
    const row = await this.prismaDb.orm.public.AiPrompt
      .where({ isDefault: 1 })
      .first();
    return bigintToNumber(row?.id);
  }

  async getCreatorBindingByMid(
    mid: number,
  ): Promise<{ mid: number; promptId: number } | undefined> {
    const row = await this.prismaDb.orm.public.AiPromptCreator
      .where({ mid: BigInt(mid) })
      .first();
    if (!row) return undefined;
    return { mid: bigintToNumber(row.mid)!, promptId: bigintToNumber(row.promptId)! };
  }

  async upsertCreatorBinding(mid: number, promptId: number): Promise<void> {
    await this.prismaDb.orm.public.AiPromptCreator.upsert({
      create: { mid: BigInt(mid), promptId: BigInt(promptId) },
      update: { promptId: BigInt(promptId) },
      conflictOn: { mid: BigInt(mid) },
    });
    this.logger.log(
      createLogMessage("Persisted AI prompt creator binding", {
        mid,
        promptId,
      }),
    );
  }

  async deleteCreatorBinding(mid: number): Promise<void> {
    await this.prismaDb.orm.public.AiPromptCreator
      .where({ mid: BigInt(mid) })
      .delete();
    this.logger.log(
      createLogMessage("Deleted AI prompt creator binding", {
        mid,
      }),
    );
  }

  // ==================== 云端知识库（summary / summary_segment） ====================

  /**
   * 事务内 upsert 一份总结的知识内容（summary + 全量 segments）。
   * 幂等：按 (bvid,cid) 冲突更新 summary，删除该 summary 的旧 segments 后重插。
   */
  async upsertSummaryKnowledge(args: {
    bvid: string;
    cid: number;
    videoTitle: string;
    videoUrl?: string;
    modelName?: string;
    rawResponse: string;
    segments: Array<{
      seq: number;
      title: string;
      content: string;
      timestampSeconds?: number;
      frameDescription?: string;
      screenshotUrl?: string;
    }>;
  }): Promise<void> {
    const parsedRawResponse = JSON.parse(args.rawResponse);
    const now = Temporal.Instant.fromEpochMilliseconds(Date.now());
    const summaryId = await this.prismaDb.transaction(async (tx) => {
      const upserted = await tx.orm.public.Summary.upsert({
        create: {
          bvid: args.bvid,
          cid: BigInt(args.cid),
          videoTitle: args.videoTitle,
          videoUrl: args.videoUrl ?? null,
          modelName: args.modelName ?? null,
          rawResponse: parsedRawResponse,
          createdAt: now,
          updatedAt: now,
        },
        update: {
          videoTitle: args.videoTitle,
          videoUrl: args.videoUrl ?? null,
          modelName: args.modelName ?? null,
          rawResponse: parsedRawResponse,
          updatedAt: now,
        },
        conflictOn: { bvid: args.bvid, cid: BigInt(args.cid) },
      });
      const id = bigintToNumber(upserted.id)!;
      await tx.orm.public.SummarySegment
        .where({ summaryId: BigInt(id) })
        .deleteAll();
      for (const segment of args.segments) {
        await tx.orm.public.SummarySegment.create({
          summaryId: BigInt(id),
          seq: segment.seq,
          title: segment.title,
          content: segment.content,
          timestampSeconds: segment.timestampSeconds ?? null,
          frameDescription: segment.frameDescription ?? null,
          screenshotUrl: segment.screenshotUrl ?? null,
        });
      }
      return id;
    });
    this.logger.log(
      createLogMessage("Published summary knowledge to cloud", {
        bvid: args.bvid,
        cid: args.cid,
        summaryId,
        segmentCount: args.segments.length,
      }),
    );
  }

  /** 更新 AI 总结任务的知识发布状态 */
  async updateSummaryKnowledgeStatus(
    bvid: string,
    cid: number,
    status: string,
    error?: string,
  ): Promise<void> {
    await this.prismaDb.orm.public.AiSummaryTask
      .where({ bvid, cid: BigInt(cid) })
      .update({
        knowledgeStatus: status,
        knowledgeError: error ?? null,
        updatedAt: Temporal.Instant.fromEpochMilliseconds(Date.now()),
      });
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function bigintToNumber(value: bigint | number | null | undefined): number | undefined {
  return value == null ? undefined : Number(value);
}

function toIsoString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "epochMilliseconds" in (value as object)) {
    return new Date(
      (value as { epochMilliseconds: number }).epochMilliseconds,
    ).toISOString();
  }
  return new Date(value as Date).toISOString();
}

function toInstant(
  value: string | Date | Temporal.Instant | null | undefined,
): Temporal.Instant | null {
  if (value == null) return null;
  if (typeof value === "string") return Temporal.Instant.from(value);
  if (value instanceof Date) {
    return Temporal.Instant.fromEpochMilliseconds(value.getTime());
  }
  return value;
}

function toIsoTimestamp(value: string): string {
  const match =
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2}:?\d{2})?$/.exec(
      value,
    );
  if (match) {
    let offset = match[3] ?? "";
    if (/^[+-]\d{2}$/.test(offset)) offset = `${offset}:00`;
    if (/^[+-]\d{4}$/.test(offset)) {
      offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
    }
    const date = new Date(`${match[1]}T${match[2]}${offset}`);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  const fallback = new Date(value);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback.toISOString();
  }
  return value;
}

function sanitizeDatabaseUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    url.password = "****";
    return url.toString();
  } catch {
    return "<invalid database url>";
  }
}
