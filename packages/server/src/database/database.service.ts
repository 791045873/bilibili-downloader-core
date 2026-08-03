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
  createdAt?: string;
  updatedAt?: string;
  lastTriggeredAt?: string;
  lastCompletedAt?: string;
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
      t.outputPath,
      t.subtitle_lang AS subtitleLang,
      t.auto_summary AS autoSummary,
      COALESCE(ast.status, t.summary_status) AS summaryStatus,
      COALESCE(ast.summary_output, t.summary_output) AS summaryOutput,
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
      INSERT INTO task (bvid, cid, title, quality, codec, outputPath, subtitle_lang, status, progress, speed,
            auto_summary, summary_status, summary_output,
                        outputFile, fileSize, errorCode, errorMessage, durationMs,
                        createdAt, updatedAt, completedAt)
      VALUES (@bvid, @cid, @title, @quality, @codec, @outputPath, @subtitleLang, @status, @progress, @speed,
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

  /** 更新任务状态（完成/失败时） */
  updateTaskStatus(
    id: number,
    fields: {
      status: string;
      autoSummary?: number;
      summaryStatus?: string;
      summaryOutput?: string;
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
    if (fields.summaryStatus !== undefined)
      setClauses.push("summary_status = @summaryStatus");
    if (fields.summaryOutput !== undefined)
      setClauses.push("summary_output = @summaryOutput");
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
        summaryStatus: fields.summaryStatus ?? null,
        summaryOutput: fields.summaryOutput ?? null,
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
    const summaryChanged =
      fields.summaryStatus !== undefined &&
      previous?.summaryStatus !== fields.summaryStatus;
    const shouldLog =
      statusChanged ||
      summaryChanged ||
      fields.errorMessage !== undefined ||
      fields.outputFile !== undefined ||
      fields.summaryOutput !== undefined ||
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
        summaryStatus: fields.summaryStatus,
        autoSummary: fields.autoSummary,
        outputFile: fields.outputFile,
        summaryPath:
          fields.summaryStatus === "completed"
            ? fields.summaryOutput
            : undefined,
        error:
          fields.errorMessage ??
          (fields.summaryStatus === "failed"
            ? fields.summaryOutput
            : undefined),
        durationMs: fields.durationMs,
        progress: fields.progress,
      };

      if (fields.status === "failed" || fields.summaryStatus === "failed") {
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

  getAnalysisSubTasksByTaskId(taskId: number): AnalysisSubTaskRecord[] {
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
        WHERE task_id = ?
        ORDER BY created_at ASC
      `,
      )
      .all(taskId) as AnalysisSubTaskRecord[];
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

  listAiSummaryTasks(): AiSummaryTaskRecord[] {
    return this.db
      .prepare(`${this.aiSummaryTaskSelectSql} ORDER BY updated_at DESC`)
      .all() as AiSummaryTaskRecord[];
  }

  upsertAiSummaryTask(record: AiSummaryTaskRecord): AiSummaryTaskRecord {
    const now = new Date().toISOString();
    const existing = this.getAiSummaryTaskByResource(record.bvid, record.cid);
    const createdAt = existing?.createdAt ?? record.createdAt ?? now;
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
