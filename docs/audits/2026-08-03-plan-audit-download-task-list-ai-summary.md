# 2026-08-03 Plan Audit - 下载任务列表 AI 总结入口与任务列表

## Superseded Status

- Status: `superseded by 2026-08-04 scheme-B re-audit`
- Reason: 本文件针对旧方案完成审计，旧方案仍将下载任务列表定义为本地下载队列视图。2026-08-04 用户已明确切换到方案 B，要求下载任务页改为服务端分页任务列表、过滤替代“清空已完成”、轮询仅覆盖当前页非终态任务。
- Current Use: 仅保留为历史审计记录，不再作为当前 active plan 的实施门禁结论。

- Plan: `docs/plans/2026-08-03-download-task-list-ai-summary-plan.md`
- Requirement: `docs/requirements/2026-08-03-download-task-list-ai-summary.md`
- Testing: `docs/testing/2026/08-03-download-task-list-ai-summary-testing.md`
- Audit Mode: independent subagent review
- Reviewer / Agent: `assessment-coordinator`

## Round 1 Result

- Verdict: `FAIL`

### Findings

1. Blocker: plan 错误地把 cold-replay 当作 full plan 的默认审计兜底。
2. Major: 下载任务列表的数据真相仍有隐藏依赖，未显式收敛本地 `taskId` 队列与全量 AI 总结任务列表的边界。
3. Major: 资源级 AI 总结主表与 `task.summary_*` 镜像双写关系缺少显式执行项与 proof。
4. Major: testing 文档缺少 API 负向契约与页面刷新恢复边界的 anti-state 覆盖。

### Durable Fixes Applied

- requirement 已收敛：明确采用资源级 AI 总结主表；明确 `analysis_sub_task` 仅承担低分辨率下载子任务；明确 `Downloading.vue` 继续是本地下载队列视图，而独立 AI 总结任务列表页承担全量历史查看。
- plan 已修订：
  - 将 cold-replay 从默认 closure 兜底改为“若无独立 reviewer / subagent，计划保持 open”。
  - 补充 `ai_summary_task` 与 `task.summary_*` 的主从关系、读取优先级与同步时机的显式执行项和 exit criteria。
  - 补充下载任务列表与 AI 总结任务列表的数据真相边界 decision。
  - 补充 testing forbidden states 覆盖要求。
- testing 文档已新增：
  - 无效 taskId / 未完成任务 negative path
  - 进行中重复触发与资源唯一性 negative path
  - 页面刷新恢复边界

## Historical Outcome

- 本文件记录的 Round 2 `PASS` 与“implementation-ready”结论仅适用于旧方案。
- 由于 2026-08-04 已切换到方案 B，上述结论不再构成当前 active plan 的实施门禁证据。
- 当前实施门禁以后续独立的方案 B re-audit 记录为准。

