-- 003-summary-output-relative.sql
-- 一次性数据修正：把 ai_summary_task.summary_output 中位于指定下载根目录之下的
-- 绝对路径改写为相对路径（POSIX 分隔符，相对下载根目录 DOWNLOAD_ROOT）。
--
-- 用法：
--   1. 停止所有 server 实例（本地与容器），避免执行期间新写入被并发覆盖；
--   2. 修改下方 root 字面量为当前环境的下载根目录（用正斜杠，结尾不带斜杠）：
--      本地示例 'E:/sata1-18502986266/bilibili-download'；Docker 为 '/download'；
--   3. psql "$DATABASE_URL" -f packages/server/scripts/one-off-migrations/003-summary-output-relative.sql
--   4. 核对输出 "UPDATE n" 计数：预期 0 行说明根写错或该根下无存量绝对路径。
--
-- 幂等：可重复执行。已是相对路径、空串、根之外的值（如遗留 cwd/summaryDir 绝对路径）不会改动。
-- 只更新 summary_output，不触碰 updated_at（避免打乱总结列表按更新时间排序）。

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
    btrim(substring(replace(t.summary_output, '\', '/'), p.root_len + 2), '/') AS new_value
  FROM ai_summary_task t, params p
  WHERE t.summary_output IS NOT NULL
    AND t.summary_output <> ''
    AND left(lower(replace(t.summary_output, '\', '/')), p.root_len + 1) = p.root_l || '/'
    AND btrim(substring(replace(t.summary_output, '\', '/'), p.root_len + 2), '/') <> ''
)
UPDATE ai_summary_task t
SET summary_output = c.new_value
FROM candidates c
WHERE t.id = c.id;
