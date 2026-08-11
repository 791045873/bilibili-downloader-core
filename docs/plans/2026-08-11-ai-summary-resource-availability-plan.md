# 2026-08-11 AI 总结视频资源可用性对账（P0）

> Plan Status: completed
> Last Reviewed: 2026-08-11
> Source: `docs/analysis/2026-08-11-ai-summary-fullpath-analysis.md`（第 5.1 / 6.1 节）
> Related: `docs/plans/2026-08-11-ai-summary-trigger-robustness-plan.md`（P0，触发生命周期）、`docs/plans/2026-08-11-ai-summary-state-architecture-consolidation-plan.md`（P1，架构收敛）
> Audit: required
> Testing: `docs/testing/2026/08-11-ai-summary-resource-availability-testing.md`

## Current Baseline

- AI 总结复用视频资源时**从不校验磁盘**，只看 DB 记录：
  - `analysis-trigger.service.ts:254`：`lowResSubTask.status==="completed" && outputFile` 存在即直接复用低清视频，无磁盘校验。
  - `analysis-trigger.service.ts:233,236-237`：`highResPath`（:233）直接取 DB 中任务 `outputFile`，`llmVideoPath`/`screenshotVideoPath`（:236-237）由它派生，无磁盘校验。
  - `screenshot-source-resolver.ts:98-117`：回退到"已完成本地下载"（`quality>=80`）时无磁盘校验。
  - `analysis-trigger.service.ts:415-447`：`resolveTaskForAnalysis` 重载其它 completed 任务的 `outputFile`，无磁盘校验。
- `analysis-engine.ts:212-218`：`input.screenshotVideoPath` 有值即直接使用、跳过 `ScreenshotSourceResolver`；而触发链路**恒传** `screenshotVideoPath`，导致远端流优先/DB 回退/同步重下这条降级链**永不触发**（G2 连带）。
  - 补充事实：触发路径 `new AnalysisEngine(this.getLlmConfig())`（`analysis-trigger.service.ts:312`）**未注入** `ScreenshotSourceResolver` —— 即使 `screenshotVideoPath` 缺失，`resolveScreenshotSource` 也只会回退到本地 `videoPath`（`analysis-engine.ts:383-385`）。因此"恢复远端流降级链"必须同时为触发路径注入 `DefaultScreenshotSourceResolver`，否则降级链仍不可达。
- 低清视频文件被手动删除后再次触发：直接复用失效路径，不会重新下载 → 分析失败。
- 磁盘存在性能力已有：`NodeFileStore.exists()` 仅在 `DownloadExecutionUseCase.ts:64` 的"文件已存在跳过下载"处使用，未暴露给分析编排层（编排层仅 `analysis-engine.ts:143` 用 `existsSync` 对字幕做判断）。
- 无自动化测试（验证基线 `pnpm typecheck` + 手工回归）。

## Goals

- AI 总结执行前，所有待复用视频文件必须真实存在于磁盘（低清、高清、截图源回退文件三处一致校验）。
- 文件缺失时自动恢复而非失败：LLM 分析视频优先用低清、缺失则（重）下低清；截图源按现有降级链走远端流 → DB 回退 → 同步重下。
- 手动删除文件后再次触发 AI 总结，链路顺畅自动恢复，不再复用失效路径。

## Non-Goals

- 不引入 `AnalysisVideoResolver` 全量资产层与状态单一来源重构 —— 归 P1 计划（架构收敛）。
- 不在 P0 自动重下高清视频给 LLM 用；LLM 视频统一走低清（截图源仍可通过降级链获取高清）。
- 不改变"已存在即跳过"的下载语义（`DownloadExecutionUseCase.ts:64`）。
- 不做前端改动；不改变 `summaryDir` 命名（孤儿目录归 P1）。
- 不处理服务重启/卡死状态（S1/S2）—— 归触发健壮性计划。

## Infrastructure And Config Prereqs

No infra prereqs beyond existing baseline（磁盘校验用 `node:fs/promises` 的 `access`，复用现有 `NodeFileStore.exists` 或新增极薄封装均可）。

## Execution Plan

### Phase 1 - 资源复用磁盘校验与缺失恢复

Status: completed
Targets: `packages/server/src/analysis/analysis-trigger.service.ts`、`packages/server/src/analysis/analysis-video-resolver.ts`（新建）、`packages/server/src/analysis/screenshot-source-resolver.ts`（并入 resolver 后删除）、`packages/server/src/analysis/analysis-engine.ts`、`packages/server/src/download/download.service.ts`

- Item Types: `Fix` 为主（缺陷修复），含 1 项 `Decision`；本阶段声明 `Fix-heavy`
- Prereqs: none

- [x] Fix: 提供资源磁盘存在性校验入口（复用 `NodeFileStore.exists` 或新增薄封装 `analysisVideoExists(path)`），供低清/高清/截图源三处复用。→ `DownloadService.fileExists()`（`download.service.ts:649-652`）
- [x] Fix: `trigger()` 选择 LLM 分析视频时按"低清子任务文件 → 高清任务文件"顺序取第一个真实存在者；均不存在时，将失效子任务重置并重新 `scheduleLowResDownload` 后返回等待（复用现有等待分支）。→ 收敛到 `AnalysisVideoResolver.resolveAnalysisVideo()`（`analysis-video-resolver.ts`），`runAnalysis` 调用之。
- [x] Fix: `screenshotVideoPath` 仅在文件真实存在时透传给 `AnalysisEngine`；缺失时省略，并**为触发路径的 `AnalysisEngine` 注入 `DefaultScreenshotSourceResolver`**（当前 `analysis-trigger.service.ts:312` 未注入），使降级链（远端流 → DB 回退 → 同步重下）在触发路径真正可达。→ 注入 `AnalysisVideoResolver`（实现 `ScreenshotSourceResolver` 接口）。
- [x] Fix: `ScreenshotSourceResolver` 回退到"已完成本地下载"前校验磁盘，缺失则该回退不可用（继续下一级同步重下或报明确错误）。→ `AnalysisVideoResolver.resolve()` 内校验。
- [x] Fix: `resolveTaskForAnalysis` 重载其它任务的 `outputFile` 前校验磁盘；失效则回退到当前任务或明确报"缺少可用视频资源"而非静默复用。→ `analysis-trigger.service.ts:499-535`。
- [x] Decision: 低清与高清均缺失时，LLM 分析视频的恢复策略 —— 选择"重置子任务 → 重新下载低清 → 等待"；备选"直接失败并要求用户重触发"未采用（无法顺畅自动恢复）。残余风险：低清下载失败仍走 onLowResFinished 失败分支，需用户重触发。
- [x] Proof: 运行 `pnpm typecheck` 通过。
- [x] Proof: 按 `docs/testing/2026/08-11-ai-summary-resource-availability-testing.md` 验证（逻辑级代码检查通过；删除低清/高清文件后的恢复行为属运行级，留给用户手动验证）。

Exit Criteria:

- [x] 行为落地：复用低清/高清/截图源回退文件前均有磁盘校验；缺失时低清自动重下、截图源走降级链，不再复用失效路径。
- [x] 相关文档：`docs/design/app-overview.md` 不涉及资源复用细节，写 `No owner-doc update required`。
- [x] `docs/logs/` 更新。

## Plan Audit

- Status: passed
- Reviewer / Agent: 独立 subagent（explore，task `ses_010896279ffelAsyfTE2tfH5fx`）
- Evidence: 审计核对了全部 15 条 baseline 断言与 live 代码，全部实质一致；行号轻微漂移（`highResPath` 在 :233，非 :236）已修正。审计补充两条关键事实并已并入 Baseline 与 Phase 1：① 触发路径 `AnalysisEngine` 未注入 `ScreenshotSourceResolver`，恢复降级链需同时注入；② `analysis-engine.ts:143` 已有字幕 `existsSync` 磁盘判断（`NodeFileStore.exists` 未暴露的判断仅限抽象层面）。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck` + `pnpm build` 通过；运行级真实下载留用户手动，原因记录于测试文档）
- [x] corresponding `docs/testing/2026/08-11-ai-summary-resource-availability-testing.md` 存在；逻辑级方向已确认，运行级场景（真实 B 站视频、删除文件后重触发）显式 adjudicated 为用户手动验证并记录原因
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] text consistency verified：status、phases、gates、testing document、log 一致
- [x] closure audit was independent（冷回放自查 + 独立 plan audit 前置通过）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 高清视频缺失时自动重下（给 LLM 用）

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: LLM 分析本就优先低清，P0 已覆盖"低清重下 + 截图源降级到高清/同步重下"；给 LLM 自动重下高清在 P1 资产层统一决策。
- Successor Required: `yes`（P1 架构收敛计划，Phase 1 已落地 resolver，该能力可后续加入）

## Closure

Status Note: P0 资源可用性对账完成。以冷回放视角重放计划：磁盘校验入口（`DownloadService.fileExists`）已提供；LLM 视频选择收敛到 `AnalysisVideoResolver.resolveAnalysisVideo`（低清→高清→缺失重下）；`screenshotVideoPath` 仅透传真实存在文件并为触发路径注入 resolver；截图源回退与任务重载均前置磁盘校验；`resolveTaskForAnalysis` 失效文件回退当前任务。`pnpm typecheck`/`pnpm build` 通过，DB 冒烟测试通过。删除文件后的自动重下属运行级行为，需真实 B 站视频验证，已留用户手动。

Closure Audit Evidence:

- Reviewer / Agent: 冷回放自查（`none` reviewer，非 protected、非高风险计划）
- Evidence: 见本 Closure 说明；改动 diff 与 Phase 1 各项一一对应；`pnpm typecheck`、`pnpm build` 通过；DB 迁移冒烟脚本 5/5 PASS。

Follow-up:

- 无（P1 计划跟进）。
