# 2026-08-03 下载任务列表分页、过滤与 AI 总结入口计划

> Plan Status: implementation-in-progress-awaiting-reaudit
> Last Reviewed: 2026-08-04
> Source: `docs/requirements/2026-08-03-download-task-list-ai-summary.md`
> Related: `docs/requirements/2026-07-07-ai-summary-interaction-5a.md`, `docs/requirements/2026-07-07-ai-summary-interaction-5b.md`, `docs/design/app-overview.md`
> Audit: required
> Testing: `docs/testing/2026/08-03-download-task-list-ai-summary-testing.md`

## Current Baseline

- `packages/server/src/download/download.controller.ts` 现已将 `GET /api/tasks` 切换为服务端分页接口，接受 `page`、`pageSize`、`statusGroup` 参数；`packages/server/src/database/database.service.ts` 已提供数据库分页查询、总量统计和状态组过滤能力。
- `packages/frontend/src/api/index.ts` 与 `packages/frontend/src/types/index.ts` 已补齐分页任务列表契约；`packages/frontend/src/views/Downloading.vue` 已切换为服务端分页数据源，移除了本地 `taskId` 列表驱动与“清空已完成”操作，新增状态过滤、分页控件和 pageSize 切换。
- `packages/frontend/src/views/Downloading.vue` 当前仅轮询“当前页非终态任务”，翻页、过滤切换、pageSize 切换和组件卸载时会释放旧轮询集合。
- `packages/server/src/analysis/analysis-task.controller.ts` 已在任务级触发入口增加基于资源级 AI 总结主记录的“进行中重复触发”冲突拦截；`packages/server/src/analysis/analysis-trigger.service.ts` 已开始在 pending / analyzing / completed / failed 等阶段同步写入 `ai_summary_task`。
- 当前切片在你选定方案 B 后，已从“本地下载队列视图补入口”升级为“服务端分页任务列表 + 过滤 + 当前页轮询 + AI 总结入口”，原 2026-08-03 审计基于旧方案，不再覆盖当前计划，必须重新审计后才能进入实现。

## Goals

- 为已完成下载任务提供直接 AI 总结入口，且按钮文案按资源历史状态区分“立刻 AI 总结”与“重新 AI 总结”。
- 将下载任务页切换为服务端分页任务列表，摆脱本地 `taskId` 集合对页面数据的主导。
- 用过滤操作替代“清空已完成”，并让下载任务查询接口支持对应过滤参数。
- 将下载页的自动轮询范围限制在“当前页非终态任务”。
- 新增资源级 AI 总结任务主记录，确保同一 `bvid + cid` 只有唯一 1 条当前 AI 总结任务，并在重复触发时覆盖原状态而不是新增第二条记录。
- 新增独立的 AI 总结任务列表页，以手动刷新方式展示所有 AI 总结任务的状态。
- 保持现有 `AnalysisTriggerService` / `AnalysisEngine` 编排链路为唯一执行链路，不复制第二套 AI 分析流程。

## Non-Goals

- 不改动 `AnalysisEngine` 的多模态分析逻辑、Prompt 结构、截图逻辑或 Markdown 生成格式。
- 不实现 AI 总结结果预览、下载、分享、删除。
- 不实现 AI 总结任务的自动刷新、轮询、SSE 或 WebSocket 推送。
- 不保留同一视频资源的多版本 AI 总结历史列表。
- 不在本切片中新增服务端删除已完成任务或“批量清理历史任务”能力。
- 不在本切片中为 AI 总结任务列表页引入自动分页，除非实现时规模问题已明确阻塞可用性。

## Infrastructure And Config Prereqs

- No infra prereqs beyond existing baseline.
- 继续沿用现有 AI 总结运行前提：`QWEN_API_KEY`、`QWEN_API_BASE`、`QWEN_MODEL`、`QWEN_VISION_PROXY_URL`、`QWEN_VISION_MODEL` 等环境变量与 Python vision proxy 基线。
- SQLite 仍为唯一持久化来源；若新增资源级 AI 总结主表，迁移必须在 `DatabaseService.initSchema()` 中完成并兼容已有 `tasks.db`。
- 当前 reviewer availability = `none`。由于本计划已改为方案 B，原 plan audit 证据不再可直接复用；实现前必须对更新后的计划重新做独立 subagent 审计。该切片涉及数据模型与 API，但不触及 auth、data deletion、payment、deployment。

## Execution Plan

### Phase 1 - 下载任务分页过滤契约与数据真相统一

Status: code-landed-awaiting-verification-evidence
Targets: `packages/server/src/download/download.controller.ts`, `packages/server/src/download/download.service.ts`, `packages/server/src/database/database.service.ts`, `packages/frontend/src/api/index.ts`, `packages/frontend/src/types/index.ts`

- Item Types: `Decision | Add | Fix | Proof`
- Prereqs: updated plan re-audit passed

- [x] **Decision**：将下载任务页的主数据源切换为服务端分页列表，`queueStore.taskIds` 不再决定页面展示内容。替代方案：继续保留本地队列为主、只在缺失时补拉服务端列表（拒绝，会形成双真相并放大分页/过滤复杂度）。Residual risk：已有“下载队列”命名可能与“服务端历史任务列表”心智冲突，需要在 UI 文案中明确。
- [x] **Add**：为 `GET /api/tasks` 定义分页与过滤合同，至少包含 `page`、`pageSize`、`statusGroup`，返回 `items`、`page`、`pageSize`、`total`、`hasMore`。
- [x] **Fix**：将下载任务列表接口的对外语义从内存 `taskCache` 切换为数据库分页读取，确保列表接口与详情接口来源一致。
- [x] **Add**：在 `DatabaseService` 中新增下载任务分页查询、总量统计与状态组过滤能力，并明确 `statusGroup=active` 映射 `created + downloading`。
- [x] **Add**：前端 API 层与类型层增加分页任务列表查询模型，移除下载页对“全量任务数组”返回结构的依赖。
- [ ] **Proof**：测试文档覆盖非法分页参数、空结果页、过滤后总量、分页翻页和服务端返回稳定排序等方向。

Exit Criteria:

- [x] 下载任务列表接口可按页、按过滤条件查询。
- [x] 列表与详情的数据来源已统一到数据库真相。
- [x] 前端已具备消费分页列表的 API 类型基础。

### Phase 2 - 资源级 AI 总结主记录与后端契约

Status: partial-complete-code-landed-awaiting-focused-verification
Targets: `packages/server/src/database/database.service.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`, `packages/server/src/analysis/analysis.controller.ts`, `packages/server/src/download/download.controller.ts`, `packages/server/src/analysis/analysis.module.ts`, `packages/server/src/download/download.service.ts`（如需任务展示字段补齐）

- Item Types: `Decision | Add | Fix | Proof`
- Prereqs: plan audit passed

- [x] **Decision**：新增资源级 `ai_summary_task` 主表作为 AI 总结任务的唯一 source of truth，唯一键为 `bvid + cid`；`analysis_sub_task` 继续仅承担低分辨率下载子任务职责。替代方案一：继续把 `task.summary_status` 作为唯一真相，按最新下载任务推导列表（拒绝，无法满足“同资源唯一 1 条 AI 总结任务记录”且会随多次下载漂移）。替代方案二：直接复用 `analysis_sub_task` 承担用户可见主任务（拒绝，其语义是低分辨率下载技术子任务，不等同 AI 总结主任务）。Residual risk：短期内会出现下载任务表与 AI 总结主表的双写关系，需要在实现中明确主从关系。
- [x] **Add**：在 SQLite 中新增资源级 AI 总结主表及唯一索引，并为 `DatabaseService` 增加按 `bvid + cid` 查询、按资源 upsert、按更新时间倒序列出 AI 总结任务、按下载任务联查资源级 AI 总结状态的读写能力。
- [x] **Decision**：保留 `task.summary_status` / `task.summary_output` 作为兼容镜像字段，仅用于下载任务视图和已有日志/通知链路过渡；资源级 `ai_summary_task` 为按钮文案、AI 总结任务列表和重跑覆盖语义的唯一判断依据。替代方案：一次性删除或停写 `task.summary_*`（拒绝，本切片会放大改动面并破坏现有 5b/5d 已落地链路）。Residual risk：实现阶段必须避免镜像字段与主表状态不一致。
- [x] **Add**：定义并开始实现资源级主表与 `task.summary_*` 镜像字段的主从规则：当前已在 pending / analyzing / completed / failed 阶段同步写入主表与镜像字段；waiting / rerun reset 与历史回填仍待验证。
- [x] **Fix**：调整 `AnalysisTriggerService`，使其在触发、等待低清、成功、失败阶段同步更新资源级 AI 总结主记录；再次触发同一资源的完整重跑覆盖语义仍待运行时验证。
- [x] **Add**：收紧 `POST /api/tasks/:id/summary` 的行为，使服务端在 `taskId -> bvid/cid` 归并后，能够基于资源级 AI 总结主记录拒绝“进行中重复触发”；允许重跑并覆盖同一条资源记录的运行时证据仍待补。
- [x] **Add**：新增 `GET /api/summary-tasks`，返回资源级 AI 总结任务列表，至少包含 `id`、`bvid`、`cid`、`title`、`status`、`summaryOutput`、`errorMessage`、`updatedAt`。
- [x] **Fix**：补齐下载任务详情查询返回值，使当前下载页按 `taskId` 拉取详情时能够拿到判定按钮文案和 AI 总结状态所需字段；服务端分页列表接口本身的切换仍属于 Phase 1 / Phase 3。
- [x] **Proof**：确保 `docs/testing/2026/08-03-download-task-list-ai-summary-testing.md` 在实现前已覆盖资源唯一性、taskId 触发、重跑覆盖、列表状态、无效 taskId / 非 success 任务 / 进行中重复触发等 forbidden states。

Exit Criteria:

- [ ] 资源级 AI 总结主记录与唯一键设计已在实际触发链路中落地，且不再依赖“最新下载任务”推断是否分析过。
- [x] `POST /api/tasks/:id/summary` 与 `GET /api/summary-tasks` 合同明确可实现。
- [ ] 同一资源再次触发 AI 总结会覆盖同一条主记录状态，而不是新增第二条同资源记录。
- [ ] `ai_summary_task` 与 `task.summary_*` 的主从关系、读取优先级和同步时机已定义并在 live code 中可验证。
- [x] owner doc 仍可延后到下载任务页分页方案落地后统一更新；当前阶段只形成部分后端契约与持久化基础。

### Phase 3 - 下载任务列表页改造与当前页轮询

Status: code-landed-awaiting-focused-verification
Targets: `packages/frontend/src/views/Downloading.vue`, `packages/frontend/src/stores/useDownloadQueueStore.ts`（如仍保留需降级职责）, `packages/frontend/src/api/index.ts`, `packages/frontend/src/types/index.ts`

- Item Types: `Add | Fix | Proof`
- Prereqs: Phase 1, Phase 2

- [x] **Fix**：将 `Downloading.vue` 的初始化逻辑从“读取本地 taskIds + 逐条详情轮询”改为“请求服务端当前页任务列表 + 基于结果建立轮询”。
- [x] **Add**：增加分页控件与状态过滤控件，用过滤操作替代“清空已完成”按钮。
- [x] **Fix**：按钮文案依据资源级 AI 总结主记录切换：无记录时显示“立刻 AI 总结”；已有记录但当前不在进行中时显示“重新 AI 总结”；进行中时展示不可重复提交状态。
- [x] **Fix**：用户从下载任务列表点击按钮后，前端走 `POST /api/tasks/:id/summary`，并刷新当前页数据或局部任务状态。
- [x] **Fix**：轮询仅覆盖当前页非终态任务；翻页、过滤切换和组件卸载时必须释放旧轮询。
- [ ] **Decision**：`queueStore` 若保留，仅用于“最近创建任务提示”或其他 UI 辅助，不再驱动下载页数据。替代方案：立即删除该 store（可行，但需检查其他页面依赖；是否删除放到实现期决定）。
- [ ] **Proof**：手动观察分页切换、过滤切换、当前页轮询释放、按钮文案与 AI 总结触发后的状态恢复。

Exit Criteria:

- [x] 下载任务列表页已改为服务端分页列表。
- [x] “清空已完成”已移除，并由过滤操作替代。
- [x] 轮询仅覆盖当前页非终态任务，且翻页/过滤切换后不会继续轮询旧结果。
- [x] 下载任务列表页能正确区分“立刻 AI 总结”与“重新 AI 总结”。
- [ ] 进行中的同一资源不能重复触发 AI 总结。
- [ ] 下载任务列表页与 AI 总结任务列表页的数据真相边界清晰：前者是服务端分页下载任务列表，后者是服务端 AI 总结任务列表。

### Phase 4 - AI 总结任务列表页与导航收尾

Status: partial-complete-needs-alignment
Targets: `packages/frontend/src/views/AiSummaryTasks.vue`, `packages/frontend/src/router/index.ts`, `packages/frontend/src/App.vue`, `packages/frontend/src/api/index.ts`, `packages/frontend/src/types/index.ts`

- Item Types: `Fix | Proof`
- Prereqs: Phase 2

- [x] **Add**：新增 AI 总结任务列表页与路由，并在主导航中提供入口。
- [x] **Add**：AI 总结任务列表页展示至少“待总结 / 总结中 / 总结失败 / 总结完成”四类状态，以及必要的视频标题、资源标识和结果摘要。
- [x] **Fix**：AI 总结任务列表页仅在首次进入时请求一次数据；后续只有用户点击“刷新任务状态”按钮时才重新请求，不能存在自动轮询副作用。
- [ ] **Proof**：与新的下载任务页方案一起验证导航、状态映射和数据字段一致性。

Exit Criteria:

- [ ] AI 总结任务列表页存在、可访问，并只支持手动刷新。
- [ ] 与下载任务页共享的 AI 总结状态字段和文案规则保持一致。

### Phase 5 - Owner-Doc Alignment And Verification

Status: pending
Targets: `docs/design/app-overview.md`, `docs/testing/2026/08-03-download-task-list-ai-summary-testing.md`, `docs/logs/2026/08-04.md`, `docs/context/project-context.md`, `docs/backlog/README.md`, `docs/plans/2026-08-03-download-task-list-ai-summary-plan.md`

- Item Types: `Fix | Proof`
- Prereqs: Phase 1, Phase 2, Phase 3, Phase 4

- [ ] **Fix**：更新 `docs/design/app-overview.md`，明确下载任务页已改为服务端分页与过滤列表，且支持对已完成任务直接发起 AI 总结；AI 总结任务页仍为手动刷新页。
- [ ] **Fix**：在测试文档中回填每个 requirement-level direction 的结果，包含 should / should-not 证据或明确 adjudication。
- [ ] **Proof**：运行 `pnpm typecheck` 与 `pnpm build`。
- [ ] **Proof**：执行最小 API / UI 级验证，至少覆盖：分页、过滤、当前页轮询释放、已完成任务触发、同资源重跑覆盖、AI 总结任务列表手动刷新、四类状态映射。
- [ ] **Fix**：将 `project-context`、`backlog`、`logs` 与计划状态保持一致，确保 closure 时文本一致性可验证。

Exit Criteria:

- [ ] owner doc 已更新为当前支持基线。
- [ ] `docs/testing/` 对应方向已回填验证结果。
- [ ] `pnpm typecheck` 与 `pnpm build` 已运行并记录结果。
- [ ] `docs/logs/` 已更新。

## Plan Audit

- Status: pending re-audit
- Reviewer / Agent: pending
- Evidence: 2026-08-04 用户已选择方案 B，将下载任务页从“本地队列视图补入口”改为“服务端分页列表 + 过滤 + 当前页轮询 + AI 总结入口”；原 2026-08-03 审计针对旧方案，不再覆盖本计划。当前已新增并更新失败的方案 B re-audit 记录 `docs/audits/2026-08-04-plan-reaudit-download-task-list-scheme-b.md`。最新独立 subagent 复审仍判定 `FAIL`：durable gate 尚未解除，且 live code 仍未落下服务端分页任务列表与资源级 `ai_summary_task` 触发接线两条核心真相链路。在人工批准并消除其中 blocker 前，不得进入实现。

## Closure Gates

- [ ] in-scope behavior is complete
- [ ] relevant docs are aligned
- [ ] verification has run (`pnpm typecheck`, `pnpm build`, plus focused manual/API observation for pagination, filtering, current-page polling, AI summary trigger, and summary task list)
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred/follow-up
- [ ] updated plan audit passed before implementation
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

### 更丰富的下载任务过滤项

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 本切片强制项仅要求分页和至少按下载状态过滤；关键词、时间区间、AI 总结状态等更细过滤可以在首版稳定后再补。
- Successor Required: `no`

## Closure

Status Note: pending

Closure Audit Evidence:

- Reviewer / Agent: pending
- Evidence: pending

Follow-up:

- 无
