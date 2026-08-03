# 2026-08-03 下载任务列表 AI 总结入口与任务列表计划

> Plan Status: in progress
> Last Reviewed: 2026-08-03
> Source: `docs/requirements/2026-08-03-download-task-list-ai-summary.md`
> Related: `docs/requirements/2026-07-07-ai-summary-interaction-5a.md`, `docs/requirements/2026-07-07-ai-summary-interaction-5b.md`, `docs/design/app-overview.md`
> Audit: required
> Testing: `docs/testing/2026/08-03-download-task-list-ai-summary-testing.md`

## Current Baseline

- `packages/frontend/src/views/Downloading.vue` 当前仅展示下载任务状态、输出路径、暂停/恢复/取消/清空已完成；页面通过 `queueStore.taskIds` 对非终态下载任务做 3 秒轮询，终态任务停止轮询；无 AI 总结按钮、无 AI 总结状态展示、无独立 AI 总结任务页。
- `packages/frontend/src/router/index.ts` 当前仅注册 `/`、`/parse-result`、`/parse-result/list`、`/video`、`/downloading`、`/settings`、`/login`；`App.vue` 顶栏也只有“下载队列”和“设置”等入口，没有 AI 总结任务页导航。
- `packages/frontend/src/api/index.ts` 当前仅有 `triggerAiSummary({ bvid, cid })` 和 `setAutoSummary(taskId, enabled)`；没有按 `taskId` 触发 AI 总结的接口，也没有 AI 总结任务列表查询接口。
- `packages/frontend/src/types/index.ts` 的 `TaskEntry` 当前没有 `bvid`、`cid`、`summaryStatus`、`summaryOutput` 等字段，前端无法仅凭任务列表数据判断“立刻 AI 总结”还是“重新 AI 总结”。
- `packages/server/src/download/download.controller.ts` 当前仅提供下载任务的 create/stop/resume/get/list/clear/check 和 `POST /api/tasks/:id/auto-summary`；没有“对已完成下载任务直接发起 AI 总结”的任务级接口。
- `packages/server/src/analysis/analysis.controller.ts` 当前公开的正式 AI 总结触发入口是 `POST /api/analysis/trigger`，其输入主键是 `bvid + cid`。该入口会按资源查找最新下载任务；如果任务不存在则创建一键 AI 总结下载任务；如果找到任务且 `autoSummary` 已开启则返回冲突；这与“已完成任务可重跑并覆盖同资源 AI 总结任务状态”的新需求不一致。
- `packages/server/src/analysis/analysis-trigger.service.ts` 当前将 AI 总结状态写回下载任务表的 `summary_status` / `summary_output` 字段，并使用 `analysis_sub_task` 记录低分辨率下载子任务；状态主键仍是下载任务 `taskId`，不是资源级 `bvid + cid`。
- `packages/server/src/database/database.service.ts` 当前只有 `task` 表和 `analysis_sub_task` 表。`task` 表虽然包含 `summary_status` / `summary_output`，但它描述的是某次下载任务的 AI 总结结果，而不是“同一视频资源唯一 1 条 AI 总结任务记录”。仓库中也没有 AI 总结任务列表查询能力。
- `docs/design/app-overview.md` 当前仅声明用户可以在下载列表中查看进度、结果和输出文件路径；并未声明下载任务列表中的 AI 总结入口，也未声明独立的 AI 总结任务列表页。
- 当前切片同时改变数据库模型、后端 API、前端任务列表、前端路由/导航和用户可见状态规则，不符合 no-plan 或 micro-plan 条件，必须走 full plan + audit。

## Goals

- 为已完成下载任务提供直接 AI 总结入口，且按钮文案按资源历史状态区分“立刻 AI 总结”与“重新 AI 总结”。
- 新增资源级 AI 总结任务主记录，确保同一 `bvid + cid` 只有唯一 1 条当前 AI 总结任务，并在重复触发时覆盖原状态而不是新增第二条记录。
- 新增独立的 AI 总结任务列表页，以手动刷新方式展示所有 AI 总结任务的状态。
- 保持现有 `AnalysisTriggerService` / `AnalysisEngine` 编排链路为唯一执行链路，不复制第二套 AI 分析流程。

## Non-Goals

- 不改动 `AnalysisEngine` 的多模态分析逻辑、Prompt 结构、截图逻辑或 Markdown 生成格式。
- 不实现 AI 总结结果预览、下载、分享、删除。
- 不实现 AI 总结任务的自动刷新、轮询、SSE 或 WebSocket 推送。
- 不保留同一视频资源的多版本 AI 总结历史列表。
- 不在本切片中重构现有下载队列的整体轮询策略，除非为满足本需求的正确状态展示而必须做局部调整。

## Infrastructure And Config Prereqs

- No infra prereqs beyond existing baseline.
- 继续沿用现有 AI 总结运行前提：`QWEN_API_KEY`、`QWEN_API_BASE`、`QWEN_MODEL`、`QWEN_VISION_PROXY_URL`、`QWEN_VISION_MODEL` 等环境变量与 Python vision proxy 基线。
- SQLite 仍为唯一持久化来源；若新增资源级 AI 总结主表，迁移必须在 `DatabaseService.initSchema()` 中完成并兼容已有 `tasks.db`。
- 当前 reviewer availability = `none`。本次 plan audit 已通过独立 subagent 审计获取 reviewer 证据；后续 closure 不得预设 cold-replay 为默认兜底，若届时无法获得独立 reviewer / subagent，则计划保持 open，直到获得可接受的独立 closure 证据。该切片涉及数据模型与 API，但不触及 auth、data deletion、payment、deployment。

## Execution Plan

### Phase 1 - 资源级 AI 总结主记录与后端契约

Status: completed
Targets: `packages/server/src/database/database.service.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`, `packages/server/src/analysis/analysis.controller.ts`, `packages/server/src/download/download.controller.ts`, `packages/server/src/analysis/analysis.module.ts`, `packages/server/src/download/download.service.ts`（如需任务展示字段补齐）

- Item Types: `Decision | Add | Fix | Proof`
- Prereqs: plan audit passed

- [x] **Decision**：新增资源级 `ai_summary_task` 主表作为 AI 总结任务的唯一 source of truth，唯一键为 `bvid + cid`；`analysis_sub_task` 继续仅承担低分辨率下载子任务职责。替代方案一：继续把 `task.summary_status` 作为唯一真相，按最新下载任务推导列表（拒绝，无法满足“同资源唯一 1 条 AI 总结任务记录”且会随多次下载漂移）。替代方案二：直接复用 `analysis_sub_task` 承担用户可见主任务（拒绝，其语义是低分辨率下载技术子任务，不等同 AI 总结主任务）。Residual risk：短期内会出现下载任务表与 AI 总结主表的双写关系，需要在实现中明确主从关系。
- [x] **Add**：在 SQLite 中新增资源级 AI 总结主表及唯一索引，并为 `DatabaseService` 增加按 `bvid + cid` 查询、按资源 upsert、按更新时间倒序列出 AI 总结任务、按下载任务联查资源级 AI 总结状态的读写能力。
- [x] **Decision**：保留 `task.summary_status` / `task.summary_output` 作为兼容镜像字段，仅用于下载任务视图和已有日志/通知链路过渡；资源级 `ai_summary_task` 为按钮文案、AI 总结任务列表和重跑覆盖语义的唯一判断依据。替代方案：一次性删除或停写 `task.summary_*`（拒绝，本切片会放大改动面并破坏现有 5b/5d 已落地链路）。Residual risk：实现阶段必须避免镜像字段与主表状态不一致。
- [x] **Add**：定义并实现资源级主表与 `task.summary_*` 镜像字段的主从规则：读取优先级以 `ai_summary_task` 为准；写入时在 trigger started / waiting / completed / failed / rerun reset 各阶段同步更新主表与镜像字段；已有历史下载任务在新主表不存在时不得被误判为“已分析完成”。
- [x] **Fix**：调整 `AnalysisTriggerService`，使其在触发、等待低清、成功、失败和重跑时同步更新资源级 AI 总结主记录；再次触发同一资源时重置同一条记录的状态、错误信息、结果路径和更新时间，而不是插入第二条记录。
- [x] **Add**：新增 `POST /api/tasks/:id/summary`，仅允许对 `status = success` 的下载任务触发；服务端通过 `taskId -> bvid/cid` 归并到资源级 AI 总结主记录，再复用现有 `AnalysisTriggerService`。
- [x] **Add**：新增 `GET /api/summary-tasks`，返回资源级 AI 总结任务列表，至少包含 `id`、`bvid`、`cid`、`title`、`status`、`summaryOutput`、`errorMessage`、`updatedAt`。
- [x] **Fix**：补齐下载任务查询返回值，使本地下载队列视图在仅依赖 `queueStore.taskIds` 的前提下，能够拿到判定按钮文案和当前 AI 总结状态所需的字段；不把 `Downloading.vue` 扩展为服务端全量历史任务页。
- [x] **Proof**：确保 `docs/testing/2026/08-03-download-task-list-ai-summary-testing.md` 在实现前已覆盖资源唯一性、taskId 触发、重跑覆盖、列表状态、无效 taskId / 非 success 任务 / 进行中重复触发等 forbidden states。

Exit Criteria:

- [x] 资源级 AI 总结主记录与唯一键设计已落地，且不再依赖“最新下载任务”推断是否分析过。
- [x] `POST /api/tasks/:id/summary` 与 `GET /api/summary-tasks` 合同明确可实现。
- [x] 同一资源再次触发 AI 总结会覆盖同一条主记录状态，而不是新增第二条同资源记录。
- [x] `ai_summary_task` 与 `task.summary_*` 的主从关系、读取优先级和同步时机已定义且可验证。
- [x] No owner-doc update required until Phase 3 completes because Phase 1 only lands backend contract and persistence foundation; current supported app baseline is not complete until frontend surfaces land.

### Phase 2 - 下载任务列表入口与 AI 总结任务列表页

Status: completed
Targets: `packages/frontend/src/views/Downloading.vue`, `packages/frontend/src/views/AiSummaryTasks.vue`（new）, `packages/frontend/src/router/index.ts`, `packages/frontend/src/App.vue`, `packages/frontend/src/api/index.ts`, `packages/frontend/src/types/index.ts`

- Item Types: `Add | Fix | Proof`
- Prereqs: Phase 1

- [x] **Add**：在下载任务列表页为 `status = success` 的任务增加 AI 总结按钮与状态展示。
- [x] **Fix**：按钮文案依据资源级 AI 总结主记录切换：无记录时显示“立刻 AI 总结”；已有记录但当前不在进行中时显示“重新 AI 总结”；进行中时展示不可重复提交状态。
- [x] **Decision**：下载任务列表页继续保持“本地下载队列视图”，其数据源仍然是浏览器持久化的 `taskId` 集合加上服务端按 taskId 拉取的任务详情；独立 AI 总结任务列表页承担服务端全量 AI 总结历史可见性。替代方案：将下载队列页改为服务端全量历史下载任务页（拒绝，本切片会扩大下载域范围并与既有 queueStore 心智冲突）。Residual risk：用户若清空本地队列，将只能从 AI 总结任务列表页查看该资源的 AI 总结状态。
- [x] **Fix**：用户从下载任务列表点击按钮后，前端走 `POST /api/tasks/:id/summary`，并在本次操作后刷新当前任务所需状态；页面刷新后的恢复范围明确限定为“仍保存在本地队列中的任务 ID”。
- [x] **Add**：新增 AI 总结任务列表页与路由，并在主导航中提供入口。
- [x] **Add**：AI 总结任务列表页展示至少“待总结 / 总结中 / 总结失败 / 总结完成”四类状态，以及必要的视频标题、资源标识和结果摘要。
- [x] **Fix**：AI 总结任务列表页仅在首次进入时请求一次数据；后续只有用户点击“刷新任务状态”按钮时才重新请求，不能存在自动轮询副作用。
- [ ] **Proof**：手动观察下载任务列表页与 AI 总结任务列表页的按钮文案、刷新行为和状态映射，确保页面行为与 requirement 对齐而不是仅接口存在。

Exit Criteria:

- [ ] 下载任务列表页能正确区分“立刻 AI 总结”与“重新 AI 总结”。
- [ ] AI 总结任务列表页存在、可访问，并只支持手动刷新。
- [ ] 进行中的同一资源不能重复触发 AI 总结。
- [x] 下载任务列表页与 AI 总结任务列表页的数据真相边界清晰：前者是本地下载队列视图，后者是服务端全量 AI 总结任务视图。
- [x] No owner-doc update required until Phase 3 because the final supported baseline description should be updated once both surfaces and backend contracts are complete.

### Phase 3 - Owner-Doc Alignment And Verification

Status: in progress
Targets: `docs/design/app-overview.md`, `docs/testing/2026/08-03-download-task-list-ai-summary-testing.md`, `docs/logs/2026/08-03.md`, `docs/context/project-context.md`, `docs/backlog/README.md`, `docs/plans/2026-08-03-download-task-list-ai-summary-plan.md`

- Item Types: `Fix | Proof`
- Prereqs: Phase 2

- [x] **Fix**：更新 `docs/design/app-overview.md`，明确下载任务列表支持对已完成任务直接发起 AI 总结，且新增独立 AI 总结任务列表页。
- [ ] **Fix**：在测试文档中回填每个 requirement-level direction 的结果，包含 should / should-not 证据或明确 adjudication。
- [x] **Proof**：运行 `pnpm typecheck` 与 `pnpm build`。
- [ ] **Proof**：执行最小 API / UI 级验证，至少覆盖：已完成任务触发、同资源重跑覆盖、AI 总结任务列表手动刷新、四类状态映射。
- [x] **Fix**：将 `project-context`、`backlog`、`logs` 与计划状态保持一致，确保 closure 时文本一致性可验证。

Exit Criteria:

- [ ] owner doc 已更新为当前支持基线。
- [ ] `docs/testing/` 对应方向已回填验证结果。
- [ ] `pnpm typecheck` 与 `pnpm build` 已运行并记录结果。
- [ ] `docs/logs/` 已更新。

## Plan Audit

- Status: passed
- Reviewer / Agent: independent subagent (`assessment-coordinator`)
- Evidence: 2026-08-03 第二轮复审确认首轮 1 个 blocker 与 3 个 major 已全部修复：计划已移除 cold-replay 兜底误判，明确了本地下载队列与全量 AI 总结列表的真相边界，定义了 `ai_summary_task` 与 `task.summary_*` 镜像的主从规则及 proof，并补齐了 API anti-states 与刷新恢复边界测试方向。详见 `docs/audits/2026-08-03-plan-audit-download-task-list-ai-summary.md`。

## Closure Gates

- [ ] in-scope behavior is complete
- [ ] relevant docs are aligned
- [ ] verification has run (`pnpm typecheck`, `pnpm build`, plus focused manual/API observation for the new surfaces)
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred/follow-up
- [ ] plan audit passed before implementation
- [ ] text consistency verified: status, phases, gates, testing document, and log all agree
- [ ] closure audit was independent reviewer / subagent based; if no independent reviewer is available at closure time, the plan remains open until such evidence exists
- [ ] closure evidence exists in files

## Deferred But Adjudicated

### AI 总结历史版本列表

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 当前需求只要求同资源唯一 1 条当前 AI 总结任务，并在重跑时覆盖状态；历史版本留存会引入额外表结构、结果归档与 UI 范围。
- Successor Required: `no`

### AI 总结实时推送

- Classification: `watch-only residual`
- Why Not Blocking Closure: 当前需求明确要求 AI 总结任务列表页仅支持手动刷新，不做自动刷新或实时推送。
- Successor Required: `no`

## Closure

Status Note: pending

Closure Audit Evidence:

- Reviewer / Agent: pending
- Evidence: pending

Follow-up:

- 无
