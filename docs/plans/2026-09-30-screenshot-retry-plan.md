# 2026-09-30 重试截图（rebuild → screenshot_retry 收窄，作业化执行体）

> Plan Status: planned
> Last Reviewed: 2026-09-30
> Source: `docs/requirements/2026-09-17-screenshot-retry.md`
> Related: 上游 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（Q1 截图重试 / rebuild 收窄）；前置 Phase 1b（screenshot_url 入 DB、截图入 COS）、Phase 2（screenshot_retry 作业化，handler 当前调用旧 runRebuild）；截图源顺序承接 3a/3b
> Audit: required（改 API 语义 + 复用截图/COS 管线；非部署/auth/删除保护区；无 schema 变更；reviewer availability=none → 独立子代理或 cold-replay 留证）
> Testing: `docs/testing/2026/09-30-screenshot-retry-testing.md`

## Current Baseline

- `POST /api/summary-tasks/:id/rebuild`（`analysis-task.controller.ts`，P2-3 后）：校验记录存在/completed/rawResponse 非空后 **enqueue `screenshot_retry`**（payload `{summaryTaskId}`，dedup `screenshot_retry:{id}`）。
- Phase 2 handler：`AnalysisTriggerService.handleScreenshotRetryJob` → `runRebuild(id)`。`runRebuild` 当前语义**过宽**：`engine.rebuild(rawResponse)`（不调 LLM，但从 raw 重渲染全部段+截图）→ `resetAiSummaryTaskIntegrity` → `upsertAiSummaryTask(completed)` → `publishInline(...)`（**全量重写 summary 段/内容/向量 + 重传截图**）。本需求要将其**收窄为仅重试截图**。
- 截图能力：`AnalysisEngine` 内 `this.screenshotter = new FfmpegScreenshot()`（`@bilibili-downloader/adapters/ffmpeg`），`takeScreenshots({videoPath,timePoints:[s],outputDir,filenamePrefix,headers}) → {outputFiles[]}`。截图源经 `AnalysisVideoResolver.resolve({metadata:{type:"bilibili",bvid,cid}})` → `{source,sourceType,headers?}`。**注（经审计核对）**：`resolve` 对 bilibili 的实际顺序是 **远端流优先 → 已完成本地下载 → 同步重下**（非本地优先），且 bilibili 分支不读 `localVideoPath`/`videoUrl`。旧 `runRebuild` 是通过**显式把本地高清文件当作 `screenshotVideoPath`** 实现本地优先的（engine 见到 `screenshotVideoPath` 即直接用本地，不走 resolve）。
- COS：`CosStoreService.upload(localPath,key) → url`；`isConfigured()`；`@Injectable`（仅读 env，无构造依赖）。key 约定 `summary/{bvid}-{cid}/screenshots/{basename}`（见 `publishInline`）。
- 数据：`SummarySegment{ id, summaryId, seq, title, content, timestampSeconds?, frameDescription?, screenshotUrl? }`；`Summary.id` 存在。`getSummaryWithSegmentsByResource` 返回段（含 screenshotUrl）但**不含 timestampSeconds/summaryId**。**无**按段更新 screenshot_url 的方法（`upsertSummaryKnowledge` 为整体 delete+insert，不可用于纯截图回写）。
- 前端：`AiSummaryTasks.tsx` 有 rebuild 按钮（“重新构建”类语义）；`api/index.ts` `rebuildSummaryTask(id)` POST `/summary-tasks/:id/rebuild`。

## Goals

- 将 rebuild 收窄为**纯重试截图**：读段 `timestampSeconds` + 截图源 → 截图 → 传 COS → **仅回写 `summary_segment.screenshot_url`**；不调 LLM、不改 summary 文本/向量、不重写段内容、不改 `ai_summary_task` 状态。
- 批量：默认仅处理 `screenshot_url` 为空且 `timestampSeconds` 非空的段（幂等；已存截图不重传）。
- 截图源三级降级（本地高清 → NAS 下载 → 远端兜底），降级/跳过显式记日志。
- 安全跳过：视频缺失 / timestamp 缺失 / COS 未配置或上传失败 → 跳过该段并记录，不使整作业失败、不破坏内容。
- 触发/status 沿用 Phase 2 作业机制。

## Non-Goals

- 重跑分析/LLM（`retrigger`）；视频下载补齐（下载作业）；完整性判据（integrity-rescope，已完成）。
- 强制重截所有段（含已有截图）——本期仅补齐缺失；如需 force 全量为后续可选。
- 新增列/schema 变更；/rebuild 路径改名（保留路径、仅收窄语义，保证前端兼容；改名为 Open Question 暂不做）。

## Execution Plan

### Phase 1 - 数据层：按段回写 + 取段（含 timestamp/summaryId）

Status: planned
Targets: `packages/server/src/database/database.service.ts`

- Item Types: `Add`
- Prereqs: 无
- [ ] `Add`：`updateSegmentScreenshotUrl(summaryId:number, seq:number, url:string|null)` —— raw SQL 或 ORM 更新单段 `screenshot_url`（比照 `updateSummarySegmentEmbeddings` 的按 (summaryId,seq) 更新，不触碰其它列/updated_at 语义）。
- [ ] `Add`：`getSummarySegmentsForScreenshotRetry(bvid,cid)` → `{ summaryId:number, segments:Array<{seq,timestampSeconds:number|null,screenshotUrl:string|null}> }`（或扩展现有读方法暴露 summaryId+timestampSeconds）。
- [ ] `Proof`：`typecheck`、`build`。

Exit Criteria:
- [ ] 可按 (summaryId,seq) 精确回写 screenshot_url；可取到段的 timestamp/现有 screenshot_url/summaryId。
- [ ] `docs/logs/` 记录。

### Phase 2 - ScreenshotRetryService + 收窄 handler + 移除旧 rebuild

Status: planned
Targets: `packages/server/src/analysis/screenshot-retry.service.ts`（新增）、`analysis-trigger.service.ts`、`analysis.module.ts`

- Item Types: `Add | Fix`
- Prereqs: Phase 1
- [ ] `Add`：`selectSegmentsForRetry(segments)` 纯函数 —— 返回需重截的段（`screenshotUrl` 空 且 `timestampSeconds` 非空）；导出供测试。
- [ ] `Add`：`ScreenshotRetryService`（`@Injectable`，deps：DatabaseService、AnalysisVideoResolver、DownloadService、CosStoreService、PathsService；内部 `new FfmpegScreenshot()`）。`run(summaryTaskId)`：
  1. 校验记录 completed + bvid/cid；取段（含 timestamp/summaryId/screenshotUrl）；`selectSegmentsForRetry` 选空截图且有 timestamp 的段；无待处理段直接结束。
  2. **截图源（本地优先，修 B1）**：先经 `findLatestTaskByBvidAndCid` + `downloadService.fileExists` 定位本地高清文件；存在 → 直接以本地文件为截图源（sourceType=local，无 headers）；不存在 → 回退 `AnalysisVideoResolver.resolve({metadata:{type:'bilibili',bvid,cid}})`（其内部远端/已完成本地/重下兜底为既有共享行为，NAS-vs-远端子序不在本期重排，记为下方裁决）。两者都不可得 → 全部段跳过并记 `videoMissing` 类日志，不失败整作业。
  3. 逐段 `takeScreenshots({videoPath:source, timePoints:[timestampSeconds], outputDir:screenshotsDir, filenamePrefix:`segment-${seq}`, headers})`（**修 S1**：prefix 固定 `segment-${seq}`）→ 取 `outputFiles[0]` → `cosStore.upload(local, `summary/${bvid}-${cid}/screenshots/${basename(local)}`)`（确定性 key，同段重截覆盖，幂等）→ `updateSegmentScreenshotUrl(summaryId, seq, url)`。
  4. 每段失败（无 timestamp / 截图失败 / COS 失败）安全跳过并记日志；**不动 summary 文本/向量/段内容/`ai_summary_task` 状态**。COS 未配置（`isConfigured()`=false）→ 整体跳过并告警。本地截图落临时目录（`ANALYSIS_LLM_VIDEO_DIR` 下 `screenshot-retry/{bvid}-{cid}`），仅作上传中间产物。
- [ ] `Fix`：`handleScreenshotRetryJob` 改调 `screenshotRetryService.run(summaryTaskId)`（注入）；**移除** `runRebuild`（旧全量重建语义已被收窄取代）及其独有依赖（若 `AnalysisEngine`/`resolveSummaryDir` 仍被 `runAnalysis` 使用则保留）。`analysis.module.ts` 注册 `ScreenshotRetryService`。
- [ ] `Proof`：`typecheck`、`build`。

Exit Criteria:
- [ ] screenshot_retry 作业执行纯截图重试；不重跑 LLM、不改内容/向量/状态。
- [ ] 截图源三级降级；缺失/失败安全跳过；幂等（仅补空段）。
- [ ] `docs/logs/` 记录。

### Phase 3 - 前端语义对齐

Status: planned
Targets: `packages/frontend/src/pages/AiSummaryTasks.tsx`（按钮文案/提示）

- Item Types: `Fix`
- Prereqs: Phase 2
- [ ] `Fix`：rebuild 按钮文案/确认提示收窄为“重试截图”（补齐缺失截图，不重跑分析）；调用路径不变（`/summary-tasks/:id/rebuild`）。
- [ ] `Proof`：frontend `typecheck`、`build`。

Exit Criteria:
- [ ] 前端呈现“重试截图”语义，行为与后端一致；调用兼容。
- [ ] `docs/logs/` 记录。

### Phase 4 - 测试

Status: planned
Targets: `packages/server/tests/`（新增 screenshot-retry 数据层/纯函数测试）

- Item Types: `Add | Proof`
- Prereqs: Phase 1-2
- [ ] `Add`：`selectSegmentsForRetry` 纯函数用例（仅空 screenshot_url 且有 timestamp；有截图/无 timestamp 排除）。
- [ ] `Add`：数据层用例——`updateSegmentScreenshotUrl` 精确改单段、`getSummarySegmentsForScreenshotRetry` 返回 timestamp/summaryId；不影响其它段/内容。
- [ ] `Note`：ffmpeg 截图 + COS 上传为外部 IO，不做单测（typecheck/build + 人工核对覆盖）。
- [ ] `Proof`：server `test` 全绿。

Exit Criteria:
- [ ] 需求 AC 逐条被测试或人工核对覆盖；testing 每条方向确认或裁决。
- [ ] `docs/logs/` 记录。

### Phase 5 - 文档与闭合

Status: planned
Targets: `docs/design/app-overview.md`、`docs/architecture/2026-07-06-video-analysis-baseline.md`、`docs/backlog/README.md`、`docs/logs/`

- Item Types: `Fix | Proof`
- Prereqs: Phase 1-4
- [ ] `Fix`：owner docs——rebuild 语义收窄为 screenshot_retry（纯截图、补齐缺失、三级降级、不改内容）；backlog 增行标 done。
- [ ] `Proof`：独立 closure audit（reviewer=none → 独立子代理或 cold-replay，留证）。

Exit Criteria:
- [ ] owner docs / backlog / log 一致；testing 每条方向确认或裁决。
- [ ] closure gates 全绿。

## Plan Audit

- Status: passed（with required fixes applied）
- Reviewer / Agent: 独立子代理（General，fresh-eyes cold-replay，reviewer availability=none）
- Evidence: 2026-09-30 独立 plan audit，Verdict=PASS-WITH-REQUIRED-FIXES，逐条对照 live code。已修：B1 截图源改本地高清优先（findLatestTaskByBvidAndCid+fileExists 直用本地文件，缺失才回退 resolve），修正 AC3 顺序落地；B2 Current Baseline 更正 resolve() 实际为远端优先；S1 pin `filenamePrefix=segment-${seq}` + 确定性 COS key 保证幂等覆盖。裁决：resolve() 内部 NAS-vs-远端子序为既有共享行为，本期不重排（见 Deferred）。其余基线 file:line 经核对无误。

## Closure Gates

- [ ] in-scope behavior is complete
- [ ] relevant docs aligned（app-overview / video-analysis-baseline / backlog / log）
- [ ] verification has run（server typecheck/build/test、frontend typecheck/build）
- [ ] `docs/testing/` 文档存在且每条方向确认或裁决
- [ ] no in-scope item downgraded to deferred/follow-up
- [ ] plan audit passed（独立子代理或 cold-replay 留证）before implementation
- [ ] micro-plan exception not applicable（改 API 语义 + 多模块 + 新服务）
- [ ] text consistency verified
- [ ] closure audit independent（或 cold-replay 代理留证）

## Deferred But Adjudicated

### AnalysisVideoResolver 内部 NAS-vs-远端子序
- Classification: `watch-only residual`
- Why Not Blocking Closure: 本期以本地高清优先满足 AC3 主序；resolve() 回退链（远端/已完成本地/重下）为与分析共享的既有行为，重排其内部顺序超出本需求范围且影响分析路径。
- Successor Required: `no`（未来如需严格 NAS 下载先于远端，另评估）

### /rebuild 改名 /screenshot-retry
- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: Open Question；保留路径收窄语义即满足 AC 且不破坏前端。
- Successor Required: `no`

### 强制重截全部段（含已有截图）
- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 需求 batch 语义为仅补空段（幂等）；force 全量非本期。
- Successor Required: `no`

## Closure

Status Note: 待实施后回填。

Closure Audit Evidence:
- Reviewer / Agent: 待回填
- Evidence: 待回填
