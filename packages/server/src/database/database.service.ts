import { Injectable, Logger } from "@nestjs/common";
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { createLogMessage } from "../logging/server-log.util.js";
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
  status: string;
  summaryOutput?: string;
  errorMessage?: string;
  executionTiming?: string;
  /** 本次执行记录：成功=模型返回 content 原文；失败=错误信息 */
  rawResponse?: string;
  modelName?: string;
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
  status?: string;
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
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly db: Database.Database;
  private readonly progressBuckets = new Map<number, number>();

  constructor() {
    const outputDir =
      process.env.OUTPUT_DIR ?? join(process.cwd(), "downloads");
    const dbPath = join(outputDir, "tasks.db");

    // ensureOutputDir before opening db
    mkdirSync(outputDir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
    this.logger.log(
      createLogMessage("SQLite database connected", {
        outputPath: dbPath,
        sourceType: "sqlite",
      }),
    );
  }

  // ==================== Schema ====================

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bvid TEXT,
        cid INTEGER,
        title TEXT,
        quality INTEGER,
        codec TEXT,
        outputPath TEXT,
        subtitle_lang TEXT,
        auto_summary INTEGER DEFAULT 0,
        summary_status TEXT DEFAULT 'none',
        summary_output TEXT,
        status TEXT NOT NULL DEFAULT 'created',
        progress REAL DEFAULT 0,
        speed TEXT,
        outputFile TEXT,
        fileSize INTEGER,
        errorCode TEXT,
        errorMessage TEXT,
        durationMs INTEGER,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        completedAt TEXT
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_task_status ON task(status);
      CREATE INDEX IF NOT EXISTS idx_task_created ON task(createdAt);
      CREATE INDEX IF NOT EXISTS idx_task_bvid_cid ON task(bvid, cid);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_sub_task (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        bvid TEXT,
        cid INTEGER,
        quality INTEGER,
        status TEXT NOT NULL DEFAULT 'created',
        output_file TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (task_id) REFERENCES task(id)
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_analysis_sub_task_task_id
      ON analysis_sub_task(task_id);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_summary_task (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bvid TEXT NOT NULL,
        cid INTEGER NOT NULL,
        title TEXT,
        source_task_id INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        summary_output TEXT,
        error_message TEXT,
        raw_response TEXT,
        model_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_triggered_at TEXT,
        last_completed_at TEXT,
        UNIQUE (bvid, cid)
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ai_summary_task_updated_at
      ON ai_summary_task(updated_at DESC);
    `);

    // 已有数据库升级: ai_summary_task 补充执行耗时列
    try {
      this.db.exec(`ALTER TABLE ai_summary_task ADD COLUMN execution_timing TEXT`);
    } catch {
      // 列已存在的忽略
    }

    // 已有数据库升级: ai_summary_task 补充模型原始返回与模型名列
    try {
      this.db.exec(`ALTER TABLE ai_summary_task ADD COLUMN raw_response TEXT`);
    } catch {
      // 列已存在的忽略
    }
    try {
      this.db.exec(`ALTER TABLE ai_summary_task ADD COLUMN model_name TEXT`);
    } catch {
      // 列已存在的忽略
    }

    // 已有数据库升级: 补充 subtitle_lang 列
    try {
      this.db.exec(`ALTER TABLE task ADD COLUMN subtitle_lang TEXT`);
    } catch {
      // 列已存在的忽略
    }
    try {
      this.db.exec(
        `ALTER TABLE task ADD COLUMN auto_summary INTEGER DEFAULT 0`,
      );
    } catch {
      // 列已存在的忽略
    }
    try {
      this.db.exec(
        `ALTER TABLE task ADD COLUMN summary_status TEXT DEFAULT 'none'`,
      );
    } catch {
      // 列已存在的忽略
    }
    try {
      this.db.exec(`ALTER TABLE task ADD COLUMN summary_output TEXT`);
    } catch {
      // 列已存在的忽略
    }
    try {
      this.db.exec(`ALTER TABLE task ADD COLUMN fileNameTemplate TEXT`);
    } catch {
      // 列已存在的忽略
    }

    // 状态单一来源迁移：把历史 task.summary_status 合并进 ai_summary_task（幂等）
    // ai_summary_task 是 AI 总结状态的唯一权威；此后不再向 task 写入 summary 状态。
    this.db.exec(`
      INSERT OR IGNORE INTO ai_summary_task (
        bvid, cid, title, status, summary_output, error_message,
        created_at, updated_at, last_triggered_at, last_completed_at
      )
      SELECT
        t.bvid, t.cid, t.title, t.summary_status, t.summary_output, NULL,
        COALESCE(t.completedAt, t.createdAt, datetime('now')),
        COALESCE(t.completedAt, t.createdAt, datetime('now')),
        NULL,
        CASE
          WHEN t.summary_status = 'completed' THEN COALESCE(t.completedAt, t.createdAt)
          ELSE NULL
        END
      FROM task t
      WHERE t.bvid IS NOT NULL
        AND t.cid IS NOT NULL
        AND t.summary_status IS NOT NULL
        AND t.summary_status != 'none'
    `);

    // 子任务资源级键迁移：analysis_sub_task 按 (bvid,cid,quality) 活跃唯一
    // 先对同组重复记录去重（保留最新 id，其余标 failed），再建部分唯一索引（幂等）。
    // 部分索引（WHERE status != 'failed'）允许保留失败历史行，同时强制活跃行唯一。
    try {
      this.db.exec(`
        UPDATE analysis_sub_task
        SET status = 'failed',
            error_message = COALESCE(error_message, 'superseded by newer record')
        WHERE id NOT IN (
          SELECT MAX(id) FROM analysis_sub_task GROUP BY bvid, cid, quality
        )
      `);
      this.db.exec(`
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

  private readonly taskSelectSql = `
    SELECT
      t.id,
      t.bvid,
      t.cid,
      t.title,
      t.quality,
      t.codec,
      t.fileNameTemplate,
      t.outputPath,
      t.subtitle_lang AS subtitleLang,
      t.auto_summary AS autoSummary,
      ast.status AS summaryStatus,
      ast.summary_output AS summaryOutput,
      t.status,
      t.progress,
      t.speed,
      t.outputFile,
      t.fileSize,
      t.errorCode,
      t.errorMessage,
      t.durationMs,
      t.createdAt,
      t.updatedAt,
      t.completedAt
    FROM task t
    LEFT JOIN ai_summary_task ast
      ON ast.bvid = t.bvid AND ast.cid = t.cid
  `;

  private readonly aiSummaryTaskSelectSql = `
    SELECT
      id,
      bvid,
      cid,
      title,
      source_task_id AS sourceTaskId,
      status,
      summary_output AS summaryOutput,
      error_message AS errorMessage,
      execution_timing AS executionTiming,
      raw_response AS rawResponse,
      model_name AS modelName,
      created_at AS createdAt,
      updated_at AS updatedAt,
      last_triggered_at AS lastTriggeredAt,
      last_completed_at AS lastCompletedAt
    FROM ai_summary_task
  `;

  /** 插入新任务，返回自增 id */
  insertTask(record: TaskRecord): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO task (bvid, cid, title, quality, codec, fileNameTemplate, outputPath, subtitle_lang, status, progress, speed,
            auto_summary, summary_status, summary_output,
                        outputFile, fileSize, errorCode, errorMessage, durationMs,
                        createdAt, updatedAt, completedAt)
      VALUES (@bvid, @cid, @title, @quality, @codec, @fileNameTemplate, @outputPath, @subtitleLang, @status, @progress, @speed,
              @autoSummary, @summaryStatus, @summaryOutput,
              @outputFile, @fileSize, @errorCode, @errorMessage, @durationMs,
              @createdAt, @updatedAt, @completedAt)
    `);
    const result = stmt.run({
      bvid: record.bvid ?? null,
      cid: record.cid ?? null,
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
      outputFile: record.outputFile ?? null,
      fileSize: record.fileSize ?? null,
      errorCode: record.errorCode ?? null,
      errorMessage: record.errorMessage ?? null,
      durationMs: record.durationMs ?? null,
      createdAt: record.createdAt ?? now,
      updatedAt: now,
      completedAt: record.completedAt ?? null,
    });
    const id = Number(result.lastInsertRowid);
    this.logger.log(
      createLogMessage("Persisted download task", {
        taskId: id,
        bvid: record.bvid,
        cid: record.cid,
        status: record.status,
        quality: record.quality,
        codec: record.codec,
        autoSummary: record.autoSummary,
        outputPath: record.outputPath,
      }),
    );
    return id;
  }

  /** 更新任务进度（每秒调用一次） */
  updateTaskProgress(id: number, progress: number, speed?: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE task SET progress = @progress, speed = @speed, updatedAt = @updatedAt WHERE id = @id",
      )
      .run({ id, progress, speed: speed ?? null, updatedAt: now });

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

  /** 更新任务状态（完成/失败时）。AI 总结状态由 ai_summary_task 单一来源，不在此写入。 */
  updateTaskStatus(
    id: number,
    fields: {
      status: string;
      autoSummary?: number;
      outputFile?: string;
      fileSize?: number;
      errorCode?: string;
      errorMessage?: string;
      durationMs?: number;
      progress?: number;
    },
  ): void {
    const previous = this.getTaskById(id);
    const now = new Date().toISOString();
    const setClauses: string[] = ["status = @status", "updatedAt = @updatedAt"];
    if (fields.autoSummary !== undefined)
      setClauses.push("auto_summary = @autoSummary");
    if (fields.outputFile !== undefined)
      setClauses.push("outputFile = @outputFile");
    if (fields.fileSize !== undefined) setClauses.push("fileSize = @fileSize");
    if (fields.errorCode !== undefined)
      setClauses.push("errorCode = @errorCode");
    if (fields.errorMessage !== undefined)
      setClauses.push("errorMessage = @errorMessage");
    if (fields.durationMs !== undefined)
      setClauses.push("durationMs = @durationMs");
    if (fields.progress !== undefined) setClauses.push("progress = @progress");
    if (fields.status === "success" || fields.status === "failed") {
      setClauses.push("completedAt = @completedAt");
    }
    this.db
      .prepare(`UPDATE task SET ${setClauses.join(", ")} WHERE id = @id`)
      .run({
        id,
        status: fields.status,
        autoSummary: fields.autoSummary ?? null,
        outputFile: fields.outputFile ?? null,
        fileSize: fields.fileSize ?? null,
        errorCode: fields.errorCode ?? null,
        errorMessage: fields.errorMessage ?? null,
        durationMs: fields.durationMs ?? null,
        progress: fields.progress ?? null,
        updatedAt: now,
        completedAt:
          fields.status === "success" || fields.status === "failed"
            ? now
            : null,
      });

    const statusChanged = previous?.status !== fields.status;
    const shouldLog =
      statusChanged ||
      fields.errorMessage !== undefined ||
      fields.outputFile !== undefined ||
      fields.autoSummary !== undefined ||
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

  /** 获取所有任务 */
  getTasks(): TaskRecord[] {
    return this.db
      .prepare(`${this.taskSelectSql} ORDER BY t.createdAt DESC`)
      .all() as TaskRecord[];
  }

  listTasksPaginated(params: {
    page: number;
    pageSize: number;
    statusGroup: TaskStatusGroup;
  }): PaginatedTaskResult {
    const { page, pageSize, statusGroup } = params;
    const offset = (page - 1) * pageSize;
    const { whereClause, queryParams } = this.buildTaskStatusFilter(statusGroup);
    const totalRow = this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM task t ${whereClause}`,
      )
      .get(...queryParams) as { total: number };
    const items = this.db
      .prepare(
        `${this.taskSelectSql}
         ${whereClause}
         ORDER BY t.createdAt DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...queryParams, pageSize, offset) as TaskRecord[];

    return {
      items,
      page,
      pageSize,
      total: totalRow.total,
      hasMore: offset + items.length < totalRow.total,
    };
  }

  /** 获取单个任务 */
  getTaskById(id: number): TaskRecord | undefined {
    return this.db.prepare(`${this.taskSelectSql} WHERE t.id = ?`).get(id) as
      | TaskRecord
      | undefined;
  }

  /** 取队首 "created" 任务（调度器抢占用） */
  findNextCreatedTask(): TaskRecord | undefined {
    return this.db
      .prepare(
        `${this.taskSelectSql} WHERE t.status = 'created' ORDER BY t.createdAt ASC LIMIT 1`,
      )
      .get() as TaskRecord | undefined;
  }

  /** 删除任务 */
  deleteTask(id: number): void {
    this.db.prepare("DELETE FROM analysis_sub_task WHERE task_id = ?").run(id);
    this.db.prepare("DELETE FROM task WHERE id = ?").run(id);
    this.progressBuckets.delete(id);
    this.logger.log(
      createLogMessage("Deleted task row from database", {
        taskId: id,
      }),
    );
  }

  /** 清空所有任务 */
  clearTasks(): void {
    this.db.prepare("DELETE FROM analysis_sub_task").run();
    this.db.prepare("DELETE FROM task").run();
    this.progressBuckets.clear();
    this.logger.log("Cleared task table from database");
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
  }

  /** 按 bvid+cid 批量查询最新任务（用于前端入队去重判定） */
  findTasksByBvidsAndCids(
    pairs: { bvid: string; cid: number }[],
  ): Pick<
    TaskRecord,
    "id" | "bvid" | "cid" | "status" | "createdAt" | "autoSummary"
  >[] {
    if (pairs.length === 0) return [];
    const placeholders = pairs.map(() => "(?, ?)").join(", ");
    const params = pairs.flatMap((p) => [p.bvid, p.cid]);
    return (
      this.db
        .prepare(
          `SELECT id, bvid, cid, status, createdAt, auto_summary AS autoSummary FROM task
           WHERE (bvid, cid) IN (${placeholders})
           ORDER BY createdAt DESC`,
        )
        .all(...params) as Pick<
        TaskRecord,
        "id" | "bvid" | "cid" | "status" | "createdAt" | "autoSummary"
      >[]
    ).reduce(
      (acc, row) => {
        if (!acc.some((r) => r.bvid === row.bvid && r.cid === row.cid)) {
          acc.push(row);
        }
        return acc;
      },
      [] as Pick<
        TaskRecord,
        "id" | "bvid" | "cid" | "status" | "createdAt" | "autoSummary"
      >[],
    );
  }

  /** 按 bvid+cid 查询最新任务 */
  findLatestTaskByBvidAndCid(
    bvid: string,
    cid: number,
  ): TaskRecord | undefined {
    return this.db
      .prepare(
        `${this.taskSelectSql}
         WHERE t.bvid = ? AND t.cid = ?
         ORDER BY t.createdAt DESC
         LIMIT 1`,
      )
      .get(bvid, cid) as TaskRecord | undefined;
  }

  /** 查询某个视频分P最近完成下载任务（用于截图源本地回退） */
  findCompletedTaskByBvidAndCid(
    bvid: string,
    cid: number,
  ): TaskRecord | undefined {
    return this.db
      .prepare(
        `${this.taskSelectSql}
         WHERE t.bvid = ? AND t.cid = ? AND t.status = 'success'
         ORDER BY t.createdAt DESC
         LIMIT 1`,
      )
      .get(bvid, cid) as TaskRecord | undefined;
  }

  insertAnalysisSubTask(record: AnalysisSubTaskRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO analysis_sub_task (
        task_id, bvid, cid, quality, status, output_file, error_message, created_at, completed_at
      )
      VALUES (
        @taskId, @bvid, @cid, @quality, @status, @outputFile, @errorMessage, @createdAt, @completedAt
      )
    `);
    const result = stmt.run({
      taskId: record.taskId,
      bvid: record.bvid ?? null,
      cid: record.cid ?? null,
      quality: record.quality ?? null,
      status: record.status ?? "created",
      outputFile: record.outputFile ?? null,
      errorMessage: record.errorMessage ?? null,
      createdAt: record.createdAt,
      completedAt: record.completedAt ?? null,
    });
    const id = Number(result.lastInsertRowid);
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

  updateAnalysisSubTaskStatus(
    id: number,
    fields: {
      status: string;
      outputFile?: string;
      errorMessage?: string;
      completedAt?: string;
    },
  ): void {
    const previous = this.db
      .prepare(
        `
        SELECT task_id AS taskId, bvid, cid, quality, status
        FROM analysis_sub_task
        WHERE id = ?
      `,
      )
      .get(id) as
      | {
          taskId: number;
          bvid?: string;
          cid?: number;
          quality?: number;
          status: string;
        }
      | undefined;

    const setClauses: string[] = ["status = @status"];
    if (fields.outputFile !== undefined)
      setClauses.push("output_file = @outputFile");
    if (fields.errorMessage !== undefined)
      setClauses.push("error_message = @errorMessage");
    if (fields.completedAt !== undefined)
      setClauses.push("completed_at = @completedAt");

    this.db
      .prepare(
        `UPDATE analysis_sub_task SET ${setClauses.join(", ")} WHERE id = @id`,
      )
      .run({
        id,
        status: fields.status,
        outputFile: fields.outputFile ?? null,
        errorMessage: fields.errorMessage ?? null,
        completedAt: fields.completedAt ?? null,
      });

    const details = {
      taskId: previous?.taskId,
      analysisSubTaskId: id,
      bvid: previous?.bvid,
      cid: previous?.cid,
      quality: previous?.quality,
      fromStatus: previous?.status,
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
  getAnalysisSubTasks(bvid: string, cid: number): AnalysisSubTaskRecord[] {
    return this.db
      .prepare(
        `
        SELECT
          id,
          task_id AS taskId,
          bvid,
          cid,
          quality,
          status,
          output_file AS outputFile,
          error_message AS errorMessage,
          created_at AS createdAt,
          completed_at AS completedAt
        FROM analysis_sub_task
        WHERE bvid = ? AND cid = ?
        ORDER BY created_at ASC
      `,
      )
      .all(bvid, cid) as AnalysisSubTaskRecord[];
  }

  getAiSummaryTaskByResource(
    bvid: string,
    cid: number,
  ): AiSummaryTaskRecord | undefined {
    return this.db
      .prepare(
        `${this.aiSummaryTaskSelectSql}
         WHERE bvid = ? AND cid = ?
         LIMIT 1`,
      )
      .get(bvid, cid) as AiSummaryTaskRecord | undefined;
  }

  listAiSummaryTasksPaginated(params: {
    page: number;
    pageSize: number;
    filter?: AiSummaryTaskListFilter;
  }): PaginatedAiSummaryTaskResult {
    const { page, pageSize, filter } = params;
    const offset = (page - 1) * pageSize;
    const { whereClause, queryParams } = this.buildAiSummaryTaskFilter(filter);
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM ai_summary_task ${whereClause}`)
      .get(...queryParams) as { total: number };
    const items = this.db
      .prepare(
        `${this.aiSummaryTaskSelectSql}
         ${whereClause}
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...queryParams, pageSize, offset) as AiSummaryTaskRecord[];

    return {
      items,
      page,
      pageSize,
      total: totalRow.total,
      hasMore: offset + items.length < totalRow.total,
    };
  }

  getAiSummaryTaskById(id: number): AiSummaryTaskRecord | undefined {
    return this.db
      .prepare(`${this.aiSummaryTaskSelectSql} WHERE id = ? LIMIT 1`)
      .get(id) as AiSummaryTaskRecord | undefined;
  }

  /** 删除 AI 总结任务记录（仅删 DB，不删磁盘；进行中记录条件拒绝，避免删后被管道以新 id 复活） */
  deleteAiSummaryTask(id: number): boolean {
    const result = this.db
      .prepare(
        "DELETE FROM ai_summary_task WHERE id = ? AND status NOT IN ('pending', 'analyzing')",
      )
      .run(id);
    if (result.changes > 0) {
      this.logger.log(
        createLogMessage("Deleted ai_summary_task row from database", {
          summaryTaskId: id,
        }),
      );
      return true;
    }
    return false;
  }

  private buildTaskStatusFilter(statusGroup: TaskStatusGroup): {
    whereClause: string;
    queryParams: Array<string>;
  } {
    switch (statusGroup) {
      case "active":
        return {
          whereClause: "WHERE t.status IN (?, ?)",
          queryParams: ["created", "downloading"],
        };
      case "created":
      case "downloading":
      case "success":
      case "failed":
      case "stopped":
        return {
          whereClause: "WHERE t.status = ?",
          queryParams: [statusGroup],
        };
      case "all":
      default:
        return {
          whereClause: "",
          queryParams: [],
        };
    }
  }

  private buildAiSummaryTaskFilter(filter?: AiSummaryTaskListFilter): {
    whereClause: string;
    queryParams: Array<string>;
  } {
    const clauses: string[] = [];
    const params: string[] = [];

    if (filter?.status && filter.status !== "all") {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter?.search) {
      clauses.push("COALESCE(title, '') LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLikePattern(filter.search)}%`);
    }
    if (filter?.updatedFrom) {
      clauses.push("updated_at >= ?");
      params.push(filter.updatedFrom);
    }
    if (filter?.updatedTo) {
      clauses.push("updated_at <= ?");
      params.push(filter.updatedTo);
    }

    if (clauses.length === 0) {
      return { whereClause: "", queryParams: [] };
    }
    return {
      whereClause: `WHERE ${clauses.join(" AND ")}`,
      queryParams: params,
    };
  }

  /**
   * 原子认领 AI 总结：pending/analyzing 时拒绝认领，否则置为 pending。
   * 单进程 + better-sqlite3 同步事务内保证互斥，防并发双跑。
   */
  claimAiSummaryTask(record: {
    bvid: string;
    cid: number;
    title?: string;
    sourceTaskId?: number;
  }): { claimed: boolean; record: AiSummaryTaskRecord | undefined } {
    const now = new Date().toISOString();
    const res = this.db
      .prepare(
        `
        INSERT INTO ai_summary_task (
          bvid, cid, title, source_task_id, status, summary_output, error_message,
          created_at, updated_at, last_triggered_at, last_completed_at
        )
        VALUES (
          @bvid, @cid, @title, @sourceTaskId, 'pending', NULL, NULL,
          @now, @now, @now, NULL
        )
        ON CONFLICT(bvid, cid) DO UPDATE SET
          title = excluded.title,
          source_task_id = excluded.source_task_id,
          status = 'pending',
          execution_timing = NULL,
          raw_response = NULL,
          model_name = NULL,
          updated_at = @now,
          last_triggered_at = @now
        WHERE status NOT IN ('pending', 'analyzing')
      `,
      )
      .run({
        bvid: record.bvid,
        cid: record.cid,
        title: record.title ?? null,
        sourceTaskId: record.sourceTaskId ?? null,
        now,
      });

    return {
      claimed: res.changes > 0,
      record: this.getAiSummaryTaskByResource(record.bvid, record.cid),
    };
  }

  /**
   * 启动对账：低清下载队列为进程内存态，重启即失效。
   * 遗留 created 子任务标 failed；遗留 pending/analyzing 的总结标 failed。
   * ai_summary_task 为状态单一来源，task 镜像由读取侧 JOIN 覆盖，无需同步。
   */
  reconcileStaleAnalysisState(): {
    failedSubTasks: number;
    failedSummaryTasks: number;
  } {
    const now = new Date().toISOString();
    const lowResMsg = "服务重启，低清下载中断";
    const summaryMsg = "服务重启，AI 总结中断，请重新触发";

    const subRes = this.db
      .prepare(
        `UPDATE analysis_sub_task SET status = 'failed', error_message = @msg, completed_at = @now WHERE status = 'created'`,
      )
      .run({ msg: lowResMsg, now });

    const sumRes = this.db
      .prepare(
        `UPDATE ai_summary_task SET status = 'failed', error_message = @msg, updated_at = @now, last_completed_at = @now WHERE status IN ('pending', 'analyzing')`,
      )
      .run({ msg: summaryMsg, now });

    return {
      failedSubTasks: subRes.changes,
      failedSummaryTasks: sumRes.changes,
    };
  }

  upsertAiSummaryTask(record: AiSummaryTaskRecord): AiSummaryTaskRecord {
    const now = new Date().toISOString();
    const existing = this.getAiSummaryTaskByResource(record.bvid, record.cid);
    const createdAt = existing?.createdAt ?? record.createdAt ?? now;
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
    this.db
      .prepare(
        `
        INSERT INTO ai_summary_task (
          bvid,
          cid,
          title,
          source_task_id,
          status,
          summary_output,
          error_message,
          execution_timing,
          raw_response,
          model_name,
          created_at,
          updated_at,
          last_triggered_at,
          last_completed_at
        )
        VALUES (
          @bvid,
          @cid,
          @title,
          @sourceTaskId,
          @status,
          @summaryOutput,
          @errorMessage,
          @executionTiming,
          @rawResponse,
          @modelName,
          @createdAt,
          @updatedAt,
          @lastTriggeredAt,
          @lastCompletedAt
        )
        ON CONFLICT(bvid, cid) DO UPDATE SET
          title = excluded.title,
          source_task_id = excluded.source_task_id,
          status = excluded.status,
          summary_output = excluded.summary_output,
          error_message = excluded.error_message,
          execution_timing = excluded.execution_timing,
          raw_response = excluded.raw_response,
          model_name = excluded.model_name,
          updated_at = excluded.updated_at,
          last_triggered_at = excluded.last_triggered_at,
          last_completed_at = excluded.last_completed_at
      `,
      )
      .run({
        bvid: record.bvid,
        cid: record.cid,
        title: record.title ?? null,
        sourceTaskId: record.sourceTaskId ?? null,
        status: record.status,
        summaryOutput: record.summaryOutput ?? null,
        errorMessage: record.errorMessage ?? null,
        executionTiming,
        rawResponse,
        modelName,
        createdAt,
        updatedAt: record.updatedAt ?? now,
        lastTriggeredAt: record.lastTriggeredAt ?? null,
        lastCompletedAt: record.lastCompletedAt ?? null,
      });

    const persisted = this.getAiSummaryTaskByResource(record.bvid, record.cid);
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
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}
