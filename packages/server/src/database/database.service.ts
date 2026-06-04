import { Injectable, Logger } from "@nestjs/common";
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
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

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly db: Database.Database;

  constructor() {
    const outputDir =
      process.env.OUTPUT_DIR ?? join(process.cwd(), "downloads");
    const dbPath = join(outputDir, "tasks.db");

    // ensureOutputDir before opening db
    mkdirSync(outputDir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
    this.logger.log(`SQLite 数据库已连接: ${dbPath}`);
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
  }

  // ==================== CRUD ====================

  /** 插入新任务，返回自增 id */
  insertTask(record: TaskRecord): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO task (bvid, cid, title, quality, codec, outputPath, status, progress, speed,
                        outputFile, fileSize, errorCode, errorMessage, durationMs,
                        createdAt, updatedAt, completedAt)
      VALUES (@bvid, @cid, @title, @quality, @codec, @outputPath, @status, @progress, @speed,
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
      status: record.status ?? "created",
      progress: record.progress ?? 0,
      speed: record.speed ?? null,
      outputFile: record.outputFile ?? null,
      fileSize: record.fileSize ?? null,
      errorCode: record.errorCode ?? null,
      errorMessage: record.errorMessage ?? null,
      durationMs: record.durationMs ?? null,
      createdAt: record.createdAt ?? now,
      updatedAt: now,
      completedAt: record.completedAt ?? null,
    });
    return Number(result.lastInsertRowid);
  }

  /** 更新任务进度（每秒调用一次） */
  updateTaskProgress(id: number, progress: number, speed?: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE task SET progress = @progress, speed = @speed, updatedAt = @updatedAt WHERE id = @id",
      )
      .run({ id, progress, speed: speed ?? null, updatedAt: now });
  }

  /** 更新任务状态（完成/失败时） */
  updateTaskStatus(
    id: number,
    fields: {
      status: string;
      outputFile?: string;
      fileSize?: number;
      errorCode?: string;
      errorMessage?: string;
      durationMs?: number;
      progress?: number;
    },
  ): void {
    const now = new Date().toISOString();
    const setClauses: string[] = ["status = @status", "updatedAt = @updatedAt"];
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
  }

  /** 获取所有任务 */
  getTasks(): TaskRecord[] {
    return this.db
      .prepare("SELECT * FROM task ORDER BY createdAt DESC")
      .all() as TaskRecord[];
  }

  /** 获取单个任务 */
  getTaskById(id: number): TaskRecord | undefined {
    return this.db.prepare("SELECT * FROM task WHERE id = ?").get(id) as
      | TaskRecord
      | undefined;
  }

  /** 取队首 "created" 任务（调度器抢占用） */
  findNextCreatedTask(): TaskRecord | undefined {
    return this.db
      .prepare(
        "SELECT * FROM task WHERE status = 'created' ORDER BY createdAt ASC LIMIT 1",
      )
      .get() as TaskRecord | undefined;
  }

  /** 删除任务 */
  deleteTask(id: number): void {
    this.db.prepare("DELETE FROM task WHERE id = ?").run(id);
  }

  /** 清空所有任务 */
  clearTasks(): void {
    this.db.prepare("DELETE FROM task").run();
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
  }

  /** 按 bvid+cid 批量查询最新任务（用于前端入队去重判定） */
  findTasksByBvidsAndCids(
    pairs: { bvid: string; cid: number }[],
  ): Pick<TaskRecord, "bvid" | "cid" | "status" | "createdAt">[] {
    if (pairs.length === 0) return [];
    const placeholders = pairs.map(() => "(?, ?)").join(", ");
    const params = pairs.flatMap((p) => [p.bvid, p.cid]);
    return (
      this.db
        .prepare(
          `SELECT bvid, cid, status, createdAt FROM task
           WHERE (bvid, cid) IN (${placeholders})
           ORDER BY createdAt DESC`,
        )
        .all(...params) as Pick<
        TaskRecord,
        "bvid" | "cid" | "status" | "createdAt"
      >[]
    ).reduce(
      (acc, row) => {
        if (!acc.some((r) => r.bvid === row.bvid && r.cid === row.cid)) {
          acc.push(row);
        }
        return acc;
      },
      [] as Pick<TaskRecord, "bvid" | "cid" | "status" | "createdAt">[],
    );
  }
}
