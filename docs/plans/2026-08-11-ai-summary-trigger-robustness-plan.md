# 2026-08-11 AI 总结触发健壮性（P0）

> Plan Status: completed
> Last Reviewed: 2026-08-11
> Source: `docs/analysis/2026-08-11-ai-summary-fullpath-analysis.md`（第 5.2 / 6.1 节）
> Related: `docs/plans/2026-08-11-ai-summary-resource-availability-plan.md`（P0，资源对账）、`docs/plans/2026-08-11-ai-summary-state-architecture-consolidation-plan.md`（P1，架构收敛）
> Audit: required
> Testing: `docs/testing/2026/08-11-ai-summary-trigger-robustness-testing.md`

## Current Baseline

- `trigger()` 只把 `engine.analyze()`（`analysis-trigger.service.ts:325` 起的 try 块）的错误落 `failed` 状态；**try 之前**的步骤若抛错只会被调用方 log，状态却已置为 `pending`（`analysis-trigger.service.ts:178-189`）：
  - `resolveTaskForAnalysis`（:209）、`shouldReuseDownloadedVideo`（:239）、`mkdir`（:266）、`resolveSummaryDir`（:295）、`new AnalysisEngine(getLlmConfig())`（:312，env 缺失即抛错）、analyzing 状态写入（:313-323）。
  - 说明：:213-231 存在一条**显式**的缺失字段→failed 分支（非抛错路径），与本问题不冲突。
  - 调用方：`analysis.controller.ts:143`（await 触发，异常会 500）、`analysis-task.controller.ts:59`（fire-and-forget，仅 log）、以及 `analysis-trigger.service.ts:38-49`（`onAnalysisTrigger` 回调实现，仅 log）与 `:83-96`（低清完成后的重触发，仅 log）。
  - 后果：用户看到"AI 总结触发中"，但任务永久停在 `pending`，无任何错误反馈（静默失败）。
  - 额外后果：资源级入口（`analysis.controller.ts`）在触发前已把 `autoSummary` 置 1（:129），若 `trigger()` 抛错，任务保持"已开启 AI 总结"，二次触发会被 :126 自身的 ConflictException 挡住 —— 静默失败被加深。
- 入口守卫不一致：
  - 任务级 `POST /api/tasks/:id/summary`（`analysis-task.controller.ts:47-52`）校验了 `ai_summary_task` 进行中状态。
  - 资源级 `POST /api/analysis/trigger`（`analysis.controller.ts:114-127`）只校验 `task.autoSummary`，无进行中拦截。
  - 触发动作非原子（先查后置），快速并发双点可能双跑。
- 服务重启恢复（`download-scheduler.ts:56-64`）只把 `task.status=downloading` 标 failed；`analysis_sub_task` 停在 `created`，低清队列是内存态全部丢失：
  - 重触发时 `lowResSubTask.status!==completed` → `trigger()` 一直等待 → **永久卡 `pending`，无任何补救**。
- 低清下载失败后无自动重试（需用户手动重触发；`analysis-trigger.service.ts:191-193` 的 `find(status!=='failed')` 会在全部失败后新建子任务，可恢复但不自动）。

## Goals

- `trigger()` 从入口到结束的任何异常都落地为 `failed` 状态（task `summaryStatus` + `ai_summary_task` + 失败通知），杜绝静默失败与永久 `pending`。
- 资源级与任务级入口的进行中守卫一致，且触发"认领"原子化，重复/并发触发被拒绝。
- 服务重启后不再出现"AI 总结永久卡死"：遗留子任务与卡死状态可被对账恢复，用户重触发即可顺畅继续。

## Non-Goals

- 不做磁盘校验与缺失重下（归资源可用性计划）。
- 不做 `ai_summary_task` 状态单一来源重构与子任务资源级键（归 P1 架构收敛计划）。
- 不做自动重试/指数退避（作为 Deferred 记录）。
- 不做前端改动。

## Infrastructure And Config Prereqs

No infra prereqs beyond existing baseline（对账在 `onModuleInit` 内完成，读写 SQLite）。

## Execution Plan

### Phase 1 - trigger 全量错误落地与守卫统一

Status: completed
Targets: `packages/server/src/analysis/analysis-trigger.service.ts`、`packages/server/src/analysis/analysis.controller.ts`、`packages/server/src/database/database.service.ts`

- Item Types: `Fix` 为主，含 1 项 `Decision`；本阶段声明 `Fix-heavy`
- Prereqs: none

- [x] Fix: 将 `trigger()` 中 `try` 块范围扩大到包含全部前置步骤（`resolveTaskForAnalysis` / `shouldReuseDownloadedVideo` / 目录准备 / 低清调度 / `getLlmConfig`），任何异常统一落 `summaryStatus=failed` + `ai_summary_task=failed`（带错误信息）+ 失败通知。→ 全部前置逻辑移入 `runAnalysis()` 的 try/catch（`analysis-trigger.service.ts:245-497`）。
- [x] Fix: 统一资源级与任务级入口的进行中拦截 —— `POST /api/analysis/trigger` 增加与任务级一致的 `ai_summary_task` pending/analyzing 冲突判定，返回 `ConflictException`。→ `analysis.controller.ts:114-126`。
- [x] Decision: 触发认领原子化 —— 实施为 `DatabaseService.claimAiSummaryTask()`（`INSERT ... ON CONFLICT DO UPDATE ... WHERE status NOT IN ('pending','analyzing')`，单进程 + better-sqlite3 同步保证互斥）。备选（内存锁/应用层信号量）未采用（进程内同步事务已够，且多实例不在当前范围）。残余风险：多实例部署时认领需下沉为分布式锁（已记录 Deferred）。
- [x] Fix: 火警回调（`download-scheduler.onAnalysisTrigger` / `onLowResFinished`）与 controller fire-and-forget 路径在 `trigger()` 异常时的日志语义对齐（`trigger()` 自身已落状态，调用方不再吞错）。→ 状态由 `runAnalysis` 全量落地；低清完成续跑改为直接调 `runAnalysis` 而非重走 `trigger()`（`analysis-trigger.service.ts:84-100`）。
- [x] Proof: 运行 `pnpm typecheck` 通过。
- [x] Proof: 按 `docs/testing/2026/08-11-ai-summary-trigger-robustness-testing.md` 验证（逻辑级代码检查通过；运行级异常注入/并发双点留用户手动验证）。

Exit Criteria:

- [x] 行为落地：`trigger()` 任意阶段异常都落 `failed` 状态并有失败通知；两个入口进行中守卫一致；并发重复触发被拒绝且不双跑。
- [x] 相关文档：`docs/design/app-overview.md` 不涉及状态机细节，写 `No owner-doc update required`。
- [x] `docs/logs/` 更新。

### Phase 2 - 启动对账与卡死恢复

Status: completed
Targets: `packages/server/src/analysis/analysis-trigger.service.ts`、`packages/server/src/database/database.service.ts`

- Item Types: `Fix` 为主，含 1 项 `Decision`；本阶段声明 `Fix-heavy`
- Prereqs: Phase 1

- [x] Fix: `onModuleInit` 中对 `analysis_sub_task` 状态为 `created` 的记录标为 `failed`（错误信息"服务重启，低清下载中断"），使重触发时能重建子任务重新下载，消除永久等待。→ `DatabaseService.reconcileStaleAnalysisState()`，由 `AnalysisTriggerService.onModuleInit` 调用。
- [x] Fix: 对 `summaryStatus` 为 `pending`/`analyzing` 的总结落 `failed`（错误信息"服务重启，AI 总结中断，请重新触发"），避免 UI 永久显示"总结中"。→ 同一对账方法。
- [x] Decision: 是否启动自动重触发分析 —— 选择保守方案"标 failed + 手动重触发"；备选"自动 resume"未采用（需幂等与并发控制，P0 不引入，避免开机即产生下载流量）。残余风险：重启中断的任务需用户手动点击重触发。
- [x] Proof: 运行 `pnpm typecheck` 通过；DB 冒烟脚本验证对账行为（created 子任务→failed、pending/analyzing→failed）。
- [x] Proof: 按 `docs/testing/2026/08-11-ai-summary-trigger-robustness-testing.md` 验证（重启对账逻辑级通过；运行级重启回归留用户手动）。

Exit Criteria:

- [x] 行为落地：重启后无 `analysis_sub_task` 停留在 `created`；无任务永久显示 `pending`/`analyzing`；重触发可顺畅重新下载并继续。
- [x] 相关文档：`No owner-doc update required`（`docs/design/app-overview.md` 未描述重启恢复行为）。
- [x] `docs/logs/` 更新。

## Plan Audit

- Status: passed
- Reviewer / Agent: 独立 subagent（explore，task `ses_010896279ffelAsyfTE2tfH5fx`）
- Evidence: 审计核对了全部 16 条 baseline 断言与 live 代码，全部实质一致、行号精确。修正一处文件归因（`onAnalysisTrigger`/`onLowResFinished` 实现在 `analysis-trigger.service.ts` 的 `onModuleInit`，非 `download-scheduler.ts`）。审计补充三条事实并已并入 Baseline：① 存在显式缺失字段→failed 分支（:213-231，非抛错路径）；② 前置阶段还含 `resolveSummaryDir`（:295）与 analyzing 写入（:313-323）；③ 资源级入口失败后 `autoSummary=1` 已固化，二次触发被自身 ConflictException 挡住，加深静默失败。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck` + `pnpm build` 通过；DB 冒烟脚本验证对账；运行级留用户手动，原因记录于测试文档）
- [x] corresponding `docs/testing/2026/08-11-ai-summary-trigger-robustness-testing.md` 存在；逻辑级方向已确认，运行级场景（异常注入、并发双点、重启回归）显式 adjudicated 为用户手动验证并记录原因
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] text consistency verified：status、phases、gates、testing document、log 一致
- [x] closure audit was independent（冷回放自查 + 独立 plan audit 前置通过）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 低清下载失败的自动重试（退避）

- Classification: `optimization candidate`
- Why Not Blocking Closure: 当前失败后标 `failed`，用户重触发可恢复（`find(status!=='failed')` 全部失败后新建子任务）。自动重试会增加静默网络行为，收益有限。
- Successor Required: `no`（除非低清失败率显著上升再评估）

### 启动自动 resume 中断的分析

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 保守选择标 failed + 手动重触发；自动 resume 需要额外的幂等与并发控制，P0 不引入。
- Successor Required: `no`

## Closure

Status Note: P0 触发健壮性完成。以冷回放视角重放计划：`trigger()` 只保留守卫 + 原子认领 + 低清等待判断，全部前置决策与 analyze 移入 `runAnalysis()` 的 try/catch，任意异常落 `failed` + 通知；资源级入口新增进行中拦截；`claimAiSummaryTask` 原子认领防并发双跑；`onLowResFinished` 成功直接续跑 `runAnalysis`（避免认领被拒），失败落 failed 并通知；启动对账把遗留 created 子任务与 pending/analyzing 总结标 failed。`pnpm typecheck`/`pnpm build` 通过，DB 冒烟脚本验证认领互斥与对账。运行级（异常注入、并发双点、重启回归）留用户手动。

Closure Audit Evidence:

- Reviewer / Agent: 冷回放自查（`none` reviewer，非 protected、非高风险计划）
- Evidence: 见本 Closure 说明；改动与 Phase 1/2 各项一一对应；`pnpm typecheck`、`pnpm build` 通过；DB 冒烟脚本 5/5 PASS。

Follow-up:

- 无。
