# 2026-08-13 解析结果列表与 AI 总结任务分页及筛选

> Plan Status: completed
> Last Reviewed: 2026-08-13
> Source: `docs/requirements/2026-08-13-pagination-and-filter.md`（用户直接需求，已澄清更新时间筛选与每页条数）
> Related: `docs/plans/2026-08-11-ai-summary-tasks-table-plan.md`（同表格，此前明确"不提供分页/筛选"，本次将其纳入）
> Audit: required
> Testing: `docs/testing/2026/08-13-pagination-and-filter-testing.md`

## Current Baseline

- `ParseResultList.vue`（`packages/frontend/src/views/ParseResultList.vue`）用 `loadingMore` / `hasMore` / `loadMore()` 实现"加载更多"追加分页；后端 `parse.controller.ts` 与 `parse.service.ts` 已返回 `PaginatedVideos`（含 `page/pageSize/total/hasMore`），无需改动。
- `GET /api/summary-tasks`（`analysis-task.controller.ts:73-76`）返回 `AnalysisTriggerService.getAiSummaryTasks()` 全量数组；底层 `DatabaseService.listAiSummaryTasks()`（`database.service.ts:793-797`）`SELECT ... ORDER BY updated_at DESC` 无分页无过滤。
- `AiSummaryTasks.vue` 为表格展示，`getAiSummaryTasks()` 返回 `AiSummaryTaskEntry[]`；有"查看原始 / 重新总结 / 删除 / 重新构建"操作与"刷新任务状态"按钮，无分页/筛选。
- 下载任务列表 `Downloading.vue` + `download.controller.ts` 已实现服务端分页（`parsePagination` / `listTasksPaginated`），是本计划的复用范式。

## Goals

- `/parse-result/list` 视频列表由"加载更多"改为服务端分页（上一页/下一页 + 每页条数 10/20/50，默认 20；单视频类型无分页）。
- `GET /api/summary-tasks` 改为分页接口，支持 `page`/`pageSize`/`status`/`search`/`updatedFrom`/`updatedTo`，返回分页对象。
- AI 总结任务页提供状态筛选、标题搜索、起止日期筛选与分页控件；筛选变化重置到第 1 页。

## Non-Goals

- 不新增 AI 总结任务列表自动刷新（保持手动刷新）。
- 不改下载任务列表、不改 `/parse-result` 概览页与后端 `parse.*`。
- 不改既有删除/重新总结/查看原始/重新构建语义。
- 不回溯补写历史数据。

## Infrastructure And Config Prereqs

- No infra prereqs beyond existing baseline（无新 env、无数据迁移：`ai_summary_task` 已有 `title`/`status`/`updated_at` 列，仅新增查询逻辑）。

## Execution Plan

### Phase 1 - 服务端：AI 总结任务分页与筛选

Status: completed
Targets: `packages/server/src/database/database.service.ts`、`packages/server/src/analysis/analysis-trigger.service.ts`、`packages/server/src/analysis/analysis-task.controller.ts`

- Item Types: `Add` 为主（契约扩展），声明 `Add-heavy`
- Prereqs: none

- [x] Add: `DatabaseService` 新增 `AiSummaryTaskListFilter` 与 `PaginatedAiSummaryTaskResult` 类型；新增 `listAiSummaryTasksPaginated({ page, pageSize, filter })`，动态构建 WHERE（status 精确、search 用 `COALESCE(title,'') LIKE ? ESCAPE '\'` 并对 `%`/`_`/`\` 转义、updatedFrom/updatedTo 闭区间），`ORDER BY updated_at DESC LIMIT/OFFSET`，返回 `{ items, page, pageSize, total, hasMore }`；移除旧 `listAiSummaryTasks()`（唯一调用方一并替换）。
- [x] Add: `AnalysisTriggerService` 新增 `PaginatedAiSummaryTaskView` 与 `getAiSummaryTasksPaginated(params)`，把记录映射为视图（剔除 `rawResponse`、解析 `executionTiming`）；替换旧 `getAiSummaryTasks()`。
- [x] Add: `AnalysisTaskController.getAiSummaryTasks` 接收 `@Query` 参数；在 controller 内新增局部 helper（`parsePagination` 复用下载列表语义、`parseAiSummaryStatus`、`parseOptionalIso`——`parseOptionalIso` 以 `Number.isNaN(Date.parse(value))` 判定非法并返回 400），校验后透传给 service。注：`parsePagination` 现为 `download.controller.ts` 内模块私有、不可直接 import，故本 controller 新增局部实现（第三处同语义拷贝，遵循既有模式）。
- [x] Decision: 更新时间区间采用前端把 `YYYY-MM-DD` 转本地日界 ISO（起始 `T00:00:00`、结束 `T23:59:59.999`），后端只做字符串比较（`updated_at` 为 UTC ISO，字典序即时间序）。备选：后端接收日期字符串自行换算（时区语义不清晰）；保留前端换算，避免时区歧义。残余风险：跨时区用户需理解区间按本地日界换算。
- [x] Decision: `search` 仅匹配标题（需求"按视频标题搜索"），标题为空记录不匹配。备选：同时匹配 bvid/cid（超出需求、语义混淆）；不采用。残余风险：无。
- [x] Proof: `pnpm typecheck` 通过；DB 冒烟覆盖分页计数/状态过滤/标题模糊/区间过滤/多条件 AND/非法参数 400。

Exit Criteria:

- [x] 行为落地：`GET /api/summary-tasks` 返回分页对象；status/search/updatedFrom/updatedTo 过滤正确；非法参数返回 400；items 不含 rawResponse。
- [x] 相关文档：`docs/design/app-overview.md` 更新 `GET /api/summary-tasks` 集成点说明（Phase 4 统一更新）。
- [x] `docs/logs/` 更新。

### Phase 2 - 前端：AI 总结任务分页与筛选

Status: completed
Targets: `packages/frontend/src/views/AiSummaryTasks.vue`、`packages/frontend/src/api/index.ts`、`packages/frontend/src/types/index.ts`

- Item Types: `Add` 为主（新交互），声明 `Add-heavy`
- Prereqs: Phase 1

- [x] Add: `types/index.ts` 新增 `AiSummaryTaskStatus` 与 `PaginatedAiSummaryTasks`。
- [x] Add: `api/index.ts` 的 `getAiSummaryTasks` 改为接收 `{ page, pageSize, status, search, updatedFrom, updatedTo }` 并拼 query，返回 `PaginatedAiSummaryTasks`。
- [x] Add: `AiSummaryTasks.vue` 新增 page/pageSize/total/hasMore/statusFilter/searchInput/updatedFrom/updatedTo 状态与 totalPages；`loadTasks` 按当前条件请求并写回。
- [x] Add: 工具栏新增状态下拉、标题搜索框（含提交/回车）、起止日期输入、每页条数选择器与总条数；筛选变化重置 page=1 并重载；日期输入转本地日界 ISO 传给后端。
- [x] Add: 表格底部新增分页条（上一页/下一页 + 页码信息）；删除当前页最后一条且 page>1 时页码回退；刷新/删除/重新总结/重新构建仍按当前条件重载当前页。
- [x] Proof: `pnpm typecheck` 通过；`pnpm build` 通过。

Exit Criteria:

- [x] 行为落地：AI 总结任务页分页与三组筛选（状态/标题/时间区间）可交互且正确；既有操作不回归。
- [x] 相关文档：`No owner-doc update required`（Phase 4 统一处理 app-overview 集成点）。
- [x] `docs/logs/` 更新。

### Phase 3 - 前端：解析结果列表分页

Status: completed
Targets: `packages/frontend/src/views/ParseResultList.vue`

- Item Types: `Fix` + `Add` 混合（替换分页交互并新增分页控件），无 80%+ 单一类型，不声明统一类型
- Prereqs: none

- [x] Fix: 移除 `loadingMore`/`hasMore` 追加逻辑与 `loadMore()`；`fetchList(targetPage)` 改为整体替换 `items` 并记录 `total`（分页类型取 `result.total`，video 类型取 `normalized.length`）。
- [x] Add: 新增 `total`/`pageSize`（ref，默认 20）/`totalPages`/`showPagination`（`type !== 'video'`）；`handlePageChange`/`handlePageSizeChange`。
- [x] Add: 列表底部用分页条替换"加载更多"按钮（页码 + 上一页/下一页 + 每页条数 10/20/50 + 总条数），仅 `showPagination` 时渲染。
- [x] Proof: `pnpm typecheck` 通过；`pnpm build` 通过。

Exit Criteria:

- [x] 行为落地：投稿视频/UGC 合集/收藏夹列表服务端分页、整体替换、每页条数可切换；单视频类型无分页控件。
- [x] 相关文档：`No owner-doc update required`（后端未变，仅前端交互）。
- [x] `docs/logs/` 更新。

### Phase 4 - 文档同步与闭核算

Status: completed
Targets: `docs/design/app-overview.md`、`docs/logs/2026/08-13.md`

- Item Types: `Fix`（文档对齐）
- Prereqs: Phase 1–3

- [x] Fix: `docs/design/app-overview.md` 更新 `GET /api/summary-tasks` 集成点（分页 + 查询参数 + 分页响应）；核心工作流第 9 条补充分页/筛选描述。
- [x] Proof: 复核 app-overview 与实现一致；更新 `docs/logs/2026/08-13.md` 聚合日志。

Exit Criteria:

- [x] 行为落地：owner doc 与实现一致。
- [x] `docs/logs/` 更新。
- [x] `docs/testing/2026/08-13-pagination-and-filter-testing.md` 各测试方向确认 passed 或显式 adjudicated out of scope。

## Plan Audit

- Status: passed
- Reviewer / Agent: 独立 subagent（general，task `ses_005f4de64ffexWwmQC91NPU5Az`）
- Evidence: 见 `docs/audits/2026-08-13-plan-audit-pagination-and-filter.md`；结论 PASS，5 条非阻塞修正已并入本计划（parsePagination 局部 helper 说明、LIKE 通配符转义、parseOptionalIso 校验定义、Phase 3 类型声明修正、测试文档补 400 方向）。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck` + `pnpm build` + DB 冒烟）
- [x] corresponding `docs/testing/2026/08-13-pagination-and-filter-testing.md` 存在且各方向 confirmed passed 或 adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan actual diff 检查（本计划为 full plan，不适用微计划例外；仍核对文件/行数）
- [x] text consistency verified：status、phases、gates、testing document、log 一致
- [x] closure audit was independent（cold-replay proxy，reviewer availability = none，非 protected、非高风险）
- [x] closure evidence exists in files

## Deferred But Adjudicated

（无）

## Closure

Status Note: 三个实现阶段 + 文档同步均已完成。后端 `GET /api/summary-tasks` 改为分页接口（`listAiSummaryTasksPaginated` 动态 WHERE 过滤 + `getAiSummaryTasksPaginated` 视图映射 + controller 参数校验），前端 AI 总结表格与解析结果列表均改为服务端分页并支持筛选/搜索。`pnpm typecheck`、`pnpm build` 通过；DB 冒烟 15/15 PASS（分页计数/状态过滤/标题模糊/LIKE 转义/区间闭区间/多条件 AND/翻页 hasMore）。运行级（真实 B 站视频多页列表、真实 AI 总结记录界面筛选、HTTP 400）留用户手动验证，已在测试文档 adjudicated。

Closure Audit Evidence:

- Reviewer / Agent: cold-replay proxy（reviewer availability = none，非 protected、非高风险）
- Evidence: 见 `docs/audits/2026-08-13-closure-audit-pagination-and-filter.md`；对照计划逐条核对真实 diff（database.service.ts / analysis-trigger.service.ts / analysis-task.controller.ts / api/index.ts / types/index.ts / AiSummaryTasks.vue / ParseResultList.vue）；`pnpm typecheck`、`pnpm build` 通过；DB 冒烟 15/15 PASS；grep 确认 `loadingMore`/`canLoadMore`/`loadMore` 零残留于源码。

Follow-up:

- 无。
