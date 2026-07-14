# AI Summary Database (5a) — Testing Directions

> 对应 plan: `docs/plans/2026-07-07-ai-summary-database-5a-plan.md`
> 对应需求: `docs/requirements/2026-07-07-ai-summary-interaction-5a.md`
> 类型: 需求级测试方向（非单元测试、非脚本）

## 测试目的

验证 `task` 表新增 `auto_summary`、`summary_status`、`summary_output` 字段及 `analysis_sub_task` 表后，schema 变更、迁移幂等性、默认值、已有数据完整性符合需求。本文件描述应观察到的需求级状态与反状态。

## 测试方向

### 1. task 表新增字段存在且类型正确

**应成立（should be true）:**

- 全新数据库启动 server 后，`PRAGMA table_info(task)` 包含 `auto_summary`（INTEGER）、`summary_status`（TEXT）、`summary_output`（TEXT）三列。
- `CREATE TABLE` 语句中三列定义存在（代码审查确认）。

**不应成立（should not be true）:**

- 新数据库中 `task` 表缺少任一新列。

### 2. analysis_sub_task 表创建成功且字段完整

**应成立:**

- 全新数据库启动 server 后，`PRAGMA table_info(analysis_sub_task)` 包含 `id`、`task_id`、`bvid`、`cid`、`quality`、`status`、`output_file`、`error_message`、`created_at`、`completed_at` 共 10 列。
- `task_id` 列为 NOT NULL，`status` 列 NOT NULL DEFAULT 'created'，`created_at` 列 NOT NULL。
- `analysis_sub_task(task_id)` 索引存在。

**不应成立:**

- 表缺少任一定义字段。
- `status` 列缺失默认值或 NOT NULL 约束。

### 3. 已有数据库迁移不报错（幂等性）

**应成立:**

- 使用已有 `tasks.db`（含旧 task 数据、无新列、无 analysis_sub_task 表）启动 server，server 正常启动，无迁移错误日志。
- 迁移后 `PRAGMA table_info(task)` 包含三个新列。
- 迁移后 `analysis_sub_task` 表存在。
- 再次重启 server，迁移 try/catch 忽略"列已存在"，无错误日志。

**不应成立:**

- 已有数据库启动时迁移抛出未捕获异常导致 server 崩溃。
- 重复启动时因"列已存在"报错。

### 4. auto_summary 默认值为 0

**应成立:**

- 已有数据库迁移后，`SELECT auto_summary FROM task` 对所有已有行返回 `0`。
- 全新数据库 `INSERT INTO task` 不显式指定 `auto_summary` 时，该列值为 `0`。

**不应成立（反状态）:**

- 已有任务 `auto_summary` 为 `1`（不应自动开启）。
- 新插入任务 `auto_summary` 为 NULL 或非 0 值。

### 5. summary_status 默认值为 none

**应成立:**

- 已有数据库迁移后，`SELECT summary_status FROM task` 对所有已有行返回 `'none'`。
- 全新数据库 `INSERT INTO task` 不显式指定 `summary_status` 时，该列值为 `'none'`。

**不应成立（反状态）:**

- 已有任务 `summary_status` 为 `'pending'`、`'analyzing'` 或其他非 `'none'` 值（已有任务不应被误标记为分析中）。
- 新插入任务 `summary_status` 为 NULL。

### 6. summary_output 默认为 NULL

**应成立:**

- 已有数据库迁移后，`SELECT summary_output FROM task` 对所有已有行返回 NULL。
- 新插入任务未设置 `summary_output` 时，该列为 NULL。

**不应成立:**

- `summary_output` 有非空默认值（分析结果未生成时不应有路径）。

### 7. 已有任务数据完整（迁移无数据丢失）

**应成立（反状态验证）:**

- 迁移前后，已有 task 行的 `id`、`bvid`、`cid`、`title`、`status`、`outputFile`、`createdAt` 等原有字段值不变。
- 已有行数量不变。

**不应成立:**

- 迁移导致已有行数据丢失或原有字段值被篡改。

### 8. TypeScript 接口与编译

**应成立:**

- `TaskRecord` 接口包含 `autoSummary?`、`summaryStatus?`、`summaryOutput?` 字段。
- `AnalysisSubTaskRecord` 接口定义存在且字段与表列对应。
- `pnpm typecheck` 零错误。
- `pnpm build` 零错误。

**不应成立:**

- 接口缺少新字段导致类型错误被忽略。

### 9. DatabaseService 方法存在

**应成立:**

- `updateTaskStatus()` 接受 `autoSummary`、`summaryStatus`、`summaryOutput` 可选字段，生成对应条件 SET 子句。
- `insertAnalysisSubTask()`、`updateAnalysisSubTaskStatus()`、`getAnalysisSubTasksByTaskId()` 方法存在。
- 所有方法使用 prepared statement（参数化查询），无字符串拼接 SQL。

**不应成立:**

- 方法签名不接受新字段。
- SQL 语句使用字符串拼接用户输入（注入风险）。

## 范围外（由其他 plan 覆盖）

- 分析触发逻辑（`summary_status` 状态流转由 5b plan 覆盖）
- 邮件通知（5d plan 覆盖）
- 前端交互（5b/5c plan 覆盖）
- 已有任务数据回填（新字段有默认值，无需回填；已有任务视为"无自动总结"为正确行为）

## 验证命令

- `pnpm typecheck` —— 零错误
- `pnpm build` —— 零错误
- 手动验证：使用已有 `tasks.db` 启动 server，执行 `PRAGMA table_info(task)` 与 `PRAGMA table_info(analysis_sub_task)` 确认列与默认值

## 2026-07-14 Verification Record

- `pnpm typecheck` passed (zero errors)
- `pnpm build` passed (zero errors)
- 启动 server 后，`DatabaseService.initSchema()` 执行成功，无迁移报错
- `PRAGMA table_info(task)` 确认存在新列：`auto_summary`(INTEGER, default 0), `summary_status`(TEXT, default 'none'), `summary_output`(TEXT)
- `PRAGMA table_info(analysis_sub_task)` 确认 10 列完整，且 `task_id` / `created_at` / `status` 满足约束
- `PRAGMA index_list(analysis_sub_task)` 确认存在索引：`idx_analysis_sub_task_task_id`
- 当前库 task 行数为 0，因此“已有数据不变/已有行默认值”反状态检查在本环境无样本；该项保留为后续有历史数据环境复核
