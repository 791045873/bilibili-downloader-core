# 2026-09-30 完整性检查重定义（内容/截图/视频三类，作业化执行体）

> Plan Status: done
> Last Reviewed: 2026-09-30
> Source: `docs/requirements/2026-09-17-integrity-check-rescope.md`
> Related: 上游 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（Q5 / 遗留问题 8）；前置 Phase 1b（内容入 DB、截图入 COS、停写本地）、Phase 2（`integrity_check` 作业化，handler 当前 gated）；Supersedes 旧 `docs/requirements/2026-09-07-summary-integrity-check.md`
> Audit: required（改 API 响应结构 + 跨前后端；非部署/auth/删除保护区；无 schema 变更；reviewer availability=none → 独立子代理或 cold-replay 代替并留证）
> Testing: `docs/testing/2026/09-30-integrity-check-rescope-testing.md`

## Current Baseline

- Phase 2 已将 `integrity_check` 作业化：`POST /api/summary-tasks/integrity-check` 入队 `integrity_check`（`analysis-task.controller.ts`），`GET /.../integrity-check/status` 读 DB 最新作业（`getLatestWorkerJobByKind`），进程内 `running` 互斥已移除。`AnalysisTriggerService.handleIntegrityCheckJob` 当前为 **gated no-op**（仅告警，不执行判据），等本需求补执行判据。
- `SummaryIntegrityService.run()`（`summary-integrity.service.ts`）现仍走旧判据：`listCompletedAiSummaryTasks` → 逐条 `checkRecord` 读**本地 md**（`resolveSummaryOutputPath` + `readFile`）并按 `listLocalImageRefs` 校验相对截图；`INTEGRITY_STATUS` 仅 `{complete, missing}`；`integrity_detail` 为自由文本（缺失相对路径换行拼接，`truncateDetail` 截断）。Phase 1b 已停写本地 md → 该判据会误报全缺失。
- 云侧读能力已具备：`getSummaryWithSegmentsByResource(bvid, cid)` 返回 summary 头 + 按 seq 升序 segments（含 `screenshotUrl`）。`updateAiSummaryTaskIntegrity([{id,status,detail,checkedAt}])` 写 `integrity_status/integrity_detail/integrity_checked_at`（不触碰 updated_at）。
- 视频定位：`findCompletedTaskByBvidAndCid(bvid,cid)` → `TaskRecord.outputFile`（相对 `DOWNLOAD_ROOT`），经 `resolveFromDownloadRoot` + 文件存在性判断（`DownloadService.fileExists` / node fs）。
- 契约：`ai_summary_task.integrity_status/integrity_detail/integrity_checked_at` 已存在（`contract.prisma`），本需求**不改 schema**，仅扩展取值与 detail 语义。
- 前端：`AiSummaryTasks.tsx` 展示 `integrityStatus`/`integrityCheckedAt`/`integrityDetail`（当前按自由文本），`api/index.ts` `getIntegrityCheckStatus(): {running:boolean}`，`types/index.ts` 有 `integrityCheckedAt` 等字段。

## Goals

- 判据从"只查本地 md"改为**云端为真源的三类校验**：内容（DB `summary`+`summary_segment` 完备）、截图（各 `screenshot_url` 非空）、视频（NAS 本地视频存在）。
- 结果分级 `complete/partial/missing`；`integrity_detail` 改为结构化 JSON 文本 `{contentMissing[],screenshotMissing[],videoMissing[]}`。
- 严重度：内容缺失 → `missing`；截图缺失 → `partial`；视频缺失 → 仅告警（记 `videoMissing[]`，不单独降级，除非同时内容缺失）。
- 打通 Phase 2 作业链：`integrity_check` handler 实际执行新判据（un-gate）；触发/status 已作业化，沿用。
- 前端适配结构化 detail 展示；owner docs 更新。

## Non-Goals

- 自动修复（截图 → `screenshot_retry`、视频 → 下载作业）；删除本地副本（Phase 4）。
- 新增列 / schema 变更；COS HEAD 可达性探测（默认凭 `screenshot_url` 非空判定；见 Open Question）。
- 触发/status 接口的作业化改造（Phase 2 已完成）。

## Execution Plan

### Phase 1 - 判据纯函数 + 服务重写 + 作业 handler 打通（后端）

Status: done
Targets: `packages/server/src/analysis/summary-integrity.service.ts`、`packages/server/src/analysis/analysis-trigger.service.ts`

- Item Types: `Add | Fix`
- Prereqs: 无
- [x] `Add`：纯函数 `judgeIntegrity(input)` —— 入参为已采集的结构化事实（`hasSummary:boolean`、`segmentCount:number`、`screenshotMissingSeqs:number[]`、`videoMissing:boolean`），产出 `{status, detail:{contentMissing:string[],screenshotMissing:number[],videoMissing:string[]}}`。
  - **内容缺失判定（契约）**：无 summary 头（`hasSummary=false`）→ `contentMissing` 含标记 `"summary"`；`segmentCount===0` → 含标记 `"segments"`。数据模型无"应有段数"权威值，故段部分丢失不可判，仅检测"无头/零段"两态。`contentMissing[]` 元素为上述固定标记字符串（前端据此分类展示）。
  - **截图**：`screenshotMissing` = 空 `screenshot_url` 的 `seq` 数组（number[]）。
  - **视频**：`videoMissing` = 缺失时含标记 `"video"`（string[]），否则空。
  - **分级**：`contentMissing` 非空 → `missing`；否则 `screenshotMissing` 非空 → `partial`；否则 `complete`；`videoMissing` 仅写入 detail、不改级（内容缺失时随 `missing`）。可导出供测试。
- [x] `Fix`：`SummaryIntegrityService.run()` 改为按记录采集三类事实（内容/截图经 `getSummaryWithSegmentsByResource`，视频经 `findCompletedTaskByBvidAndCid`+`resolveFromDownloadRoot`+**服务内既有 node-fs `fileExists`**（不新增 `DownloadService` 依赖）），调用 `judgeIntegrity`，`integrity_detail=JSON.stringify(detail)` 写回；**不读本地 md**。视频判定：`findCompletedTaskByBvidAndCid` 返回 `undefined`、`outputFile` 空、或解析后文件不存在 → `videoMissing`（仅告警）。移除 `checkRecord`/`readFile`/`truncateDetail` 及对 `resolveSummaryOutputPath`/`listLocalImageRefs` 的**依赖（import）**；**不删除** `summary-dir.ts` 中这两个函数（仍被 `renderSummaryMarkdown` 相关与既有测试使用）。`INTEGRITY_STATUS` 增 `partial`。
- [x] `Fix`：`AnalysisTriggerService.handleIntegrityCheckJob` un-gate —— 注入 `SummaryIntegrityService` 并调用 `run()`（幂等；作业成功即完成）。
- [x] `Proof`：`pnpm --filter @bilibili-downloader/server typecheck`、`build`。

Exit Criteria:
- [x] 三类判据以云 DB/COS url/NAS 视频为据；不读本地 md；`integrity_detail` 为结构化 JSON。
- [x] `integrity_check` 作业实际执行新判据（不再 gated no-op）。
- [x] `docs/logs/` 记录。

### Phase 2 - 前端结构化 detail 展示适配

Status: done
Targets: `packages/frontend/src/pages/AiSummaryTasks.tsx`（主要改动）；`api/index.ts`、`types/index.ts` **仅核对**（`getIntegrityCheckStatus` 返回类型与 `integrityDetail: string|null` 无需改，JSON 仍以文本承载）

- Item Types: `Fix`
- Prereqs: Phase 1
- [x] `Fix`：`integrityDetail` 解析为 `{contentMissing[],screenshotMissing[],videoMissing[]}` 并分类展示（内容/截图 seq/视频；视频作"告警"样式）；兼容旧自由文本值（解析失败回退原文）。`integrityStatus` 徽标增 `partial`。
- [x] `Proof`：`pnpm --filter @bilibili-downloader/frontend typecheck`、`build`。

Exit Criteria:
- [x] UI 呈现三类缺失；`partial` 有区分样式；旧值不崩。
- [x] `docs/logs/` 记录。

### Phase 3 - 测试与验证

Status: done
Targets: `packages/server/tests/database/summary-integrity.test.ts`（改写）

- Item Types: `Add | Proof`
- Prereqs: Phase 1
- [x] `Add`：`judgeIntegrity` 纯函数用例（内容缺失→missing；仅截图缺失→partial 且列 seq；仅视频缺失→complete + videoMissing 告警；全备→complete）。
- [x] `Add`：数据层用例——**整块重写** `describe("SummaryIntegrityService")`（旧 md/截图文件用例全部失效并删除；`listLocalImageRefs` 的独立 describe 若仍测纯函数可保留）。用 `db.upsertSummaryKnowledge({bvid,cid,videoTitle,rawResponse,segments:[{seq,title,content,screenshotUrl?}]})` 直接播种 `summary`+`summary_segment`（含/缺 `screenshot_url`），构造：完整 / 无 summary（内容缺失）/ 截图部分空 / 视频缺失 四类，断言 `integrity_status` 与结构化 `integrity_detail`。
- [x] `Note`：Phase 1 的 Proof 仅 typecheck/build，故 Phase 1→Phase 3 之间旧测试会红，属预期的分步顺序。
- [x] `Proof`：`pnpm --filter @bilibili-downloader/server test` 全绿（测试容器 `TEST_DATABASE_URL`）。

Exit Criteria:
- [x] 需求 AC 逐条被测试或人工核对覆盖；testing 每条方向确认或裁决。
- [x] `docs/logs/` 记录。

### Phase 4 - 文档与闭合

Status: done
Targets: `docs/design/app-overview.md`、`docs/architecture/system-baseline.md`、`docs/backlog/README.md`、`docs/logs/`

- Item Types: `Fix | Proof`
- Prereqs: Phase 1-3
- [x] `Fix`：owner docs——完整性检查语义（三类判据/分级/结构化 detail）、integrity_check 不再 gated；backlog 增行并标 done。
- [x] `Proof`：独立 closure audit（reviewer=none → 独立子代理或 cold-replay，留证）。

Exit Criteria:
- [x] owner docs / backlog / log 一致；testing 每条方向确认或裁决。
- [x] closure gates 全绿。

## Plan Audit

- Status: passed（with required fixes applied）
- Reviewer / Agent: 独立子代理（General，fresh-eyes cold-replay，reviewer availability=none）
- Evidence: 2026-09-30 独立 plan audit，Verdict=PASS-WITH-REQUIRED-FIXES，逐条对照 live code 无 file:line 误引、无循环依赖、无需 schema 变更、无删函数回归。已并入：blocker#1 明确 `contentMissing[]` 检测规则与元素标记（summary/segments）作为跨端契约；blocker#2 Phase 3 整块重写 `SummaryIntegrityService` 测试并指定 `upsertSummaryKnowledge` 播种、标注 P1→P3 间旧测试转红为预期；should-fix 视频判定用服务内 node-fs fileExists（不新增 DownloadService 依赖）+ undefined→videoMissing、明确不删 summary-dir 函数、Phase 2 前端 api/types 仅核对。严重度分级与需求一致（内容>截图>视频仅告警）。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs aligned（app-overview / system-baseline / backlog / log）
- [x] verification has run（server typecheck/build/test、frontend typecheck/build）
- [x] `docs/testing/` 文档存在且每条方向确认或裁决
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed（独立子代理或 cold-replay 留证）before implementation
- [x] micro-plan exception not applicable（改 API 响应结构 + 跨前后端）
- [x] text consistency verified：top status / phase status / exit criteria / closure gates / testing / log 一致
- [x] closure audit independent（或 cold-replay 代理留证）

## Deferred But Adjudicated

### COS 截图 HEAD 可达性探测
- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 需求 Open Question 明确"实现时定，不影响报告主结构"；默认凭 `screenshot_url` 非空判定即满足 AC。
- Successor Required: `no`（未来可选增强）

### 自动修复（截图/视频）
- Classification: `separate requirement`
- Why Not Blocking Closure: 属「重试截图」与下载作业需求；本需求仅检测并报告。
- Successor Required: `yes`（screenshot-retry 等）

## Closure

Status: done（2026-09-30）

Status Note: Phase 1-4 全部落地并验证。提交序列 c982bd7(plan+testing+audit) → bccbc43(P1+P3 后端判据+handler+测试) → 8d6ec4d(P2 前端) → 2eb5af7(P4 文档/日志) → 收尾（本次：陈旧注释修正 + 计划闭合）。验证：server `typecheck`/`build` 通过、`test` 全量 155 passed；frontend `typecheck`/`build` 通过。

Closure Audit Evidence:
- Reviewer / Agent: 独立子代理（General，fresh-eyes 冷回放，reviewer availability=none）
- Evidence: 2026-09-30 独立 closure audit，Verdict=PASS。逐条核对 Exit Criteria / Closure Gates / 需求 AC 均 CONFIRMED（file:line 对照 live code）；三命令验证由审计方实跑通过。无回归风险：合法记录不误报、视频缺失不降级、前端旧自由文本不崩、record.cid 类型正确、无悬挂 import。两处 LOW 观察已处理：(a) `database.service.ts` AiSummaryTaskRecord 的 integrity 注释更新为新语义；(b) 本 Closure 块回填。旁注（by-design）：Phase 1b 之前仅存本地 md 的历史 completed 记录，因云端为真源会呈 `missing`，符合需求 Business Rules。
