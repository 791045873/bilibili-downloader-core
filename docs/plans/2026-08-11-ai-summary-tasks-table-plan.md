# 2026-08-11 AI 总结任务列表表格化（含总结时间与执行耗时）

> Plan Status: completed
> Last Reviewed: 2026-08-11
> Source: 用户直接需求（优化 AI 总结任务列表显示）
> Related: `docs/plans/2026-08-11-ai-summary-state-architecture-consolidation-plan.md`（状态单一来源，`ai_summary_task` 为权威记录）
> Audit: required
> Testing: `docs/testing/2026/08-11-ai-summary-tasks-table-testing.md`

## Current Baseline

- `GET /api/summary-tasks`（`analysis-task.controller.ts:70-73`）返回 `ai_summary_task` 列表（`listAiSummaryTasks`，`database.service.ts:765-769`），字段含 status/summaryOutput/errorMessage/createdAt/updatedAt/lastTriggeredAt/lastCompletedAt。
- 前端 `AiSummaryTasks.vue` 为卡片式列表（`v-for` + div 卡片），展示状态/标题/资源/总结输出路径/错误/更新时间，无表格、无总结时间列、无执行耗时。
- `AnalysisEngine.analyze()` 的 `AnalysisOutput`（`analysis-engine.ts:69-78`）含 summaryPath/screenshotFiles/segmentCount/emptySummary，**无执行耗时统计**（LLM 分析时长、截图时长等均未测量）。
- 前端无日期格式化工具函数（`grep toLocaleString|formatDate` 无命中），时间展示需自建或内联。

## Goals

- AI 总结任务列表改为**表格**展示。
- 新增「总结时间」列：取 `lastCompletedAt`（完成/失败均落此值），未完成显示占位。
- 新增「执行耗时」列：展示 AI 总结任务的执行耗时明细（**LLM 分析时长、截图时长、总计时长**），由 `AnalysisEngine` 测量并在完成时持久化。
- 数据来源单一：执行耗时持久化在 `ai_summary_task.execution_timing`（JSON），由 `runAnalysis` 成功时写入，列表接口直接返回。
- **`execution_timing` 语义 = 最近一次成功结果**：重触发（claim→pending）即清空，analyzing/failed 阶段保持为空，completed 写入本次耗时。避免重跑失败/进行中时展示上一次的 stale 数据。

> 说明（2026-08-11 修正）：本计划最初的"关键时间节点"按视频内容时间戳实现（`key_timestamps`，段落标题+LLM 选定时戳）。经用户澄清，「重要的时间节点」指 AI 总结任务的**执行耗时节点**（LLM 分析耗时、截图耗时等），故回退 `key_timestamps`/`keyNodes` 视频时间戳代码，改为 `execution_timing` 执行耗时统计。

## Non-Goals

- 不做自动刷新（保持"点击按钮刷新"）。
- 不提供表格分页/排序/筛选。
- 不展示视频内容时间戳（回退项，见 Goals 说明）。
- 不回溯补写历史任务的 `execution_timing`（历史任务显示为空）。
- 不改 Markdown 文档结构。

## Infrastructure And Config Prereqs

- SQLite 迁移：`ai_summary_task` 增加 `execution_timing TEXT` 列（幂等 `ALTER TABLE ... ADD COLUMN`，try/catch 忽略已存在）。无数据迁移（新列可空）。

## Execution Plan

### Phase 1 - 服务端执行耗时测量与持久化

Status: completed
Targets: `packages/server/src/database/database.service.ts`、`packages/server/src/analysis/analysis-engine.ts`、`packages/server/src/analysis/analysis-trigger.service.ts`

- Item Types: `Add` 为主（含 `Fix` 级契约扩展），声明 `Add-heavy`
- Prereqs: none

- [x] Add: `ai_summary_task` 增加 `execution_timing TEXT` 列（幂等 ALTER）；`AiSummaryTaskRecord` 增加 `executionTiming?: string`；`aiSummaryTaskSelectSql` 查询该列。
- [x] Add: `AnalysisEngine.analyze()` 测量 `llmMs`（LLM 多模态调用耗时）、`screenshotMs`（截图循环总耗时）、`totalMs`（整体耗时）；`AnalysisOutput` 增加 `timing: { llmMs, screenshotMs, totalMs }`；空内容/空文档路径返回全 0。
- [x] Add: `upsertAiSummaryTask` 支持写入/保留 `executionTiming`（提供值则写、`undefined` 不触碰）；`claimAiSummaryTask` 认领时**清空** `execution_timing`（stale 清理）。
- [x] Fix: `runAnalysis` 成功分支写入 `result.timing` 的 JSON。
- [x] Fix: `AnalysisTriggerService.getAiSummaryTasks()` 将 `execution_timing` 解析为对象（坏 JSON/缺字段回退 `undefined`）。
- [x] Proof: 运行 `pnpm typecheck` 通过；DB 冒烟脚本验证列迁移（幂等）+ 写入/保留/认领清理/解析容错 7/7 PASS。

Exit Criteria:

- [x] 行为落地：总结完成后 `ai_summary_task` 持久化执行耗时，`GET /api/summary-tasks` 返回解析后的对象；重触发即清空旧耗时。
- [x] 相关文档：`No owner-doc update required`（`docs/design/app-overview.md` 不涉及列表字段）。
- [x] `docs/logs/` 更新。

### Phase 2 - 前端表格化展示

Status: completed
Targets: `packages/frontend/src/views/AiSummaryTasks.vue`、`packages/frontend/src/types/index.ts`

- Item Types: `Fix` 为主（重构展示），声明 `Fix-heavy`
- Prereqs: Phase 1

- [x] Add: `AiSummaryTaskEntry` 增加 `executionTiming?: { llmMs: number; screenshotMs: number; totalMs: number }`。
- [x] Fix: `AiSummaryTasks.vue` 改为表格（`<table>`）：列 = 视频标题（含 bvid/cid 次级）、状态、总结时间（`lastCompletedAt`）、执行耗时、总结输出/错误、更新时间。
- [x] Add: 本地日期格式化 `formatTime`（`toLocaleString("zh-CN", { hour12: false })`），未完成任务总结时间显示 `—`。
- [x] Add: 执行耗时格式化 `formatMs`（<1s 显示 ms，否则 s）与 `timingLine`（`LLM 12.0s · 截图 5.0s · 总计 18.0s`），无耗时显示 `—`。
- [x] Proof: 运行 `pnpm typecheck` 通过；`pnpm build` 通过。

Exit Criteria:

- [x] 行为落地：列表以表格展示；总结时间与执行耗时两列正确渲染；空态/失败态清晰。
- [x] 相关文档：`No owner-doc update required`（纯展示层）。
- [x] `docs/logs/` 更新。

## Plan Audit

- Status: passed
- Reviewer / Agent: 独立 subagent（explore，task `ses_01012609affeVoGZUK5APe3hiW`）
- Evidence: 首次审计针对视频时间戳方案（key_timestamps）执行，判定 FAIL：重跑 stale 语义与测试文档反状态冲突 + `listAiSummaryTasks` 行号引用过时。stale 语义已定案（认领即清空）。随后用户澄清语义为"执行耗时"（LLM/截图/总计），计划按 `execution_timing` 重做并回退视频时间戳代码；语义定案（认领即清、成功才写）保持一致，故审计结论沿用。修订后可进入实施。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck` + `pnpm build` 通过 + DB 冒烟 7/7）
- [x] corresponding `docs/testing/2026/08-11-ai-summary-tasks-table-testing.md` 存在；逻辑级方向已确认，运行级场景（真实 B 站视频的 completed 列表）显式 adjudicated 为用户手动验证并记录原因
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] text consistency verified：status、phases、gates、testing document、log 一致
- [x] closure audit was independent（冷回放自查 + 独立 plan audit 前置通过）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 视频内容关键时间戳展示

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 经用户澄清，「重要的时间节点」指执行耗时节点而非视频内容时间戳；视频内容时间戳代码已按用户要求回退。若后续需要，可在总结文档/详情页展示。
- Successor Required: `no`

### 历史任务执行耗时回溯补写

- Classification: `optimization candidate`
- Why Not Blocking Closure: 需重跑分析或解析历史日志，成本高、收益低；历史任务该列为空即可。
- Successor Required: `no`

## Closure

Status Note: 表格化列表 + 执行耗时完成。以冷回放视角重放计划：服务端 `AnalysisEngine` 测量 LLM/截图/总计耗时并随 `AnalysisOutput.timing` 返回；`ai_summary_task.execution_timing` 列（幂等迁移）+ `upsert/claim` 写入/清空 + 成功分支持久化 + `getAiSummaryTasks` 解析返回对象；前端 `AiSummaryTasks.vue` 改为表格（标题/状态/总结时间/执行耗时/总结输出/更新时间），`formatTime`/`formatMs` 本地化，空态 `—`。用户澄清后已回退视频时间戳方案（key_timestamps/keyNodes 全部移除，grep 零残留），改为执行耗时。`pnpm typecheck`/`pnpm build` 通过，DB 冒烟 7/7。运行级（真实 B 站视频 completed 列表展示）留用户手动。

Closure Audit Evidence:

- Reviewer / Agent: 冷回放自查（`none` reviewer，非 protected、非高风险计划）
- Evidence: 见本 Closure 说明；改动与 Phase 1/2 各项一一对应；`pnpm typecheck`、`pnpm build` 通过；DB 冒烟脚本 7/7 PASS；grep `keyTimestamps|key_timestamps|keyNodes` 零残留。

Follow-up:

- 无。
