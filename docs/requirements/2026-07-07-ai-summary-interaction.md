# AI 总结功能交互与流程 — 需求文档（已拆分）

> 本文档已拆分为三个独立子需求：
> - `2026-07-07-ai-summary-interaction-5a.md`：数据库改动
> - `2026-07-07-ai-summary-interaction-5b.md`：AI 总结触发与双路径分析
> - `2026-07-07-ai-summary-interaction-5d.md`：邮件通知
>
> 请使用拆分后的文档。本文档保留作为历史记录。

## Goal

在视频列表页提供 AI 总结能力，支持两种触发方式：
1. 每条视频的"AI 总结"开关：加入下载队列时标记，下载完成后自动触发分析
2. "一键 AI 总结"按钮：直接触发，系统自动编排高分辨率下载 + 低分辨率下载

两种方式的分析流程统一：优先使用低分辨率视频做 LLM 分析以节省 Token，高分辨率视频做截图；如果已下载视频就是最低清晰度或只有一个清晰度，则直接复用。

## Background

视频分析核心链路（字幕解析 → LLM 分析 → 截图 → 生成 Markdown）已实现并通过调试 API 验证。现在需要将分析能力接入前端列表页，提供正式的用户交互入口。

## 概念约定

- "AI 总结" = 使用多模态大模型对视频内容进行总结，生成图文 Markdown 文档
- "解析视频" = 获取视频清晰度/编码选项（现有功能，与 AI 总结无关）
- "高分辨率" = 该视频可用清晰度中最高的档位
- "低分辨率" = 该视频可用清晰度中最低的档位

## In Scope

### 1. 列表页交互

#### 1.1 每条视频的"AI 总结"开关

- 列表页每个视频条目可配置"AI 总结"开关
- 开关开启时，该视频加入待下载队列后，下载任务 `auto_summary` 标记为 true
- 下载完成后自动触发分析

#### 1.2 "一键 AI 总结"按钮

- 位于"加入待下载"按钮旁
- 点击后根据视频当前状态执行不同逻辑（见下方第 3 节）

### 2. 统一分析流程

无论哪种触发方式，分析流程统一：

```text
分析触发时：
  1. 获取该视频可用的清晰度列表
  2. 检查已下载视频的清晰度
  3. 如果已下载视频就是最低清晰度，或该视频只有一个清晰度
     → 直接用已下载视频进行 LLM 分析 + 截图
  4. 如果有更低的清晰度
     → 下载低分辨率视频
     → 用低分辨率视频进行 LLM 分析
     → 用高分辨率视频进行截图
     → 分析完成后删除低分辨率视频文件
  5. 生成 Markdown 文档
  6. 发送邮件通知
```

### 3. "一键 AI 总结"按钮的行为分支

| # | 视频状态 | 按钮状态 | 点击后行为 |
|---|---|---|---|
| 1 | 不在任何队列 | 可点击 | 获取清晰度列表。如果只有一个清晰度：创建下载任务（该清晰度）+ auto_summary=true。如果有多个清晰度：创建高分辨率下载任务（正常队列）+ 低分辨率静默下载子任务（后台）。两个下载都完成后进入统一分析流程 |
| 2 | 在队列中，正在下载，auto_summary=false | 可点击 | 设置 auto_summary=true。下载完成后进入统一分析流程（届时再判断是否需要低分辨率下载） |
| 3 | 在队列中，已下载完成，auto_summary=false | 可点击 | 获取清晰度列表。如果需要低分辨率：创建低分辨率子任务 → 分析。如果不需要：直接分析 |
| 4 | 在队列中，auto_summary=true | 置灰 | 不操作 |

### 4. 低分辨率下载

#### 4.1 清晰度选择

自动选择该视频可用清晰度列表中最低的一个。

#### 4.2 复用规则

以下情况不下载低分辨率视频，直接复用已下载视频：
- 该视频只有一个清晰度
- 用户已下载的视频就是最低清晰度

#### 4.3 并发控制

- 新增环境变量 `MAX_CONCURRENT_LOW_RES_DOWNLOADS`，默认值 1，可配置
- 低分辨率下载不占用高分辨率下载的并发额度
- 低分辨率下载不显示在前端下载队列中（静默执行）

#### 4.4 文件存储与清理

- 低分辨率视频存储在独立目录 `ANALYSIS_LLM_VIDEO_DIR`（环境变量配置，默认值 `downloads/.analysis-llm/`）
- 与截图用高分辨率视频（存放在 `downloads` 目录）分开存放，不使用前缀区分
- 分析完成后在 `ANALYSIS_LLM_VIDEO_DIR` 目录下查找并删除对应的低分辨率视频文件

### 5. 无字幕情况

- 字幕下载随视频下载一起进行
- 如果视频没有字幕，不下载字幕，直接进行 AI 分析
- AI 分析时仅传入视频文件，不传入字幕文件

### 6. 数据库改动

#### 6.1 task 表新增字段

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

#### 6.2 新增 analysis_sub_task 表

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
| `quality` | 低分辨率下载选择的清晰度 |
| `status` | created / downloading / completed / failed |
| `output_file` | 低分辨率视频文件路径 |

只有需要低分辨率下载时才创建 `analysis_sub_task` 记录。复用已下载视频时不创建。

### 7. 分析触发逻辑

下载完成后（task status 变为 success），检查 `auto_summary`：

| 条件 | 行为 |
|---|---|
| auto_summary=false | 不触发分析 |
| auto_summary=true，无 analysis_sub_task | 进入统一分析流程：判断是否需要低分辨率下载 |
| auto_summary=true，有 analysis_sub_task 且 status=completed | 进入统一分析流程：用低分辨率分析 + 高分辨率截图 |
| auto_summary=true，有 analysis_sub_task 且 status≠completed | 等待低分辨率下载完成后再触发 |

### 8. 邮件通知

#### 8.1 触发时机

- AI 总结完成时发送通知邮件
- AI 总结失败时也发送通知邮件

#### 8.2 配置

环境变量：

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=sender@example.com
SMTP_PASS=password
NOTIFICATION_EMAIL=recipient@example.com
```

#### 8.3 邮件内容

按最简方式编写：

**成功时：**
- 标题：`AI 总结完成：{视频标题}`
- 正文：视频标题 + 视频原始链接（如果是 B 站视频，附 B 站链接；如果是本地视频，不附链接，但附上视频名称）+ Markdown 文件路径

**失败时：**
- 标题：`AI 总结失败：{视频标题}`
- 正文：视频标题 + 视频原始链接（同上规则）+ 错误信息

### 9. 与现有功能的关系

- `AnalysisInput` 的权威定义在 `2026-07-07-analysis-formal-api.md` 中
- AI 总结流程调用 `AnalysisEngine` 时，`videoPath` 传入低分辨率视频路径，`screenshotVideoPath` 传入高分辨率视频路径，`subtitlePath` 可选
- 现有 `POST /api/analysis/run` 正式 API 作为分析执行入口，由下载完成回调或一键 AI 总结流程内部调用
- 现有 Python 薄代理不变
- 现有截图源分离与降级策略（`2026-07-07-screenshot-source-fallback.md`）与本文档的关系：
  - AI 总结流程传入 `screenshotVideoPath` 时，直接使用本地文件截图，跳过 ScreenshotSourceResolver
  - 截图源分离需求中的远端截图方案适用于"不下载视频就分析"的场景，与本文档不冲突
- 低分辨率视频文件存储在 `ANALYSIS_LLM_VIDEO_DIR`（独立目录，专用于 LLM 分析），分析完成后删除
- 高分辨率视频（无论是用户下载还是分析流程触发下载）直接放入 `downloads` 目录，与正常下载视频同等对待，保留不删除

## Out of Scope

- 不实现分析进度展示（无法获取真实进度）
- 不实现多个收件人
- 不实现邮件模板自定义
- 不实现分析结果的前端预览（后续需求）
- 不改变现有 Python 薄代理
- 不改变现有 LLM 分析核心链路

## Affected Files

| 文件 | 改动 |
|---|---|
| `packages/server/src/database/database.service.ts` | task 表新增字段；新增 analysis_sub_task 表 |
| `packages/server/src/download/download.service.ts` | 下载完成后检查 auto_summary，触发分析 |
| `packages/server/src/download/download-scheduler.ts` | 低分辨率下载调度逻辑 |
| `packages/server/src/analysis/analysis-engine.ts` | 支持无字幕分析（`subtitlePath` 可选）；支持双视频源（`videoPath` 分析 + `screenshotVideoPath` 截图）；`AnalysisInput` 引用 `2026-07-07-analysis-formal-api.md` 的统一定义 |
| `packages/server/src/analysis/analysis.controller.ts` | 内部触发分析时使用统一 `AnalysisInput` 结构（含 `screenshotVideoPath`、`subtitlePath?`） |
| `packages/server/src/notification/` | 新增邮件通知模块 |
| `packages/frontend/src/views/ParseResultList.vue` | AI 总结开关 + 一键 AI 总结按钮 |
| `packages/frontend/src/api/index.ts` | 新增一键 AI 总结 API 调用 |
| `packages/frontend/src/types/index.ts` | 新增类型定义 |

## Acceptance Criteria

1. 列表页每个视频条目有"AI 总结"开关
2. 开关开启并加入下载队列后，task 的 auto_summary=true
3. 下载完成后 auto_summary=true 的任务自动触发分析
4. 分析时如果已下载视频是最低清晰度或只有一个清晰度，直接复用已下载视频
5. 分析时如果有更低清晰度，下载低分辨率视频用于 LLM 分析，高分辨率用于截图
6. 低分辨率视频分析完成后删除
7. "一键 AI 总结"按钮根据视频状态执行 4 种分支逻辑
8. 视频不在队列时点击"一键 AI 总结"，获取清晰度列表后决定是否需要双下载
9. 视频已下载完成时点击"一键 AI 总结"，检查是否需要低分辨率下载
10. 视频在队列中下载中时点击"一键 AI 总结"，设置 auto_summary=true
11. auto_summary=true 的视频"一键 AI 总结"按钮置灰
12. 低分辨率下载选择最低可用清晰度
13. 低分辨率下载有独立可配置的并发数限制
14. 无字幕时直接进行 AI 分析
15. 分析完成后发送邮件通知，包含视频标题和原始链接（B 站视频附 B 站链接，本地视频附视频名称）
16. 分析失败时也发送邮件通知，包含错误信息
17. `pnpm typecheck` 和 `pnpm build` 通过
