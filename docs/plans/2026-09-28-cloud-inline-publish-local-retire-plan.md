# 2026-09-28 云端/NAS Phase 1b — 内联发布 + 本地 md/截图下线

> Plan Status: done
> Last Reviewed: 2026-09-29
> Source: `docs/requirements/2026-09-17-cloud-inline-publish-local-retire.md`
> Related: 前置 Phase 1a `docs/plans/2026-09-23-cloud-read-path-db-render-plan.md`（已闭合）；上游 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（Phase 1b）；下游 Phase 2/4 与「重试截图」需求
> Audit: required（非保护区：不改部署/auth；**不删除既有本地文件**——删除属 Phase 4 数据删除保护区；reviewer availability=none → 允许 cold-replay 或独立子代理代替）
> Testing: `docs/testing/2026/09-28-cloud-inline-publish-local-retire-testing.md`

## Current Baseline

- 分析完成流程 `packages/server/src/analysis/analysis-trigger.service.ts`：LLM 成功后置 `status=completed` 并写 `summaryOutput=result.summaryPath`（约 :481-490），随后 **fire-and-forget** 调 `knowledgePublisher.publish(...).catch(...)`（约 :497-517）——即"先 completed 再异步发布"，发布失败不影响 completed。
- **H4 缺陷**：失败路径把错误串写进 `rawResponse`——低清子任务失败 `rawResponse: result.error`（约 :150-156）、LLM 成功后步骤失败 `rawResponse: msg`（约 :529-536）。污染后 raw 回退渲染不可用。
- 发布器 `packages/server/src/knowledge/knowledge-publisher.service.ts`（:68-211）：**从本地 md 反解图片**（`readFile(summaryPath)` → 正则抽 imageUrls → 存在的本地相对图上传 COS，key=`summary/<bvid>-<cid>/screenshots/<basename>`），再按 `segment-<index>` 文件名前缀匹配回填 `screenshotUrl`；写 `knowledge_status`（pending/synced/failed，约 :71/112/121/189/201）。
- 分析引擎 `packages/server/src/analysis/analysis-engine.ts`：写本地 md（`writeFile(summaryPath, doc)` 约 :447/:509）、本地截图存 `summaryDir/screenshots/`；输出 `AnalysisOutput.screenshotFiles: string[]`（**扁平**，非 per-segment，约 :62-77）——审计 B3 需改为结构化 `segments[].screenshotFiles`。
- 静态挂载 `packages/server/src/main.ts`（约 :24-27）：`app.useStaticAssets(paths.SUMMARY_BASE_DIR, { prefix: SUMMARY_STATIC_PREFIX + "/" })`；常量 `SUMMARY_STATIC_PREFIX = "/summary-files"`。
- 待下线端点：`POST /api/summary-tasks/:id/publish`（`analysis-task.controller.ts` 约 :421-482）；`POST/GET /api/knowledge/backfill`（`knowledge-backfill.controller.ts`）；`POST /api/summary-tasks/repair`（`analysis-task.controller.ts` 约 :119-143 → `summary-repair.service.ts`）。前端引用：`packages/frontend/src/api/index.ts` 的 `publishAiSummaryTask`（约 :271）、`repairSummaryTasks`（约 :306）；`AiSummaryTasks.tsx` 的 `knowledge_status`：helper :57-74 + 用法 :403-405（Tag）/:414（错误显示）/:521-530（publish 按钮门控）。
- helper（`summary-dir.ts`）分类（**独立审计已核对**）：`rewriteMarkdownImageUrls`（:142-171，**已无调用方=死代码**，Phase 1a 后其读路径消费方已改 DB）、`rewriteMarkdownImages`（:179-201，被 publisher :22/:184 用）、`SUMMARY_STATIC_PREFIX`（:14，main.ts + rewrite 用）——三者可随本切片删除；**必须保留**：`listLocalImageRefs`（:208-221）与 `resolveSummaryOutputPath`（:32-37）仍被 **out-of-scope 的** `summary-integrity.service.ts`（:117/:105）引用，本切片不删。
- Phase 1a 已让两 markdown 端点从 DB 渲染、读侧不触盘；本地 md/截图当前仍被写入，但已无读取消费方（除 rebuild/repair 本地路径）。
- 缺口：完成门槛仍是"先 completed 再异步发布"，内容未必入库即 completed；发布依赖本地 md 反解，与"停止写本地"冲突；publish/backfill/repair 端点与本地文件强绑定。

## Goals

- **内联发布**：分析成功后在流程内把 `summary` + `summary_segment`（含 `screenshot_url`）写云 DB、截图直传 COS；**内容入库成功才置 `completed`**（截图缺失不阻塞）。
- **段↔截图结构化映射（B3）**：`AnalysisEngine` 对外暴露 `segments[].screenshotFiles`，发布按结构上传 COS、不再从本地 md 反解。
- **H4 修复**：`raw_response` 只放模型 JSON；失败只写 `error_message`，LLM 成功后的步骤失败不得覆盖 `raw_response`。
- **停止写本地 md/截图**：分析不再产出对外 md 与本地截图副本；`summary_output` 不再写入（列保留待 Phase 4）。
- **移除 `/summary-files` 静态挂载**与随之变为死代码的 helper（按裁剪范围）。
- **下线** `publish` / `backfill` / `repair` 端点与相关子系统；`knowledge_status`/`knowledge_error` 影子状态按裁剪决策处理。

## Non-Goals

- **删除既有本地 md/截图文件**（Phase 4 数据删除保护区）。
- 作业化 `worker_job`、项目拆分、用户系统、NAS/云互联（Phase 2/3）。
- 完整性检查判据/报告结构变更（独立需求）。
- `rebuild` → `screenshot_retry` 语义收窄（独立需求，依赖 Phase 2）；本切片**不改 rebuild 语义**（仅在 Phase 1 连带适配发布器契约，见 Phase 1 rebuild 连带项），仅保证 `screenshot_url` 已随内联发布入库。
- 删除 `summary_output`/`knowledge_status`/`knowledge_error` 列（Phase 4）。

## Infrastructure And Config Prereqs

- 无新增基础设施/env/端口/部署形态变更。
- COS 配置沿用既有（`TENCENT_COS_*`、公网前缀）；未配置时截图上传失败按"不阻塞完成"处理。
- 测试依赖：`TEST_DATABASE_URL`（pgvector/pg17 容器，见 `docs/context/project-context.md`）。
- 保护区：无（不删既有本地文件、不改部署/auth）。reviewer=none → plan/closure 可用 cold-replay 或独立子代理留证。

## Execution Plan

### Phase 1 - 内联发布 + H4 修复 + 段↔截图结构化

Status: done
Targets: `packages/server/src/analysis/analysis-engine.ts`、`packages/server/src/analysis/analysis-trigger.service.ts`、`packages/server/src/knowledge/knowledge-publisher.service.ts`

- Item Types: `Fix | Add | Decision`
- Prereqs: Phase 1a（已闭合）

- [x] `Add`（B3）：`AnalysisEngine` 输出增加 `segments[].screenshotFiles: string[]`（每段对应截图本地路径列表），与既有扁平 `screenshotFiles` 并存或替代；发布方按段消费。**接口契约**：`AnalysisOutput.segments: Array<{ title; content; timestamp; frameDescription; screenshotFiles: string[] }>`；发布器输入契约随之去除 `KnowledgePublishInput.summaryPath`（`knowledge-publisher.service.ts:37`）、改传结构化 `segments[].screenshotFiles`。
- [x] `Fix`：发布器改为**按结构映射**上传 COS 并回写 `summary_segment.screenshot_url`，删除"读本地 md + 正则反解 imageUrls"路径（`knowledge-publisher.service.ts` :123-162）。COS key 方案不变（`summary/<bvid>-<cid>/screenshots/...`）。
- [x] `Fix`：完成门槛改为**内容入库成功才 `completed`**——完成事务写入 `summary`+`summary_segment`（`screenshot_url` **允许为空**）成功即置 `completed`；**COS 截图上传+回写 `screenshot_url`、embedding 生成均为入库后独立 best-effort**（各自单独 UPDATE，失败仅留空对应字段，**绝不回退 `failed`**）。移除发布器 COS 未配置的**提前 return**（`knowledge-publisher.service.ts` :70-78）使其不再跳过内容入库；解除“发布抛错即 `knowledge_status=failed` 并 rethrow”（:199-210）对 `completed` 的影响。崩溃安全：内容事务与置 `completed` 为两次写，其间崩溃由 `reconcileStaleAnalysisState`（:76）标 failed、重跑经 `(summary_id,seq)` upsert 自愈。（`analysis-trigger.service.ts` :481-517）
- [x] `Fix`（H4）：失败路径不再写 `rawResponse`——LLM 成功后步骤失败 `status=failed`、保留模型 JSON 于 `rawResponse`、错误入 `error_message`（:529-536）；LLM 本身失败 `rawResponse=NULL`、`error_message`=错误（:150-156）。
- [x] `Fix`（rebuild 连带，**独立审计 blocker**）：发布器改结构化后，第二个 `publish` 调用方——rebuild 路径（`analysis-trigger.service.ts` 约 :845-873，调用点 :853）——须一并改为传 `buildOutput` 产出的结构化 `segments[].screenshotFiles`，避免其因失去 md 反解而写空 `screenshot_url` 或类型不符。**仅为发布器契约变更的必要连带，非 rebuild 语义收窄**（收窄仍属独立需求）。
- [x] `Decision`：`knowledge_status`/`knowledge_error` 裁剪——内联后发布即完成的一部分，**停止写影子发布态**（不再 pending/synced 流转）；列暂保留（Phase 4 决定去留，与 umbrella 跨阶段未决项一致）。备选：保留写入用于重试态——因内联发布无独立重试子系统，暂不保留；残留风险：前端 `knowledge_status` 标签将恒为空/历史值，Phase 3 一并处理 UI。
- [x] `Proof`：`pnpm typecheck`、`pnpm build`。

Exit Criteria:

- [x] 分析成功后 `summary`+`summary_segment`（含 `screenshot_url`）已入云 DB，且**内容入库成功才** `completed`；截图上传失败仍 `completed` 且 `screenshot_url` 为空。
- [x] 发布不再读本地 md；段↔截图按结构映射。
- [x] 失败路径不污染 `rawResponse`；模型 JSON 在后续步骤失败时保留。
- [x] `docs/logs/` 记录本相位进展。

### Phase 2 - 停止写本地 md/截图 + 移除 /summary-files 挂载 + helper 裁剪

Status: done
Targets: `packages/server/src/analysis/analysis-engine.ts`、`packages/server/src/main.ts`、`packages/server/src/analysis/summary-dir.ts`

- Item Types: `Fix`
- Prereqs: Phase 1

- [x] `Fix`：分析引擎不再 `writeFile` 本地 md、不再写本地截图副本作为对外产物（:447/:509 相关）；截图仅用于上传 COS 后即可清理临时件（不留对外副本）；`summaryOutput` 不再写入（列保留）。
- [x] `Fix`：移除 `main.ts` 的 `/summary-files` 静态挂载（:24-27，含 `mkdirSync` 与 :37-43 启动日志块）与 `SUMMARY_STATIC_PREFIX` 引用。
- [x] `Fix`：删除确认无调用方的死代码 helper：`rewriteMarkdownImageUrls`（已无调用方）、`rewriteMarkdownImages`（publisher 改结构化后不再用）、`SUMMARY_STATIC_PREFIX`（挂载移除后）。**保留** `listLocalImageRefs` 与 `resolveSummaryOutputPath`——二者仍被 out-of-scope 的 `summary-integrity.service.ts`（:117/:105）引用。
- [x] `Proof`：`pnpm typecheck`、`pnpm build`；全局 grep 确认无残留 `/summary-files`、无悬空 import。

Exit Criteria:

- [x] 分析不再产出对外 md 与本地截图副本；既有历史文件**未删除**（Phase 4）。
- [x] `/summary-files` 挂载移除；服务端无该前缀产出；无悬空 helper import。
- [x] `docs/logs/` 记录本相位进展。

### Phase 3 - 下线 publish/backfill/repair 端点 + 前端引用 + knowledge_status UI

Status: done
Targets: `analysis-task.controller.ts`、`knowledge-backfill.controller.ts`、`summary-repair.service.ts`、对应 module、`packages/frontend/src/api/index.ts`、`packages/frontend/src/pages/AiSummaryTasks.tsx`

- Item Types: `Fix`
- Prereqs: Phase 1（内联发布取代 publish）

- [x] `Fix`：移除 `POST /api/summary-tasks/:id/publish`（:421-482）及其 DI；移除 `POST/GET /api/knowledge/backfill` 控制器与 provider。
- [x] `Fix`：移除 `POST /api/summary-tasks/repair`（:119-143）与 `SummaryRepairService`（含 module provider 与构造器注入）。**不删 `listLocalImageRefs`**——其仍被 out-of-scope 的 `summary-integrity.service.ts:117` 使用（与基线/Phase 2 保留决策一致）。
- [x] `Fix`：前端移除 `publishAiSummaryTask`（api :271）、`repairSummaryTasks`（api :306）调用与入口按钮；`AiSummaryTasks.tsx` 移除 `knowledge_status` 相关 UI（helper :57-74、Tag :403-405、错误显示 :414、publish 按钮 :521-530）。
- [x] `Proof`：`pnpm typecheck`、`pnpm build`（前后端）；grep 确认无残留端点/前端引用。

Exit Criteria:

- [x] 三端点均下线，无后端路由与前端引用残留；DI/module 干净。
- [x] `docs/logs/` 记录本相位进展。

### Phase 4 - 测试与验证

Status: done
Targets: `packages/server/tests/**`（数据层 + 纯函数/服务单测）

- Item Types: `Add | Proof`
- Prereqs: Phase 1-3

- [x] `Add`：数据层/服务测试——内联发布后 `summary`+`summary_segment` 入库且 `completed`；截图上传失败仍 `completed`、`screenshot_url` 为空；重跑按 `(summary_id, seq)` upsert 并清尾行（复用既有 knowledge 测试模式）。
- [x] `Add`：H4 回归——LLM 成功后步骤失败 `rawResponse` 保留模型 JSON、`error_message` 记错误；LLM 失败 `rawResponse=NULL`。
- [x] `Add`：段↔截图结构化映射纯函数/服务测试（无需读本地 md）。
- [x] `Proof`：`pnpm --filter @bilibili-downloader/server test`（测试容器）+ `pnpm typecheck` + `pnpm build` 全绿。

Exit Criteria:

- [x] 需求 Acceptance Criteria 逐条被测试或人工核对覆盖；testing 文档每条方向确认或裁决。
- [x] 全部验证命令通过。
- [x] `docs/logs/` 记录本相位进展。

### Phase 5 - 文档与闭合

Status: done
Targets: `docs/design/app-overview.md`、`docs/design/feature-inventory.md`、`docs/context/codebase-map.md`、`docs/backlog/README.md`、`docs/logs/`

- Item Types: `Fix | Proof`
- Prereqs: Phase 1-4

- [x] `Fix`：owner docs 对齐——`completed`=内容入库、内联发布、`/summary-files` 移除、publish/backfill/repair 下线、`knowledge_status` UI 移除、rebuild 现状说明（见 Deferred）。
- [x] `Fix`：`backlog/README.md` 将 Phase 1b 标 done、解除后继（Phase 2/「重试截图」）对 1b 的依赖阻塞；`project-context.md` 同步（active requirement 是否切换按当时裁决）。
- [x] `Proof`：独立 closure audit（reviewer=none → 独立子代理或 cold-replay，留证于本计划 Closure 段或 `docs/audits/`）。

Exit Criteria:

- [x] owner docs / codebase-map / backlog / log 一致；testing 每条方向确认或裁决 out of scope。
- [x] closure gates 全绿。

## Plan Audit

- Status: passed（with required fixes applied）
- Reviewer / Agent: 独立子代理（General，fresh-eyes，无撰写记忆；非保护区允许代替人工）
- Evidence: 2026-09-28 独立 plan audit，Verdict=PASS-WITH-REQUIRED-FIXES。两 blocker（① `listLocalImageRefs`/`resolveSummaryOutputPath` 仍被 out-of-scope 的 `summary-integrity.service.ts` 引用→改为保留；② rebuild 路径 `analysis-trigger.service.ts:853` 亦调 `publish`，发布器契约变更须连带更新→已移入 Phase 1 in-scope）与 should-fix（完成时序=先入库事务→completed、COS/embedding best-effort 不回退 failed、移除 COS 未配置提前 return；`rewriteMarkdownImageUrls` 实为死代码；前端 knowledge_status 用法行号）均已就地并入本计划。基线关键 file:line 经独立核对无误。第二轮独立复核（2026-09-28）Verdict=PASS-WITH-REQUIRED-FIXES：修正 Phase 3 遗留的 `listLocalImageRefs` 误删（与保留决策矛盾）、截图/embedding 为入库后独立 best-effort 的时序澄清、Non-Goals rebuild 措辞、前端 `packages/` 路径、发布器输入契约与崩溃窗口说明——均已并入。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned（app-overview / feature-inventory / codebase-map / backlog / log）
- [x] verification has run（`pnpm --filter @bilibili-downloader/server test`、`pnpm typecheck`、`pnpm build`）
- [x] corresponding `docs/testing/` document exists 且每条方向确认通过或裁决 out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed（独立子代理留证）before implementation
- [x] micro-plan exception not applicable（跨 API 下线 + 完成语义变更 + 多模块）
- [x] text consistency verified：top status / phase status / exit criteria / closure gates / testing doc / log 一致
- [x] closure audit was independent（或 cold-replay 代理留证）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### rebuild 端点在本切片内继续（无用地）产出本地文件

- Classification: `watch-only residual`
- Why Not Blocking Closure: `rebuild` 语义收窄为「重试截图」属独立需求（依赖 Phase 2），本切片不改其语义；仅在 Phase 1 连带更新其对发布器的调用以适配结构化契约（见 Phase 1 rebuild 连带项）。Phase 1a 起读取已走 DB，rebuild 产出的本地 md/截图无读取消费方，为无害残留。
- Successor Required: `yes`（`docs/requirements/2026-09-17-screenshot-retry.md`）

### knowledge_status/knowledge_error 列去留

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 列删除属 Phase 4 数据保护区；本切片仅停写影子态并移除其 UI，列保留。
- Successor Required: `yes`（Phase 4 `docs/requirements/2026-09-17-cloud-cleanup.md`）

### embedding 瞬时失败的补偿路径

- Classification: `watch-only residual`
- Why Not Blocking Closure: 内联后 embedding 为 best-effort；文本未变但 embedding 失败会留 NULL（pgvector 静默漏检），本切片下线 publish/backfill 后无独立重嵌入入口。umbrella 已登记 `knowledge_status` 重试态为跨阶段未决；重嵌入由 Phase 2 作业化承接。
- Successor Required: `yes`（Phase 2 `worker_job` 重嵌入 / 完整性检查）

## Closure

Status Note: 已闭合（2026-09-29）。实施顺序调整为 P1→P3→P2→P4→P5（P2 依赖 P3 先删旧 publish/helper）。内联发布、完成语义门槛、H4、B3、停写本地/移除挂载、端点与前端下线、rebuild 连带适配、测试与文档全部落地并验证。

Closure Audit Evidence:

- Reviewer / Agent: 独立子代理 closure audit（fresh-eyes，无实现记忆）；实现前另有独立子代理 plan audit（两轮）。
- Evidence: Verdict=PASS-WITH-FIXES；逐项 1–10 CONFIRMED。should-fix 已处理：删除 vite `/summary-files` 代理、清理临时文件、更正发布器注释、回填本计划闭合元数据。验证：`pnpm typecheck`/`build` 通过、`pnpm --filter server test` 18 文件/128 项通过。

Follow-up:

- Phase 2（作业化）后推进「重试截图」与「完整性检查重定义」（后者承接：本地 md 停写后旧本地完整性检查会误报缺失）。
- `database.service` 的 `updateSummaryKnowledgeStatus` / `listAiSummaryTasksForKnowledgeBackfill` 成无调用方死方法，随 `knowledge_status` 列一并留待 Phase 4 清理（列删除属数据保护区）。
