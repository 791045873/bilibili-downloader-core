# AI 总结触发与双路径分析 — 需求文档（5b）

> 拆分自 `2026-07-07-ai-summary-interaction.md`
> 依赖 `2026-07-07-ai-summary-interaction-5a.md`（数据库改动）
> 依赖 `2026-07-07-analysis-formal-api.md`（AnalysisInput 统一定义）

## Goal

实现 AI 总结的两种触发路径和统一分析流程：
1. 下载后自动总结（auto_summary 标记，下载完成后触发）
2. 一键 AI 总结（双下载：高分辨率用于截图 + 低分辨率用于 LLM 分析）

两种路径共享统一的下载完成回调入口，根据是否存在 `analysis_sub_task` 分流。

## Background

数据库基础设施已就绪（5a）。`AnalysisInput` 统一定义已就绪（正式 API 文档），支持 `screenshotVideoPath` 和可选 `subtitlePath`。

## In Scope

### 1. 统一分析流程

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
  6. 更新 summary_status = completed
```

调用 `AnalysisEngine` 时：
- `videoPath` 传入低分辨率视频路径（或已下载视频路径，如果复用）
- `screenshotVideoPath` 传入高分辨率视频路径（跳过 ScreenshotSourceResolver）
- `subtitlePath` 可选，无字幕时不传

单清晰度或已下载视频即最低清晰度时，`screenshotVideoPath` 设为与 `videoPath` 相同值。

### 2. 下载完成回调

下载完成后（task status 变为 success），检查 `auto_summary`：

| 条件 | 行为 |
|---|---|
| auto_summary=false | 不触发分析 |
| auto_summary=true，无 analysis_sub_task | 直接进入统一分析流程（用已下载视频） |
| auto_summary=true，有 analysis_sub_task 且 status=completed | 进入统一分析流程（用低分辨率分析 + 高分辨率截图） |
| auto_summary=true，有 analysis_sub_task 且 status≠completed | 等待低分辨率下载完成后再触发 |

### 3. 列表页交互

#### 3.1 每条视频的"AI 总结"开关

- 列表页每个视频条目可配置"AI 总结"开关
- 开关开启时，该视频加入待下载队列后，下载任务 `auto_summary` 标记为 true
- 下载完成后自动触发分析

#### 3.2 "一键 AI 总结"按钮的行为分支

| # | 视频状态 | 按钮状态 | 点击后行为 |
|---|---|---|---|
| 1 | 不在任何队列 | 可点击 | 获取清晰度列表。如果只有一个清晰度：创建下载任务（该清晰度）+ auto_summary=true。如果有多个清晰度：创建高分辨率下载任务（正常队列）+ 低分辨率静默下载子任务。两个下载都完成后进入统一分析流程 |
| 2 | 在队列中，正在下载，auto_summary=false | 可点击 | 设置 auto_summary=true。下载完成后进入统一分析流程（届时再判断是否需要低分辨率下载） |
| 3 | 在队列中，已下载完成，auto_summary=false | 可点击 | 获取清晰度列表。如果需要低分辨率：创建低分辨率子任务 → 分析。如果不需要：直接分析 |
| 4 | 在队列中，auto_summary=true | 置灰 | 不操作 |

#### 3.3 互斥规则

- 如果某个视频已经被加入"一键 AI 总结"，它就肯定已经在待下载队列里了，该视频不能再被加入到待下载队列
- 如果某个视频仅仅被加入到了待下载队列，"AI 总结"按钮仍然可以点击，点击后设置 auto_summary=true

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
- 与截图用高分辨率视频（存放在 `downloads` 目录）分开存放
- 分析完成后在 `ANALYSIS_LLM_VIDEO_DIR` 目录下查找并删除对应的低分辨率视频文件

### 5. 无字幕情况

- 字幕下载随视频下载一起进行
- 如果视频没有字幕，不下载字幕，直接进行 AI 分析
- AI 分析时仅传入视频文件，不传入字幕文件

### 6. 与现有功能的关系

- `AnalysisInput` 的权威定义在 `2026-07-07-analysis-formal-api.md` 中
- AI 总结流程调用 `AnalysisEngine` 时，`videoPath` 传入低分辨率视频路径，`screenshotVideoPath` 传入高分辨率视频路径，`subtitlePath` 可选
- 现有 `POST /api/analysis/run` 正式 API 作为分析执行入口，由下载完成回调或一键 AI 总结流程内部调用
- 现有 Python 薄代理不变
- AI 总结流程传入 `screenshotVideoPath` 时，直接使用本地文件截图，跳过 ScreenshotSourceResolver
- 低分辨率视频文件存储在 `ANALYSIS_LLM_VIDEO_DIR`，分析完成后删除
- 高分辨率视频直接放入 `downloads` 目录，与正常下载视频同等对待，保留不删除

## Out of Scope

- 不实现数据库改动（在 `2026-07-07-ai-summary-interaction-5a.md` 中）
- 不实现邮件通知（在 `2026-07-07-ai-summary-interaction-5d.md` 中）
- 不实现分析进度展示
- 不改变现有 Python 薄代理
- 不改变现有 LLM 分析核心链路

## Affected Files

| 文件 | 改动 |
|---|---|
| `packages/server/src/download/download.service.ts` | 下载完成后检查 auto_summary，触发分析 |
| `packages/server/src/download/download-scheduler.ts` | 低分辨率下载调度逻辑 |
| `packages/server/src/analysis/analysis-engine.ts` | 支持无字幕分析（`subtitlePath` 可选）；支持双视频源（`videoPath` 分析 + `screenshotVideoPath` 截图） |
| `packages/server/src/analysis/analysis.controller.ts` | 内部触发分析时使用统一 `AnalysisInput` 结构 |
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
15. `pnpm typecheck` 和 `pnpm build` 通过
