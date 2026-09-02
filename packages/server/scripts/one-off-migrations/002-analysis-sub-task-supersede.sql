-- 一次性迁移（已归档）：analysis_sub_task 资源级键迁移
-- 旧活跃子任务标 failed（按 bvid,cid,quality 保留最新一条）+ 重建 partial unique index（幂等）。
-- 适用库：2026-08 中旬建立的早期库（首次引入 partial unique index 前建表）。
-- 状态：随 server 0.0.x 版本发布，已在所有存量库的启动流程中执行过；勿重复执行。
-- 原执行位置：database.service.ts initSchema()（已于 P3 移除，schema 由 Prisma 管理）。

UPDATE analysis_sub_task
SET status = 'failed',
    error_message = COALESCE(error_message, 'superseded by newer record')
WHERE id NOT IN (
  SELECT MAX(id) FROM analysis_sub_task GROUP BY bvid, cid, quality
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_sub_task_active
ON analysis_sub_task(bvid, cid, quality)
WHERE status != 'failed';
