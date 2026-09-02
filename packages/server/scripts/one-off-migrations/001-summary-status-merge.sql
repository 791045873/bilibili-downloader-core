-- 一次性迁移（已归档）：状态单一来源迁移
-- 把历史 task.summary_status 合并进 ai_summary_task（幂等，ON CONFLICT DO NOTHING）。
-- 适用库：2026-08 中旬从 SQLite 迁移到 PostgreSQL 时存在 summary_status 数据的库。
-- 状态：随 server 0.0.x 版本发布，已在所有存量库的启动流程中执行过；勿重复执行。
-- 原执行位置：database.service.ts initSchema()（已于 P3 移除，schema 由 Prisma 管理）。

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
ON CONFLICT (bvid, cid) DO NOTHING;
