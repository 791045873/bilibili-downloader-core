# 2026-08-03 AI 总结任务列表已知缺口

## Summary

本记录用于明确 `下载任务列表 AI 总结入口与任务列表` 当前实现后的已知遗留问题。以下问题在 2026-08-03 的实现提交中尚未修复，需后续继续处理或验证后再关闭计划。

## Known Gaps

### 1. 进行中的重复触发尚未在服务端强约束拦截

- Surface: `POST /api/tasks/:id/summary`
- Current behavior: 前端会根据 `summaryStatus` 禁用“AI 总结中”按钮，但服务端当前未基于资源级 `ai_summary_task.status` 对重复触发做强制冲突拦截。
- Risk: 同一资源如果被并发调用任务级接口，仍有机会进入重复触发或状态互相覆盖的竞争态。
- Why still open: 当前仅完成了 UI 层禁用与 not-found 负向契约验证，尚未补服务端 conflict guard，也未完成该分支的运行时复验。

### 2. 既有历史 AI 总结结果未回填到新资源级主表

- Surface: `GET /api/summary-tasks`
- Current behavior: 资源级 `ai_summary_task` 只会在新触发的 AI 总结流程中写入；历史上仅存在于 `task.summary_status` / `task.summary_output` 的老数据不会自动出现在新列表接口中。
- Risk: 独立 AI 总结任务列表页在本次迁移后只展示“新主表中存在的记录”，不能完整反映历史所有 AI 总结任务。
- Why still open: 当前实现优先保证新数据模型与正式接口落地，尚未增加一次性 backfill / lazy backfill 策略。

## Verification Gaps

### 1. 成功路径的人工 UI 复验未完成

- 未完整验证：已完成下载任务点击“立刻 AI 总结”后的按钮文案切换、列表页手动刷新后状态映射、以及“重新 AI 总结”路径的浏览器可见行为。

### 2. 资源唯一性与重复触发冲突分支未完成运行时复验

- 未完整验证：同一资源重跑后仍只保留 1 条记录、进行中重复触发返回明确冲突、未完成下载任务触发返回 `409`。

## Suggested Follow-up

1. 在 `AnalysisTaskController` 或 `AnalysisTriggerService` 增加基于资源级 `ai_summary_task.status` 的服务端重复触发拦截。
2. 为历史 `task.summary_status != 'none'` 的记录设计一次性 backfill 或按需回填策略，使 `GET /api/summary-tasks` 能覆盖历史总结记录。
3. 完成计划 `docs/plans/2026-08-03-download-task-list-ai-summary-plan.md` Phase 2 / Phase 3 剩余 proof，并执行 closure audit。
