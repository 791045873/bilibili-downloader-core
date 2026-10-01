-- 004-outputfile-relative.sql
-- 一次性数据修正：把 task."outputFile" 与 analysis_sub_task.output_file 中位于
-- 指定下载根目录之下的绝对路径改写为相对路径（POSIX 分隔符，相对下载根目录 DOWNLOAD_ROOT）。
--
-- 列名说明：task 表列为 camelCase 带引号的 "outputFile"（Prisma contract 无 @map）；
-- analysis_sub_task 表列为 snake_case 的 output_file。
--
-- 用法：
--   1. 停止所有 server 实例（本地与容器），避免执行期间新写入被并发覆盖；
--   2. 修改下方 root 字面量为当前环境的下载根目录（用正斜杠，结尾不带斜杠）：
--      本地示例 'E:/sata1-18502986266/bilibili-download'；Docker 为 '/download'；
--   3. psql "$DATABASE_URL" -f packages/server/scripts/one-off-migrations/004-outputfile-relative.sql
--   4. 核对输出 UPDATE 计数：预期 0 行说明根写错或该根下无存量绝对路径。
--
-- 幂等：可重复执行。已是相对路径、空值、根之外的值不会改动。
-- 注意：migrate-sqlite-to-postgres.mjs 按原样复制这两列，若重跑该搬迁工具，需重跑本脚本。
-- 只更新 outputFile 两列，不触碰 updated_at/completed_at。

-- ============ task."outputFile" ============

WITH raw AS (
  SELECT replace('E:/sata1-18502986266/bilibili-download', '\', '/') AS root0
),
params AS (
  SELECT lower(rtrim(root0, '/')) AS root_l,
         length(rtrim(root0, '/')) AS root_len
  FROM raw
),
candidates AS (
  SELECT
    t.id,
    btrim(substring(replace(t."outputFile", '\', '/'), p.root_len + 2), '/') AS new_value
  FROM task t, params p
  WHERE t."outputFile" IS NOT NULL
    AND t."outputFile" <> ''
    AND left(lower(replace(t."outputFile", '\', '/')), p.root_len + 1) = p.root_l || '/'
    AND btrim(substring(replace(t."outputFile", '\', '/'), p.root_len + 2), '/') <> ''
)
UPDATE task t
SET "outputFile" = c.new_value
FROM candidates c
WHERE t.id = c.id;

-- ============ analysis_sub_task.output_file ============

WITH raw AS (
  SELECT replace('E:/sata1-18502986266/bilibili-download', '\', '/') AS root0
),
params AS (
  SELECT lower(rtrim(root0, '/')) AS root_l,
         length(rtrim(root0, '/')) AS root_len
  FROM raw
),
candidates AS (
  SELECT
    s.id,
    btrim(substring(replace(s.output_file, '\', '/'), p.root_len + 2), '/') AS new_value
  FROM analysis_sub_task s, params p
  WHERE s.output_file IS NOT NULL
    AND s.output_file <> ''
    AND left(lower(replace(s.output_file, '\', '/')), p.root_len + 1) = p.root_l || '/'
    AND btrim(substring(replace(s.output_file, '\', '/'), p.root_len + 2), '/') <> ''
)
UPDATE analysis_sub_task s
SET output_file = c.new_value
FROM candidates c
WHERE s.id = c.id;
