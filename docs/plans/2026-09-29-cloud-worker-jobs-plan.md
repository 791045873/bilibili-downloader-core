# 2026-09-29 云端/NAS Phase 2 — 持久化作业与跨主机触发（worker_job）

> Plan Status: done
> Last Reviewed: 2026-09-29
> Source: `docs/requirements/2026-09-17-cloud-worker-jobs.md`
> Related: 上游 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（Phase 2 / Q3、Q7、Q16）；前置 Phase 1a/1b（已闭合）；下游 Phase 3（拆项目）、「重试截图」「完整性检查重定义」（依赖本阶段作业化）
> Audit: required（涉数据模型新增，additive；非部署/auth/删除保护区；reviewer availability=none → 独立子代理或 cold-replay 代替）
> Testing: `docs/testing/2026/09-29-cloud-worker-jobs-testing.md`

## Current Baseline

- Prisma 契约工作流（`packages/server/src/prisma/contract.prisma`）：模型用 `BigInt @id @default(autoincrement())`、`Timestamptz`、`@map`、`@@map`、`@@unique(map:)`；改 schema 后 `pnpm --filter @bilibili-downloader/server prisma:emit` 生成 `contract.d.ts`/`contract.json`；ORM 经 `this.prismaDb.orm.public.<Model>`，事务 `this.prismaDb.transaction(async (tx) => …)`；bigint 用 `bigintToNumber`、时间用 `toInstant/toIsoString`。启动为哨兵检查 + 幂等播种（无 DDL），存量库经 `db migrate` 演进。
- 既有原子认领模板 `claimNextCreatedTask`（`database.service.ts:586-609`）：raw SQL 单语句 `UPDATE task SET status='downloading' WHERE id=(SELECT … WHERE status='created' ORDER BY "createdAt" LIMIT 1) RETURNING id`，`task`/`analysis_sub_task` 保持业务真源。测试 `tests/database/task.test.ts:113-132` 验 FIFO + 并发原子。
- 进程内调度与回调（`download/download-scheduler.ts`）：`onModuleInit` 注册 `downloadService.onTaskFinished`（删 runningSet → `tryScheduleNext` → `onAnalysisTrigger?.(taskId)`）与 `onLowResFinished`（写 `analysis_sub_task` 后 `runAnalysis`）；进程内队列 `runningSet` / `lowResRunningSet` / `lowResRunningResources` / `lowResQueue`（:30-42）。
- 进程内互斥：`analysis-trigger.service.ts` `rebuildingIds`(Set，:59) + `tryStartRebuild`（:776-782）；`summary-integrity.service.ts` `running`(bool) + `tryStart/isRunning`（:44-61）。均假设单进程。
- 触发入口：下载创建 `download.controller.ts:37-50`→`scheduler.createDownload`；一键总结 `analysis-task.controller.ts` `triggerTaskAiSummary`→`analysisTriggerService.trigger`；rebuild(→screenshot_retry) `runRebuild`；integrity-check `startIntegrityCheck`→`summaryIntegrityService.run`；retrigger `retriggerAiSummaryTask`。
- 执行期 B站解析：下载执行 `download.service.ts:528-534` 调 `resourceParser.parse` 取 `resourceType`；分析触发取创作者 mid/promptId（`analysis-trigger.service.ts` ~:334）。Q16 定：前移到云端/创建期，随 `worker_job.payload` 下发。
- 缺口：跨主机触发靠进程内回调/内存队列/内存互斥，无法拆到 NAS 执行、崩溃不可恢复。

## Goals

- 新增 `worker_job` + `worker_heartbeat`（Prisma 契约 additive；字段见 umbrella Q3），含**认领（SKIP LOCKED 守卫 UPDATE）/租约（`lease_expires_at`）/心跳（`heartbeat_at`）/reaper（超时重置 queued、attempts++）**。
- 触发即写作业行；进程内**轮询认领执行**（本阶段仍单进程，不改部署）；以 DB 作业状态替换 `onTaskFinished→onAnalysisTrigger`/`onLowResFinished` 回调、`lowResQueue` 内存队列、`rebuildingIds`/integrity `running` 内存互斥。
- kind：`low_res_download` / `analyze` / `retrigger` / `screenshot_retry` / `integrity_check` / `cos_cleanup`（后者仅定义枚举，生产者在 Phase 4）；`download` 暂沿用 `claimNextCreatedTask`。
- `promptId`/创作者 mid 由触发期解析写入 `analyze` 作业 `payload`（Q16）；`resource_type` 仅对**作业承载**的 `low_res_download` 经 payload 下发。**高清 `download` 仍走 `claimNextCreatedTask`，其执行期 `resource_type` 解析（`download.service.ts:528`）本阶段保留**，待未来 download 迁 `worker_job` 再消除。
- 新增作业状态查询/取消接口供前端轮询；`integrity-check/status` 改读 DB 作业而非进程内 `running`。

## Non-Goals

- 部署拆分、`server-common` 抽离、两镜像（Phase 3）。
- `download` 迁移到 `worker_job`（保留 `claimNextCreatedTask`）。
- 用户系统/auth（独立需求）。
- 完整性检查判据/报告结构、rebuild→screenshot_retry 语义收窄（各自独立需求；本阶段仅提供其作业化机制）。
- 删除既有列/本地文件（Phase 4）；MQ / LISTEN-NOTIFY（Q7：先 DB 轮询）。

## Infrastructure And Config Prereqs

- 无新增部署形态；新增配置：轮询间隔（3–5s 带退避/抖动）、租约 TTL（~60s）、心跳间隔（~20s，TTL≈3×）、worker 标识。默认值可内置，env 覆盖。
- 数据模型：`worker_job`/`worker_heartbeat` additive；迁移遵循讨论 `Migration & Rollback`（先 schema 后代码；回滚保留 additive 表）。
- 测试依赖：`TEST_DATABASE_URL`（pgvector/pg17 容器）。
- 保护区：无（additive、不改部署/auth/不删数据）。reviewer=none → plan/closure 独立子代理或 cold-replay 留证。终态作业保留期（如 30 天）具体值为 Open Question（不影响契约）。

## Execution Plan

### Phase 1 - 作业模型与仓储（schema + claim/lease/heartbeat/reaper）

Status: done
Targets: `packages/server/src/prisma/contract.prisma`（+ emit 产物）、`packages/server/src/database/database.service.ts`（或新增 `worker-job.repository.ts`）

- Item Types: `Add | Decision`
- Prereqs: 无

- [x] `Add`：contract.prisma 新增 `WorkerJob`（字段按 umbrella Q3：`id/kind/queue/refType/refId/dedupKey/status/priority/attempts/maxAttempts/availableAt/leaseOwner/leaseExpiresAt/heartbeatAt/payload(jsonb)/result(jsonb)/lastError/cancelRequested/createdAt/updatedAt/startedAt/finishedAt`）与 `WorkerHeartbeat`（`workerId/role/lastSeenAt/meta`）；索引 `(status, available_at, priority)`、`dedup_key` 部分唯一（`WHERE status IN ('queued','leased','running')`）、`(queue, status)`。`prisma:emit` 生成产物。
- [x] `Add`：作业仓储方法（raw SQL 守卫 UPDATE，比照 `claimNextCreatedTask`）：`enqueueJob`（`ON CONFLICT` 命中 `dedup_key` 部分唯一索引 `WHERE status IN('queued','leased','running')` 时 `DO NOTHING` 并返回既有作业）、`claimNextJob(queue)`（`UPDATE … WHERE id=(SELECT … WHERE status='queued' AND available_at<=now() ORDER BY priority,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`，写 `lease_owner`/`lease_expires_at=now()+TTL`/`status='leased'`）、`renewLease`/`completeJob`/`failJob` 均以 `WHERE lease_owner=$me AND status IN(...)` **围栏（fencing）**守卫（丢租约的完成为 no-op+日志）、`reapExpired`（`status IN(running,leased) AND lease_expires_at<now()` → `queued`, `attempts++`）、`requestCancel`、查询/列表。
- [x] `Decision`：`worker_job` 为通用执行队列，`task`/`analysis_sub_task` 仍为业务真源（双写由同事务缓解）；`download` 不迁移（沿用 `claimNextCreatedTask`）。理由/备选见 umbrella Q3。
- [x] `Proof`：`pnpm typecheck`、`pnpm build`；fresh 库经 `pnpm exec prisma db init`、存量库经迁移计划 + `db migrate` 成功（真实命令依 `docs/context/project-context.md` 数据库基线；启动仍为哨兵检查+幂等播种，无 DDL）。

Exit Criteria:

- [x] 两表经 contract/emit/migration 落地；fresh 与存量库均成功。
- [x] 认领/续租/reaper 为原子守卫 SQL；`dedup_key` 活跃唯一生效。
- [x] `docs/logs/` 记录。

### Phase 2 - 进程内 worker 循环 + 触发改写作业 + payload 前移

Status: done
Targets: `download/download-scheduler.ts`、`analysis/analysis-trigger.service.ts`、各触发 controller、`download/download.service.ts`

- Item Types: `Fix | Add`
- Prereqs: Phase 1

- [x] `Add`：进程内 worker 轮询器（独立定时器）：`claimNextJob('nas')` → 按 kind 分发 handler → 执行期独立定时器 `renewLease` → `completeJob/failJob`；reaper 定时扫描。handler 幂等（文件存在即跳过、COS 同 key 覆盖、DB upsert）；**handler 完成时在同一 `this.prismaDb.transaction` 内写领域结果 + 作业终态**（避免崩溃不一致/重复执行；Q3 双写缓解）。
- [x] `Fix`：触发入口改为 `enqueueJob`：一键总结/retrigger→`analyze`；rebuild→`screenshot_retry`；integrity-check→`integrity_check`；低清→`low_res_download`。`download` 创建保持现状（`claimNextCreatedTask`）。
- [x] `Fix`（analyze↔low_res 状态机）：移除 `onTaskFinished→onAnalysisTrigger`/`onLowResFinished`/`lowResQueue`/`lowResRunningSet`/`lowResRunningResources`。改为：`analyze` handler 若低清未就绪 → `enqueue low_res_download`（`dedup_key=lowres:{bvid}:{cid}`）并将本 `analyze` 以 `available_at` 退避重入（等待态）；`low_res_download` 完成后 `enqueue analyze`（`dedup_key=analyze:{bvid}:{cid}`）续跑。承接 `analysis-trigger.service.ts:273-289` 的等待语义；明确两 kind 的 `dedup_key` 与衔接。
- [x] `Fix`：`promptId`/创作者 mid 在触发期解析写入 `analyze` 作业 `payload`，免 `analysis-trigger` 执行期 mid 解析（`:334`）；`resource_type` 随 `low_res_download` 作业 `payload` 下发。**高清 `download` 保持 `claimNextCreatedTask`，其 `download.service.ts:528-534` 执行期解析本阶段不动**（待 download 迁 worker_job）。payload 缺失路径重解析后下发。
- [x] `Proof`：`pnpm typecheck`、`pnpm build`。

Exit Criteria:

- [x] 触发类动作均以写作业行完成；下载完成经作业驱动分析，不再依赖进程内回调/内存队列。
- [x] worker 崩溃后 `running` 作业经租约超时被 reaper 重置并重领；`queued` 不丢。
- [x] `promptId`/创作者 mid 经 `analyze` payload、`resource_type` 经 `low_res_download` payload 下发（对应执行期不再为此调 B站）；高清 download 执行期解析保留（已裁决 out of scope）。
- [x] `docs/logs/` 记录。

### Phase 3 - 以 DB 作业替换内存互斥 + 状态接口

Status: done
Targets: `analysis-trigger.service.ts`、`summary-integrity.service.ts`、`analysis-task.controller.ts`

- Item Types: `Fix | Add`
- Prereqs: Phase 1-2

- [x] `Fix`：移除 `rebuildingIds`（rebuild 并发由 `screenshot_retry` 的 `dedup_key` 活跃唯一保证）与 integrity `running` 布尔（由 `integrity_check` 作业去重保证）。
- [x] `Add`：作业状态查询/取消接口（列表/单条/取消）；`GET /summary-tasks/integrity-check/status` 改读 DB 作业状态而非进程内 `running`。
- [x] `Proof`：`pnpm typecheck`、`pnpm build`。

Exit Criteria:

- [x] 进程内互斥不再承担并发正确性；重复投递被 `dedup_key` 拒绝。
- [x] status 接口读 DB；前端轮询可见 queued/leased/running/succeeded/failed/canceled。
- [x] `docs/logs/` 记录。

### Phase 4 - 测试与验证

Status: done
Targets: `packages/server/tests/database/*`、服务级测试

- Item Types: `Add | Proof`
- Prereqs: Phase 1-3

- [x] `Add`：数据层测试——`enqueueJob` 去重（活跃唯一）、`claimNextJob` FIFO+并发原子（比照 task.test）、`renewLease`、`reapExpired` 超时重置+attempts++、终态写回。
- [x] `Add`：幂等与恢复——重复投递单次执行；崩溃（租约过期）后重领；取消在安全点终止为 canceled。
- [x] `Proof`：`pnpm --filter @bilibili-downloader/server test` + `typecheck` + `build` 全绿。

Exit Criteria:

- [x] 需求 AC 逐条被测试或人工核对覆盖；testing 每条方向确认或裁决。
- [x] `docs/logs/` 记录。

### Phase 5 - 文档与闭合

Status: done
Targets: `docs/architecture/system-baseline.md`、`docs/architecture/module-boundaries.md`、`docs/design/app-overview.md`、`docs/context/codebase-map.md`、`docs/backlog/README.md`、`docs/logs/`

- Item Types: `Fix | Proof`
- Prereqs: Phase 1-4

- [x] `Fix`：owner docs——system-baseline（作业队列 runtime 形态）、module-boundaries（移除进程内 scheduler/回调、新增作业仓储边界）、app-overview（触发=写作业、状态轮询、integrity status 读 DB）、codebase-map（worker_job 入口）、backlog（Phase 2 → done，解除下游依赖）。
- [x] `Proof`：独立 closure audit（reviewer=none → 独立子代理或 cold-replay，留证）。

Exit Criteria:

- [x] owner docs / codebase-map / backlog / log 一致；testing 每条方向确认或裁决。
- [x] closure gates 全绿。

## Plan Audit

- Status: passed（with required fixes applied）
- Reviewer / Agent: 独立子代理（General，fresh-eyes，无撰写记忆；非保护区允许代替人工）
- Evidence: 2026-09-29 独立 plan audit，Verdict=PASS-WITH-REQUIRED-FIXES。blocker（`resource_type` 前移与“download 保持 claimNextCreatedTask”矛盾——高清 download 无 payload 载体）已修：resource_type 前移限 `low_res_download`，高清 download 执行期解析保留。should-fix 全部并入：完成/续租 fencing（lease_owner 守卫）、analyze↔low_res 状态机与 dedup_key、`integrity_check` 执行判据 deferred（避免与 Phase 1b 停写 md 冲突误报）、handler 领域+终态同事务、baseline 行号更正（rebuildingIds:59/tryStartRebuild:776-782）、db 命令措辞更正、enqueue ON CONFLICT 策略。基线 file:line 经独立核对无误。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned（system-baseline / module-boundaries / app-overview / codebase-map / backlog / log）
- [x] verification has run（`pnpm --filter @bilibili-downloader/server test`、`pnpm typecheck`、`pnpm build`）
- [x] corresponding `docs/testing/` document exists 且每条方向确认通过或裁决 out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed（独立子代理或 cold-replay 留证）before implementation
- [x] micro-plan exception not applicable（新增数据模型 + 替换调度核心 + 多模块）
- [x] text consistency verified：top status / phase status / exit criteria / closure gates / testing doc / log 一致
- [x] closure audit was independent（或 cold-replay 代理留证）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 终态作业保留期与清理

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 保留期具体值与清理触发为实现细节/Phase 4 决策；本阶段仅定义终态与可清理性。
- Successor Required: `yes`（Phase 4 `cloud-cleanup`）

### integrity_check 作业的执行判据（handler）

- Classification: `watch-only residual`
- Why Not Blocking Closure: 旧 `SummaryIntegrityService.run()` 读本地 md（Phase 1b 已停写），直接作业化会误报全缺失。本阶段仅落地 `integrity_check` 的**投递/去重/状态查询**机制；其**执行判据**由「完整性检查重定义」需求（云 DB+COS+NAS 视频判据）承接，在此之前该 handler 保持 gated（不产出误导 verdict）。
- Successor Required: `yes`（`docs/requirements/2026-09-17-integrity-check-rescope.md`）

### download 迁移到 worker_job

- Classification: `watch-only residual`
- Why Not Blocking Closure: 需求明确 download 暂沿用 `claimNextCreatedTask`，稳定后再迁移。
- Successor Required: `no`（未来评估）

## Closure

Status: done（2026-09-30）

Status Note: Phase 1-5 全部落地并验证。提交序列 312f77d(P2-1) → a303c39(P2-2a) → 08001be(P2-2b-1) → 6ec9849(P2-2b-2) → f6152dd(P2-3) → d96d03c(P2-4) → 977f8b9(P2-5 docs/log) → 4e63c34(closure-audit 修复)。验证：`pnpm --filter @bilibili-downloader/server typecheck`/`build` 通过；`test` 全量 150 passed（测试容器 pgvector/pg17）。

Closure Audit Evidence:

- Reviewer / Agent: 独立子代理（General，fresh-eyes 冷回放，无实现记忆；reviewer=none 非保护区允许代替人工）
- Evidence: 2026-09-30 独立 closure audit，Verdict=PASS-WITH-FIXES，逐条核对 Exit Criteria/Closure Gates 并对照 live code（file:line）与本地 typecheck/build。发现并已修复 2 处：(1) GAP-1 `POST /api/analysis/trigger` 存量任务分支仍同步调用 trigger() 绕过 worker_job → 改为 enqueue analyze（4e63c34）；(2) GAP-2 `reapExpiredJobs` 未对 max_attempts 设限致毒作业无限重试 → 达上限置 failed + 补测（4e63c34）。其余项 CONFIRMED；`leased` 为未使用中间态（claim 直写 running，reaper 兼容 leased/running），不影响正确性。

Follow-up:

- Phase 2 落地后，「重试截图」「完整性检查重定义」可基于 `screenshot_retry`/`integrity_check` 作业实现；Phase 3 拆项目时 worker 循环迁至 `nas-worker`。
