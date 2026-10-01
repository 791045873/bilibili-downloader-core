/**
 * 一次性迁移脚本：SQLite (tasks.db) → PostgreSQL
 *
 * 前置：PostgreSQL schema 已由 server 初始化（六表已建）；`DATABASE_URL` 与 `OUTPUT_DIR` 已配置。
 * 用法：node --env-file=.env scripts/migrate-sqlite-to-postgres.mjs
 * 语义：幂等可重跑（按 id/key 冲突更新）；源 SQLite 只读打开，不修改不删除（回滚=切回 SQLite）。
 */

import Database from "better-sqlite3";
import { Pool } from "pg";
import { join } from "node:path";

const outputDir = process.env.OUTPUT_DIR ?? join(process.cwd(), "downloads");
const dbPath = join(outputDir, "tasks.db");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("缺少 DATABASE_URL，无法迁移");
  process.exit(1);
}

const sqlite = new Database(dbPath, { readonly: true });
const pg = new Pool({ connectionString: databaseUrl });

const ts = (v) =>
  v === null || v === undefined || v === "" ? null : v;

const tables = [
  {
    name: "task",
    columns: [
      "id", "bvid", "cid", "title", "quality", "codec", "fileNameTemplate",
      "outputPath", "subtitle_lang", "auto_summary", "summary_status",
      "summary_output", "prompt_id", "status", "progress", "speed", "outputFile",
      "fileSize", "errorCode", "errorMessage", "durationMs", "createdAt",
      "updatedAt", "completedAt",
    ],
    pgColumns: [
      "id", "bvid", "cid", "title", "quality", "codec", '"fileNameTemplate"',
      '"outputPath"', "subtitle_lang", "auto_summary", "summary_status",
      "summary_output", "prompt_id", "status", "progress", "speed", '"outputFile"',
      '"fileSize"', '"errorCode"', '"errorMessage"', '"durationMs"', '"createdAt"',
      '"updatedAt"', '"completedAt"',
    ],
    key: "id",
    tsCols: ["createdAt", "updatedAt", "completedAt"],
    sequence: true,
  },
  {
    name: "analysis_sub_task",
    columns: [
      "id", "task_id", "bvid", "cid", "quality", "status", "output_file",
      "error_message", "created_at", "completed_at",
    ],
    pgColumns: [
      "id", "task_id", "bvid", "cid", "quality", "status", "output_file",
      "error_message", "created_at", "completed_at",
    ],
    key: "id",
    tsCols: ["created_at", "completed_at"],
    sequence: true,
  },
  {
    name: "ai_summary_task",
    columns: [
      "id", "bvid", "cid", "title", "source_task_id", "prompt_id", "status",
      "summary_output", "error_message", "execution_timing", "raw_response",
      "model_name", "created_at", "updated_at", "last_triggered_at",
      "last_completed_at",
    ],
    pgColumns: [
      "id", "bvid", "cid", "title", "source_task_id", "prompt_id", "status",
      "summary_output", "error_message", "execution_timing", "raw_response",
      "model_name", "created_at", "updated_at", "last_triggered_at",
      "last_completed_at",
    ],
    key: "id",
    tsCols: [
      "created_at", "updated_at", "last_triggered_at", "last_completed_at",
    ],
    sequence: true,
  },
  {
    name: "app_settings",
    columns: ["key", "value"],
    pgColumns: ["key", "value"],
    key: "key",
    tsCols: [],
    sequence: false,
  },
  {
    name: "ai_prompt",
    columns: [
      "id", "name", "content", "is_system", "is_default", "created_at",
      "updated_at",
    ],
    pgColumns: [
      "id", "name", "content", "is_system", "is_default", "created_at",
      "updated_at",
    ],
    key: "id",
    tsCols: ["created_at", "updated_at"],
    sequence: true,
  },
  {
    name: "ai_prompt_creator",
    columns: ["mid", "prompt_id"],
    pgColumns: ["mid", "prompt_id"],
    key: "mid",
    tsCols: [],
    sequence: false,
  },
];

async function migrate() {
  let totalRows = 0;
  for (const table of tables) {
    const rows = sqlite.prepare(`SELECT * FROM ${table.name}`).all();
    const cols = table.pgColumns;
    const keyIdx = table.columns.indexOf(table.key);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const updateCols = cols
      .filter((_, i) => i !== keyIdx)
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(", ");
    const upsertSql = `INSERT INTO ${table.name} (${cols.join(", ")}) VALUES (${placeholders}) ON CONFLICT (${table.key}) DO UPDATE SET ${updateCols}`;

    let inserted = 0;
    let skipped = 0;
    const client = await pg.connect();
    try {
      await client.query("BEGIN");
      for (const row of rows) {
        const values = table.columns.map((c, i) =>
          table.tsCols.includes(c) ? ts(row[c]) : (row[c] ?? null),
        );
        try {
          await client.query(upsertSql, values);
          inserted += 1;
        } catch (err) {
          skipped += 1;
          console.error(
            `[${table.name}] skip row (${table.key}=${row[table.key]}): ${err.message}`,
          );
        }
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    if (table.sequence) {
      await pg.query(
        `SELECT setval(pg_get_serial_sequence('${table.name}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${table.name}))`,
      );
    }

    totalRows += inserted;
    console.log(
      `[${table.name}] sqlite=${rows.length} migrated=${inserted} skipped=${skipped}`,
    );
  }
  console.log(`迁移完成，共迁移 ${totalRows} 行。`);
}

migrate()
  .catch((err) => {
    console.error("迁移失败:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    sqlite.close();
    await pg.end();
  });
