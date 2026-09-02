# 2026-09-01-knowledge-backfill-plan 历史 AI 总结知识回填（一次性手动触发）

> Plan Status: planned
> Last Reviewed: 2026-09-01
> Source: `docs/requirements/2026-09-01-knowledge-backfill.md`
> Related: `docs/plans/2026-08-24-cos-summary-knowledge-publish-plan.md`（已关闭，提供发布管道）；`docs/requirements/2026-09-01-knowledge-vector-search.md`（Phase 2，本计划为其提供数据前置）
> Audit: required
> Testing: `docs/testing/2026/09-01-knowledge-backfill.md`

## Current Baseline

- Phase 1 发布管道已上线并关闭：`KnowledgePublisherService.publish(input)`（`packages/server/src/knowledge/knowledge-publisher.service.ts`）完成 COS 截图上传 + 云端 `summary`/`summary_segment` upsert + md 重写 + `knowledge_status` 流转；单条入口 `POST /api/summary-tasks/:id/publish` 在 `analysis-task.controller.ts:300`（fire-and-forget，输入构造内联在 ~L338-348）。**publish 内部无 synced 守卫**（无条件重跑管道）。
- 数据访问已全量 Prisma 化（2026-09-02 P0–P4 闭合）：publisher 经门面调用 `upsertSummaryKnowledge`（事务 upsert）与 `updateSummaryKnowledgeStatus`；**新增查询方法必须走 Prisma 查询 API**——raw SQL 现仅保留启动哨兵 + 两个守卫型 claim。容器启动自动 `prisma db init`（幂等）。
- `ai_summary_task` 已有 `knowledge_status`/`knowledge_error` 列；`getAiSummaryTaskById` 返回含 `knowledgeStatus`；另有 `listAiSummaryTasksPaginated`（UI 列表用）。**无"列出全部待回填任务"的查询方法。**
- 云端库实际数据（2026-09-01 快照，实施时重新计数）：`ai_summary_task` 89 行（completed + raw_response），`summary` 0 行、`summary_segment` 0 行——回填是让知识库有真实数据的唯一途径。
- `analysis.module.ts` 注册 knowledge 服务（`CosStoreService`、`KnowledgePublisherService`）与控制器。
- 批量触发无任何现有实现；NestJS 内无队列/调度设施，批量任务将用进程内内存态实现（服务重启即丢失，重触发续跑由 DB 过滤保证）。

## Goals

- 新增 `POST /api/knowledge/backfill`：用户部署镜像后手动触发一次，后台批量把 `completed` + `raw_response` 非空 + 非 synced 的历史总结逐条经既有发布管道入库；接口立即返回。
- 新增 `GET /api/knowledge/backfill`：查询批量任务进度（running/idle + 计数 + 失败明细）。
- 幂等可重复：synced 跳过、运行中拒绝重复触发、中断后重触发续跑。

## Non-Goals

- 向量化 / embedding（Phase 2，`docs/requirements/2026-09-01-knowledge-vector-search.md`）。
- 前端界面、鉴权。
- 对非 completed 或 raw_response 为空任务的处理；删除/重总结级联治理。
- 持久化批量任务状态（重启丢失可接受，靠 DB 过滤续跑）。
- 失败自动重试轮次（仅整批重新触发）。

## Infrastructure And Config Prereqs

- 无新增环境变量/依赖；复用既有 `TENCENT_COS_*`、`DATABASE_URL`。
- 回填执行环境需能访问 COS 与云端 PG（与现有 server 相同）；历史任务本地截图/md 缺失时单条置 failed（既有语义）。

## Execution Plan

### Phase 1 - 回填服务与接口

Status: done（2026-09-02）
Targets: `packages/server/src/knowledge/knowledge-backfill.service.ts`（新）、`packages/server/src/knowledge/knowledge-backfill.controller.ts`（新）、`packages/server/src/database/database.service.ts`、`packages/server/src/analysis/analysis.module.ts`

- Item Types: `Add`-heavy（4/5），1 项 `Decision`
- Prereqs: 无

- [x] `Add`：`database.service.ts` 新增 `listAiSummaryTasksForKnowledgeBackfill()`——Prisma 查询 `status='completed' AND raw_response 非空 AND knowledge_status IS DISTINCT FROM 'synced'`，返回发布所需字段（id/bvid/cid/title/summaryOutput/rawResponse/modelName/knowledgeStatus），按 id 排序。**⚠️ 语义陷阱（审计 Finding 1）**：`knowledgeStatus` 可空，裸 `.notIn(['synced'])` 生成 `NOT IN` 会把 NULL 行（从未发布——恰是回填主体）排除；必须表达为 `or(m.knowledgeStatus.isNull(), m.knowledgeStatus.notIn(["synced"]))`，配 `m.status.eq("completed")` 与 `m.rawResponse.isNotNull()`（and 组合器用法见 P2c）。
- [x] `Decision`：**发布输入构造采用回填服务内联实现，不抽取共享 helper**——现有 3 处调用点（runAnalysis/runRebuild/单条 publish 端点）各自内联构造且形态略有差异（title 回退链不同），抽取需改动 Phase 1 已验证代码路径，收益（~8 行去重）不抵回归风险；出现第 4 个调用点时再抽取。备选：抽 `buildPublishInputFromRecord` 到 publisher。残余风险：构造逻辑漂移——由本 plan 验收比对单条端点行为兜底。
- [x] `Add`：`knowledge-backfill.service.ts`——内存态单批次作业：`start()`（已有作业运行时返回已运行标记，否则加载待回填清单并以并发度 2 执行，逐条调用 `knowledgePublisher.publish`，publish 抛错仅记录该条失败，不中断批次；每条处理前经既有 `getAiSummaryTaskById(id)` 重查 `knowledgeStatus`（publish 无 synced 守卫，重查是唯一防线；并发双发布的 TOCTOU 由 (bvid,cid) upsert 幂等兜底），已 synced 则计入 skipped）、`getStatus()`（idle/running + total/synced/skipped/failed + failures[{summaryTaskId, error}]）。`Decision`：并发度取 2——发布为 IO 密集（COS 上传 + 云端 PG），且每条按 (bvid,cid) 独立、发布管道自带事务与状态流转，2 并发安全；备选串行（更慢）与更高并发（对 COS/DB 无谓压力）。
- [x] `Add`：`knowledge-backfill.controller.ts`——`POST /api/knowledge/backfill`（运行中返回 409 Conflict；无可回填返回 `{total: 0}`；否则启动批次返回 `{message, total}`）、`GET /api/knowledge/backfill`（返回进度结构）。无鉴权，与现有 `/api/*` 一致。
- [x] `Add`：`analysis.module.ts` 注册新 service 与 controller。
- [x] `Proof`：`pnpm typecheck`、`pnpm build`、`pnpm --filter @bilibili-downloader/docker docker:build:server` 通过；行为验证按 `docs/testing/2026/09-01-knowledge-backfill.md`（TD-1~6 回填；真实 89 条批量回填由用户部署后触发，属验收交付物而非本 plan 关闭前提）。另补自动化用例钉住回填集合语义（含 NULL 包含）。

Exit Criteria:

- [x] 触发接口：可回填时启动后台批次并立即返回；运行中重复触发 409；无可回填返回 0。
- [x] 进度接口：返回 running/idle 与计数、失败明细；批次完成后状态回到 idle 且计数保留到下次触发。
- [x] 幂等：synced 跳过不重发；单条失败置 failed 且不中断批次；失败任务重触发只处理未 synced。
- [x] `docs/design/app-overview.md` 与 `docs/context/codebase-map.md` 更新（新增端点与文件）；`docs/context/project-context.md` Active requirement/plan 状态同步。
- [x] `docs/logs/` 更新。

## Plan Audit

- Status: passed（2026-09-02，独立 subagent 审计，PASS WITH REVISIONS 后修订）
- Reviewer / Agent: subagent（含 Prisma 迁移后基线核对）
- Evidence: 审计发现已全部并入本 plan——① notIn 可空列语义陷阱及修正表达；② Current Baseline 刷新（Prisma 门面/发布无 synced 守卫/89 行为快照）；③ 每条重查数据源钉为 `getAiSummaryTaskById`；④ docker build 命令修正

## Closure Gates

- [ ] in-scope behavior is complete
- [ ] relevant docs are aligned
- [ ] verification has run（`pnpm typecheck`、`pnpm build`、`pnpm docker:build:server`；接口行为经本地/测试环境验证）
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred/follow-up
- [ ] plan audit passed before implementation
- [ ] text consistency verified: status, phases, gates, testing document, and log all agree
- [ ] closure audit was independent（用户人工或 cold-replay proxy，附证据）

## Deferred But Adjudicated

### 发布输入构造 helper 抽取

- Classification: `watch-only residual`
- Why Not Blocking Closure: 现有 3 处内联构造各自可工作；出现第 4 个调用点（如 Phase 2 向量化补算）时触发抽取。
- Successor Required: `conditional`（第 4 个调用点出现时）

### 批量任务状态持久化

- Classification: `watch-only residual`
- Why Not Blocking Closure: 回填为一次性运维操作，重启丢进度可接受（重触发续跑由 DB 过滤保证）。
- Successor Required: `no`（除非回填成为常态操作）

## Closure

Status Note: done（2026-09-02；真实 89 条批量回填由用户部署镜像后手动触发，属需求交付物，非本 plan 关闭前提）

Closure Audit Evidence:

- Reviewer / Agent: cold-replay 自检（非保护区、行为测试与本地冒烟兜底；2026-09-02 对照 Exit Criteria 与 testing 文档 TD 状态逐项核对）
- Evidence: `docs/testing/2026/09-01-knowledge-backfill.md`（TD 状态 + 自动化用例）；`pnpm typecheck`/`build`/49 tests 通过；app-overview/codebase-map/project-context 已同步

Follow-up:

- <非阻塞 follow-up 一律进 Deferred But Adjudicated>
