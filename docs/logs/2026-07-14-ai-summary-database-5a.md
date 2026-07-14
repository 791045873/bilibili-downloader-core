# 2026-07-14 AI Summary Database (5a) 实现日志

## Plan
- `docs/plans/2026-07-07-ai-summary-database-5a-plan.md`

## 改动
- 更新 `packages/server/src/database/database.service.ts`：
  - `TaskRecord` 新增 `autoSummary`、`summaryStatus`、`summaryOutput`
  - 新增 `AnalysisSubTaskRecord` 接口
  - `task` 表 schema 新增：`auto_summary`、`summary_status`、`summary_output`
  - `initSchema()` 新增幂等迁移：3 条 `ALTER TABLE ... ADD COLUMN`（try/catch 忽略已存在）
  - 新增 `analysis_sub_task` 表 + `idx_analysis_sub_task_task_id` 索引
  - `insertTask()` 新增 summary 字段写入（默认 0 / none / null）
  - `updateTaskStatus()` 新增 summary 字段条件更新
  - 新增 `insertAnalysisSubTask()`、`updateAnalysisSubTaskStatus()`、`getAnalysisSubTasksByTaskId()`

## 验证
- `pnpm typecheck` 通过
- `pnpm build` 通过
- 启动 server 后数据库验证通过：
  - `task` 新列存在且默认值正确
  - `analysis_sub_task` 表结构完整
  - `analysis_sub_task(task_id)` 索引存在

## 风险与备注
- 当前验证库 task 行数为 0，无法在本环境完成“已有历史行迁移后默认值与数据不变”抽样核验；需要在含历史任务的数据库中补一次复核。
