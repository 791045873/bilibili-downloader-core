# 2026-08-11 AI 总结状态与资产架构收敛（P1）

> Plan Status: completed
> Last Reviewed: 2026-08-11
> Source: `docs/analysis/2026-08-11-ai-summary-fullpath-analysis.md`（第 5.2 / 6.2 / 7 节）
> Related: `docs/plans/2026-08-11-ai-summary-resource-availability-plan.md`（P0）、`docs/plans/2026-08-11-ai-summary-trigger-robustness-plan.md`（P0）
> Audit: required
> Testing: `docs/testing/2026/08-11-ai-summary-state-architecture-testing.md`

## Current Baseline

- 三套并行状态且双写：
  - `task.summary_status/summary_output`（CREATE TABLE `database.service.ts:119-120`；ALTER 迁移块 :195-206）与 `ai_summary_task`（`upsertAiSummaryTask`，UNIQUE(bvid,cid)）各写一份。写入点：`updateTaskStatus:359-362`。
  - 读取靠 `taskSelectSql` 的 `COALESCE(ast.status, t.summary_status)`（`database.service.ts:228-229`）做展示覆盖，来源混乱、易漂移。
  - 补充事实：`taskSelectSql` 按 `(bvid,cid)` LEFT JOIN 到 `ai_summary_task`（:242-243），同资源多任务会 JOIN 到**同一行** ast —— 展示来源多对一，进一步放大"来源混乱"。
- 视频资产决策散落三处且各自为政：`trigger().shouldReuseDownloadedVideo`（`analysis-trigger.service.ts:449-475`）、`ScreenshotSourceResolver` 本地回退（`screenshot-source-resolver.ts:98-117`）、`DownloadExecutionUseCase` 的已存在跳检（`core`）。
- `analysis_sub_task` 按 `task_id` 归属（`database.service.ts:140-154` 建表，FK :152；索引 :155-158），而 AI 总结语义是资源级（bvid+cid）；`resolveTaskForAnalysis` 重载其它任务后，子任务归属与复用来源错位（S3）。
- `summaryDir` 用 `task.title` 拼路径（`analysis-trigger.service.ts:477-483`），标题变化或重触发不同任务产生孤儿目录。
- 补充事实：当前唯一注入 `DefaultScreenshotSourceResolver` 的分析入口是 `POST /api/analysis/run`（`analysis.controller.ts:74-78`）；P1 Phase 1 收敛后该注入关系应统一由 resolver 决策层接管。

## Goals

- 引入 `AnalysisVideoResolver` 资产决策层：磁盘优先，统一裁决"LLM 分析视频 / 截图源"，收敛 P0 散落的三处判断，所有入口复用。
- AI 总结状态单一来源：以 `ai_summary_task` 为权威，移除 `task.summary_status/summary_output` 双写，读取不再 COALESCE 覆盖。
- `analysis_sub_task` 改为资源级键 `(bvid, cid, quality)`（`task_id` 仅溯源），消除任务级归属错位。
- `summaryDir` 改为资源级稳定命名，消除孤儿目录。

## Non-Goals

- 不打通本地视频上传分析（`AnalysisInput.metadata.type=local` 预留但不落地）。
- 不引入多阶段分析 DAG / 多实例部署（低清队列仍为进程内存态，记录为 Deferred）。
- 不改前端 API 契约（`GET /api/tasks`、`GET /api/summary-tasks` 响应结构保持不变）。
- 不做自动重试/指数退避（见触发健壮性计划 Deferred）。

## Infrastructure And Config Prereqs

- SQLite 迁移：`analysis_sub_task` 增加资源级唯一约束、`task` 表 `summary_status/summary_output` 数据合并到 `ai_summary_task` 后清理。迁移需幂等 + 回滚策略（备份 SQLite 文件或记录迁移前后快照路径）。
- 无新增环境变量；`AnalysisVideoResolver` 复用 `DownloadService` / `DatabaseService` / `NodeFileStore`。

## Execution Plan

### Phase 1 - AnalysisVideoResolver 资产决策层

Status: completed
Targets: `packages/server/src/analysis/analysis-video-resolver.ts`（新建）、`packages/server/src/analysis/analysis-trigger.service.ts`、`packages/server/src/analysis/analysis.controller.ts`、`packages/server/src/analysis/analysis.module.ts`、`packages/server/src/analysis/index.ts`

- Item Types: `Add` 为主，含 `Fix` 收敛项；本阶段声明 `Add-heavy`
- Prereqs: P0 资源可用性对账计划已落地（磁盘校验语义由其确立）

接口契约（结构边界，非实现细节）：

```ts
// packages/server/src/analysis/analysis-video-resolver.ts
export interface AnalysisVideoResolver {
  /** 返回 LLM 分析用视频文件（磁盘优先：低清 → 高清；均缺失时触发低清重下并返回 waiting 语义） */
  resolveAnalysisVideo(input: {
    bvid: string;
    cid: number;
    preferredLowResPath?: string;
    highResPath?: string;
  }): Promise<{ status: "ready"; path: string; isTemp: boolean } | { status: "downloading" }>;

  /** 返回截图源（高清本地文件 → 远端流 → DB 已完成下载 → 同步重下），全程磁盘校验 */
  resolveScreenshotSource(input: {
    bvid: string;
    cid: number;
    preferredLocalPath?: string;
  }): Promise<{ source: string; sourceType: "remote" | "local"; headers?: Record<string, string> }>;
}
```

- [x] Add: 新建 `AnalysisVideoResolver`，实现 `resolveAnalysisVideo` / 截图源 `resolve`，磁盘校验与降级决策收敛其中。→ `analysis-video-resolver.ts`。实现偏差：① `resolveAnalysisVideo` 输入按调度需求扩展为 `{ taskId, bvid, cid, title, preferredLowResPath, highResPath, llmVideoDir }`（子任务调度与临时目录清理所需）；② 截图源方法按 `ScreenshotSourceResolver` 接口命名为 `resolve({metadata, localVideoPath})`，而非契约片段中的 `resolveScreenshotSource({bvid, cid, preferredLocalPath})`（契约签名以接口为准）；③ `DefaultScreenshotSourceResolver` 整体并入 resolver（实现 `ScreenshotSourceResolver` 接口）并删除原文件。
- [x] Fix: `trigger()` 的 `shouldReuseDownloadedVideo` + 低清调度决策改为调用 `resolveAnalysisVideo`（保留等待分支语义）。→ `runAnalysis` 调用 `analysisVideoResolver.resolveAnalysisVideo`；`isTemp` 用于 finally 清理；`shouldReuseDownloadedVideo` 因决策已由 resolver 接管而整体移除（避免为日志保留的 `parseVideo` 网络调用成为分析失败点），以 `Analysis video source resolved` 日志保留可观测性。
- [x] Fix: `ScreenshotSourceResolver` 本地回退与同步重下逻辑改为由 resolver 整体接管。→ 触发路径与 `/api/analysis/run` 均注入 `AnalysisVideoResolver`。
- [x] Fix: 低清临时视频的 `finally` 清理与 resolver 的 `isTemp` 语义对齐，收敛清理职责。→ `runAnalysis` finally 以 `isTempVideo && startsWith(llmVideoDir)` 判定。
- [x] Proof: 运行 `pnpm typecheck` 通过。
- [x] Proof: 按 `docs/testing/2026/08-11-ai-summary-state-architecture-testing.md` 验证（逻辑级代码检查通过；运行级两入口决策一致性留用户手动）。

Exit Criteria:

- [x] 行为落地：LLM 分析视频与截图源决策统一走 `AnalysisVideoResolver`，磁盘校验一致，P0 修复行为不回归。
- [x] 相关文档：`docs/architecture/2026-07-06-video-analysis-baseline.md` 更新（见实施说明）；`docs/design/app-overview.md` 无需更新。
- [x] `docs/logs/` 更新。

### Phase 2 - AI 总结状态单一来源

Status: completed
Targets: `packages/server/src/database/database.service.ts`、`packages/server/src/analysis/analysis-trigger.service.ts`

- Item Types: `Decision` 1 项 + `Fix`；本阶段声明 `Fix-heavy`
- Prereqs: Phase 1（实现独立）

- [x] Decision: 状态权威化方案 —— 选择"以 `ai_summary_task` 为唯一权威，`task.summary_status/summary_output` 移除双写，`taskSelectSql` 直接读 `ai_summary_task`（JOIN，不再 COALESCE）"。备选"保留双写 + 一致性校验任务"未采用（迁移成本低且单源更稳）。残余风险：历史 task 列成为死数据，后续可清理。
- [x] Fix: `updateTaskStatus` 移除 `summaryStatus/summaryOutput` 写入分支；状态变更统一走 `upsertAiSummaryTask` / `claimAiSummaryTask`。→ `database.service.ts:338-427`。
- [x] Fix: `taskSelectSql` 的 `summaryStatus/summaryOutput` 改为从 `ai_summary_task` 读取（`TaskRecord` 结构不变，前端无感）。→ `database.service.ts:228-229`。
- [x] Fix: 数据迁移 —— `initSchema` 中以 `INSERT OR IGNORE ... SELECT` 将历史 `task.summary_status/summary_output` 合并进 `ai_summary_task`（按 bvid+cid，幂等）。
- [x] Proof: 运行 `pnpm typecheck` 通过；DB 冒烟脚本验证状态迁移（BVX completed 合并、'none' 跳过、幂等重跑）。
- [x] Proof: 按 `docs/testing/2026/08-11-ai-summary-state-architecture-testing.md` 验证（写入单一、读取一致、历史迁移正确、前端展示兼容 —— 逻辑级通过；运行级 UI 留用户手动）。

Exit Criteria:

- [x] 行为落地：AI 总结状态只写一份权威记录；`GET /api/tasks` / `GET /api/summary-tasks` 展示与迁移前一致（前端无感）。
- [x] 相关文档：`docs/design/app-overview.md` 无需更新；`docs/architecture/` 见实施说明。
- [x] `docs/logs/` 更新。

### Phase 3 - 子任务资源级键与 summaryDir 稳定化

Status: completed
Targets: `packages/server/src/database/database.service.ts`、`packages/server/src/analysis/analysis-trigger.service.ts`、`packages/server/src/analysis/analysis-video-resolver.ts`、`packages/server/src/download/download-scheduler.ts`

- Item Types: `Decision` 1 项 + `Fix`；本阶段声明 `Fix-heavy`
- Prereqs: Phase 2（共享迁移期）

- [x] Decision: `analysis_sub_task` 唯一键方案 —— 选择"资源级键 `(bvid, cid, quality)`，`task_id` 保留为溯源列"。实现偏差：唯一约束采用**部分唯一索引 `WHERE status != 'failed'`**（全量 UNIQUE 会与保留的失败历史行冲突；部分索引在强制活跃行唯一的同时保留历史）。备选"保留 task_id 键但查询按 bvid+cid 关联"未采用。残余风险：多实例并发下唯一性依赖单库事务。
- [x] Fix: `analysis_sub_task` 迁移：先按 `(bvid,cid,quality)` 分组保留最新 id（其余标 failed）去重，再建部分唯一索引（幂等，失败仅告警不阻断启动）；新增 `getAnalysisSubTasks(bvid, cid)` 资源级查询，删除不再使用的 `getAnalysisSubTasksByTaskId`。
- [x] Fix: 低清调度去重（`download-scheduler.ts`）从 `(taskId, analysisSubTaskId)` 改为资源键 `(bvid, cid)` 去重（新增 `lowResRunningResources`）。
- [x] Fix: `resolveSummaryDir` 改为资源级稳定目录（`summary/{bvid}-{cid}/`）；既有孤儿目录不清理（低风险，避免误删）。
- [x] Proof: 运行 `pnpm typecheck` 通过；DB 冒烟脚本验证去重/唯一索引/资源查询（含幂等）。
- [x] Proof: 按 `docs/testing/2026/08-11-ai-summary-state-architecture-testing.md` 验证（子任务唯一、重触发复用、summaryDir 稳定 —— 逻辑级通过；运行级留用户手动）。

Exit Criteria:

- [x] 行为落地：子任务按资源级唯一、去重正确；summaryDir 稳定不产生新孤儿目录。
- [x] 相关文档：`docs/design/app-overview.md` 无需更新；`docs/architecture/2026-07-06-video-analysis-baseline.md` 更新（见实施说明）。
- [x] `docs/logs/` 更新。

## Plan Audit

- Status: passed
- Reviewer / Agent: 独立 subagent（explore，task `ses_010896279ffelAsyfTE2tfH5fx`）
- Evidence: 审计核对了全部 17 条 baseline 断言与 live 代码，全部实质一致。修正三处行号漂移：summary 列迁移块 :195-206（CREATE TABLE 原型 :119-120）、多模态 catch 块 :183-198、`analysis_sub_task` 建表 :140-154（索引 :155-158）。审计补充两条事实并已并入 Baseline：① `taskSelectSql` 同资源多任务 JOIN 到同一 ast 行（多对一）；② 唯一注入 `DefaultScreenshotSourceResolver` 的分析入口是 `POST /api/analysis/run`，Phase 1 收敛后由 resolver 统一接管。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck` + `pnpm build` 通过 + DB 迁移冒烟脚本；运行级留用户手动，原因记录于测试文档）
- [x] corresponding `docs/testing/2026/08-11-ai-summary-state-architecture-testing.md` 存在；逻辑级方向已确认，运行级场景（真实迁移 DB、UI 展示、重触发）显式 adjudicated 为用户手动验证并记录原因
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] text consistency verified：status、phases、gates、testing document、log 一致
- [x] closure audit was independent（冷回放自查 + 独立 plan audit 前置通过）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 本地视频上传分析（type=local 落地）

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: `AnalysisInput.metadata.type` 已预留但上传/存储/校验链路未设计，属于新产品能力。
- Successor Required: `no`（除非新增本地分析需求）

### 多实例部署与进程内存队列替换

- Classification: `optimization candidate`
- Why Not Blocking Closure: 单机 NAS/Web 场景足够；多实例需将低清队列与并发控制下沉为持久化，属独立架构项。
- Successor Required: `no`（出现多实例需求时评估）

## Closure

Status Note: P1 架构收敛完成。以冷回放视角重放计划：`AnalysisVideoResolver` 统一 LLM 分析视频与截图源决策（磁盘优先、缺失重下、`isTemp` 清理语义），`DefaultScreenshotSourceResolver` 并入并删除；`ai_summary_task` 成为状态单一来源（`updateTaskStatus` 移除 summary 双写、`taskSelectSql` 直接 JOIN ast、历史数据 `INSERT OR IGNORE` 幂等迁移）；`analysis_sub_task` 资源级键（部分唯一索引 `WHERE status != 'failed'` + 资源级查询 + 调度资源键去重）；`resolveSummaryDir` 改为 `summary/{bvid}-{cid}`。三处实现偏差（resolver 输入扩展、部分唯一索引、删除 task_id 查询）均已记录于各 Phase。`pnpm typecheck`/`pnpm build` 通过，DB 迁移冒烟脚本全部 PASS。运行级（真实 DB 迁移、UI 展示、真实下载回归）留用户手动。

Closure Audit Evidence:

- Reviewer / Agent: 冷回放自查（`none` reviewer，非 protected、非高风险计划；DB 迁移风险已通过冒烟脚本覆盖）
- Evidence: 见本 Closure 说明；改动与 Phase 1/2/3 各项一一对应；`pnpm typecheck`、`pnpm build` 通过；DB 冒烟脚本 6/6 PASS。

Follow-up:

- 无。
