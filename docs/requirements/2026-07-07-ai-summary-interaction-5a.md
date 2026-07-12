# AI 总结数据库改动 — 需求文档（5a）

> 拆分自 `2026-07-07-ai-summary-interaction.md`

## Goal

为 AI 总结功能提供数据库基础设施：task 表新增 `auto_summary`、`summary_status`、`summary_output` 字段；新增 `analysis_sub_task` 表用于追踪低分辨率下载子任务。

## Background

AI 总结功能需要标记下载任务是否需要自动分析、追踪分析状态、记录分析结果。低分辨率下载作为独立子任务需要单独表追踪。

## In Scope

### 1. task 表新增字段

```sql
ALTER TABLE task ADD COLUMN auto_summary INTEGER DEFAULT 0;
ALTER TABLE task ADD COLUMN summary_status TEXT DEFAULT 'none';
ALTER TABLE task ADD COLUMN summary_output TEXT;
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `auto_summary` | INTEGER (boolean) | 是否需要 AI 总结 |
| `summary_status` | TEXT | none / pending / downloading_low_res / analyzing / completed / failed |
| `summary_output` | TEXT | 生成的 Markdown 文件路径 |

### 2. 新增 analysis_sub_task 表

```sql
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
);
```

| 字段 | 说明 |
|---|---|
| `task_id` | 关联的下载任务 ID |
| `bvid` | B 站视频 ID |
| `cid` | B 站分 P ID |
| `quality` | 低分辨率下载选择的清晰度 |
| `status` | created / downloading / completed / failed |
| `output_file` | 低分辨率视频文件路径 |

只有需要低分辨率下载时才创建 `analysis_sub_task` 记录。复用已下载视频时不创建。

### 3. 迁移策略

- `task` 表使用 `ALTER TABLE ADD COLUMN`（与现有 `subtitle_lang` 迁移方式一致）
- `analysis_sub_task` 表使用 `CREATE TABLE IF NOT EXISTS`
- 迁移在 `DatabaseService.initSchema()` 中执行，try/catch 忽略已存在列

## Out of Scope

- 不实现分析触发逻辑（在 `2026-07-07-ai-summary-interaction-5b.md` 中）
- 不实现邮件通知（在 `2026-07-07-ai-summary-interaction-5d.md` 中）
- 不实现前端交互

## Affected Files

| 文件 | 改动 |
|---|---|
| `packages/server/src/database/database.service.ts` | task 表新增字段；新增 analysis_sub_task 表；迁移逻辑 |

## Acceptance Criteria

1. `task` 表新增 `auto_summary`、`summary_status`、`summary_output` 三个字段
2. `analysis_sub_task` 表创建成功，包含所有定义字段
3. 已有数据库执行迁移不报错（列已存在时 try/catch 忽略）
4. `auto_summary` 默认值为 0
5. `summary_status` 默认值为 `none`
6. `pnpm typecheck` 和 `pnpm build` 通过
