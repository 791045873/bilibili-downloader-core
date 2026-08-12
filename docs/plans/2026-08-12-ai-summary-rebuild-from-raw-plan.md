# 2026-08-12-ai-summary-rebuild-from-raw-plan AI 总结"重新构建总结"（基于已存储 LLM 返回重建报告与截图）

> Plan Status: completed
> Last Reviewed: 2026-08-12
> Source: `docs/requirements/2026-08-12-ai-summary-rebuild-from-raw.md`（2026-08-12 定稿，开放问题已经用户确认）
> Related: `docs/plans/2026-08-12-ai-summary-raw-record-and-retrigger-plan.md`（前置能力：raw_response 存储与查看）
> Audit: required
> Testing: `docs/testing/2026/08-12-ai-summary-rebuild-from-raw-testing.md`

## Current Baseline

- `ai_summary_task.raw_response`：completed = LLM content 原文（可解析 JSON `{summary:[...]}`）；failed = 错误文本。
- `AnalysisEngine.analyze()`（`packages/server/src/analysis/analysis-engine.ts`）在 LLM 之后执行：规范化 summary items → 按时间戳 `FfmpegScreenshot` 截图 → `generateMarkdown` 写报告。构造需 `llmConfig`（`getLlmConfig()` 缺 QWEN 配置抛错）。
- `AnalysisTriggerService`（`analysis-trigger.service.ts`）：`runAnalysis` 全管线（视频解析/字幕/LLM），`resolveSummaryDir(task)` 定位 summary 目录，`upsertAiSummaryTask` 未提供字段时保留既有值；`findLatestTaskByBvidAndCid` 与 `DownloadService.fileExists` 可用。注意 `AnalysisEngine` 的另一个消费方 `analysis.controller.ts:74`（`new AnalysisEngine(this.getLlmConfig(), ...)`），构造函数改可选对其向后兼容。
- 控制器（`analysis-task.controller.ts`）已有 `POST /summary-tasks/:id/retrigger`（全管线重跑，异步）。
- 前端 `AiSummaryTasks.vue` 弹窗已展示 rawResponse；`api/index.ts` 有 `retriggerAiSummaryTask`。
- 无单元测试设施；验证以 typecheck/build + API/DB 冒烟为准。

## Goals

- 弹窗为 completed 记录提供"重新构建总结"：用已存 `raw_response` 重建截图与 Markdown 报告，**不调用 LLM、不解析字幕、不调度低清**。
- 新增 `POST /api/summary-tasks/:id/rebuild`（异步，400/404/409/200），并发防抖，重建非破坏性（失败不改写 completed 记录）。
- AnalysisEngine 抽取 LLM 后处理共享逻辑；`rebuild` 路径不依赖 LLM 配置。

## Non-Goals

- 重新调用 LLM（属 `/retrigger`）；对非 completed 记录重建；字幕重解析；多版本历史；重建失败降级状态。

## Infrastructure And Config Prereqs

- 无新增环境变量/端口/外部服务。重建不需要 QWEN 配置（与现有管线解耦）。
- No infra prereqs beyond existing baseline。

## Execution Plan

### Phase 1 — AnalysisEngine 重构 + rebuild 方法

Status: completed
Targets: `packages/server/src/analysis/analysis-engine.ts`

- Item Types: Add | Fix
- Prereqs: 无

- [x] Add: 构造函数 `llmConfig?: LlmConfig` 改为可选，QwenClient 惰性创建（`ensureLlmClient()`，analyze 路径调用）；screenshotSourceResolver 不变
- [x] Add: 抽取 LLM 后共享处理为私有方法 `buildOutput(input, analysis, rawResponse, modelName, llmMs)`——规范化 items、空内容走空总结、截图循环、`generateMarkdown`（model 用传入 modelName）、写文件、返回 AnalysisOutput
- [x] Add: `rebuild(input, rawResponse, modelName)`——`JSON.parse(rawResponse)`（失败抛"存储的原始返回不是有效 JSON"）→ 调 `buildOutput(..., 0)`；不触达 LLM 客户端
- [x] Fix: `analyze()` 文档 model 改用实际 `llmResult.model`（修正此前用 llmConfig 默认值的偏差，与 rawResponse 记录一致）

Exit Criteria:

- [x] rebuild 路径在无 llmConfig 时可用；analyze 行为不变（typecheck 通过）
- [x] No owner-doc update required（文档统一在 Phase 4）
- [x] `docs/logs/` updated

### Phase 2 — AnalysisTriggerService.rebuildSummaryTask

Status: completed
Targets: `packages/server/src/analysis/analysis-trigger.service.ts`

- Item Types: Add | Decision
- Prereqs: Phase 1

- [x] Add: 内存防抖 `rebuildingIds: Set<number>`；`tryStartRebuild(id): boolean`（本次占用成功返回 true，已被占用返回 false）；`runRebuild(id)` 的 `finally` 中释放 id
- [x] Add: `runRebuild(id)`——执行期**重新校验**（completed + rawResponse 非空，防 claim 与执行间隙记录被改）；`findLatestTaskByBvidAndCid` 取任务，无任务 → 抛"无对应的下载任务，无法重新构建"；取 `outputFile` 并 `fileExists` 校验，缺失 → 抛"视频文件不存在，无法重新构建截图"；构造 AnalysisInput（`videoPath`=outputFile 作回退、`screenshotVideoPath`=outputFile、`summaryDir`=resolveSummaryDir(task)、`videoTitle`=任务标题、`metadata` 含 bvid/cid/videoUrl）→ `new AnalysisEngine(undefined, ...).rebuild(input, rawResponse, record.modelName ?? "")`（历史记录 modelName 可能为 null，空串兜底，避免生成 `model: undefined`） → 成功 upsert（completed/summaryOutput/executionTiming/时间戳，**不传 rawResponse/modelName 以保留**）；失败仅记日志、不改写状态
- [x] Decision: 并发防抖机制——认领由控制器**同步**调 `tryStartRebuild`（失败即 409，满足 AC1 同步语义），执行用 `void runRebuild(id)`（不再重复认领，`finally` 统一释放）。备选"认领放入 runRebuild 内部"（第二次请求的 ConflictException 被 controller 的 `.catch(记日志)` 吞掉 → 客户端拿到 200 而非 409，违反 AC1，否决）；残余风险：重建进行中用户触发 `/retrigger` 会经 `claimAiSummaryTask` 清空 raw/model 并置 pending，与进行中重建形成 last-writer-wins 竞态——判定为可接受（用户主动操作，结果以最后写入为准），记录不阻塞
- [x] Decision: 重建失败非破坏性（不改写 completed 记录）。理由：该记录是既有有效产物，重建是恢复性操作，失败降级会破坏可用数据；备选"失败置 failed"（破坏性，否决）、"失败写 errorMessage 供前端展示"（异步流程下无展示载体，列为后续优化，否决）；残余风险：用户在异步流程下看不到失败原因（仅服务端日志），由 testing 方向 3 记录

Exit Criteria:

- [x] rebuildSummaryTask 校验/成功写回/失败非破坏行为落地（typecheck 通过）
- [x] No owner-doc update required（文档统一在 Phase 4）
- [x] `docs/logs/` updated

### Phase 3 — 新端点

Status: completed
Targets: `packages/server/src/analysis/analysis-task.controller.ts`

- Item Types: Add
- Prereqs: Phase 2

- [x] Add: `POST /api/summary-tasks/:id/rebuild`（`@HttpCode(200)`）——**同步校验**：非法 id → 400；记录不存在 → 404；状态非 `completed` → 409；rawResponse 为空 → 409（数据源 `databaseService.getAiSummaryTaskById` 完整记录，service 视图已剥离 rawResponse 不可用）；`!tryStartRebuild(id)` → 409 `正在重新构建中`——随后 `void runRebuild(id).catch(记日志)` → `{message:"重新构建已开始"}`

Exit Criteria:

- [x] 端点各分支与返回码落地（typecheck 通过）
- [x] No owner-doc update required（文档统一在 Phase 4）
- [x] `docs/logs/` updated

### Phase 4 — 前端弹窗按钮

Status: completed
Targets: `packages/frontend/src/api/index.ts`、`packages/frontend/src/views/AiSummaryTasks.vue`

- Item Types: Add
- Prereqs: Phase 3

- [x] Add: `rebuildAiSummaryTask(id): Promise<{ message: string }>` → `POST /summary-tasks/:id/rebuild`
- [x] Add: 弹窗记录 `rawDialogTask`；仅 `status === "completed"` 显示"重新构建总结"按钮；点击调 rebuildAiSummaryTask，成功提示"已开始重新构建总结，请刷新任务状态后查看"并 `loadTasks()`，失败在弹窗内展示错误；`rebuilding` 加载态防重复点击

Exit Criteria:

- [x] 弹窗按钮条件与交互落地；typecheck 通过
- [x] No owner-doc update required（文档统一在 Phase 4）
- [x] `docs/logs/` updated

### Phase 5 — 验证与文档

Status: completed
Targets: 根验证命令、`docs/design/app-overview.md`、`docs/context/codebase-map.md`、testing 文档、`docs/logs/`

- Item Types: Proof | Add
- Prereqs: Phase 1-4

- [x] Proof: `pnpm typecheck`（根）、`pnpm build`（根）真实执行通过
- [x] Proof: API/DB 冒烟（临时 OUTPUT_DIR 一次性脚本）：rebuild 端点各分支 400/404/409/200；无 QWEN 配置下重建不报"缺少 LLM 配置"；重建成功写回 summary_output 且保留 raw_response/model_name；outputFile 缺失失败且状态不变
- [x] Add: `docs/design/app-overview.md` 补充 rebuild 端点与 raw_response 重建语义；`docs/context/codebase-map.md` 视频分析行验证日期更新
- [x] Proof: testing 文档方向逐条确认 passed / out of scope 裁决
- [x] Proof: 独立 closure audit（证据存 `docs/audits/` 并链接）

Exit Criteria:

- [x] 全部文档与实现一致；testing 方向确认
- [x] 验证命令真实执行通过
- [x] `docs/logs/` 完成记录

## Plan Audit

- Status: passed（首轮 needs revision 已修订，复审通过）
- Reviewer / Agent: 独立 subagent（首轮 task `ses_0099a90a0ffe4X0WNtrnqDAy9g`，复审 task `ses_00996e17cffe5fpWlWkol7WZ3e`）
- Evidence: `docs/audits/2026-08-12-plan-audit-ai-summary-rebuild.md`

首轮阻断问题：并发防抖 409 机制矛盾（认领若在 `rebuildSummaryTask` 内部，第二次请求的 ConflictException 被 controller `.catch(记日志)` 吞掉 → 客户端拿 200 而非 409）与 Item Type 违规（Refactor 不存在于 plan guide）。修订：控制器**同步**校验状态/rawResponse/认领（`tryStartRebuild`，失败即 409），执行用 `void runRebuild(id)` 不再重复认领、`finally` 释放；rawResponse 数据源明确为 `databaseService.getAiSummaryTaskById` 完整记录；Item Types 改为 Add | Fix。复审 passed，非阻断建议（tryStartRebuild 措辞、AnalysisInput 完整字段）已吸收。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck`、`pnpm build`）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed or micro-plan exception documented before implementation
- [x] micro-plan actual diff stayed within exception limits, or plan was reclassified and audited（本计划为 full plan，不适用 micro-plan 例外）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent (or cold-replay proxy documented)
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 重建失败错误信息的前端展示

- Classification: `optimization candidate`
- Why Not Blocking Closure: 异步 + 非破坏性语义下，失败仅记录服务端日志；用户重试或走"重新总结"即可
- Successor Required: `no`（重开事件：用户反馈无法感知重建失败原因）

### 重建进度可见性（状态列"重建中"）

- Classification: `optimization candidate`
- Why Not Blocking Closure: 保持 completed 状态稳定（避免 reconcile 误判失败）；用户异步刷新即可
- Successor Required: `no`（重开事件：需要区分"重建中/完成"时引入独立 transient 状态并配套对账）

## Closure

Status Note: 实施与验证全部完成，关闭审计通过（approved）。AC1-7 全部满足，`pnpm typecheck`/`pnpm build` 真实执行通过，API/DB 冒烟 15/15 PASS。

Closure Audit Evidence:

- Reviewer / Agent: 独立 subagent（task `ses_0098f3abaffeBTfrZ0O7yW0aX3`）
- Evidence: `docs/audits/2026-08-12-closure-audit-ai-summary-rebuild.md`、`docs/logs/2026-08-12-ai-summary-rebuild-from-raw.md`

Follow-up:

- 无阻断性后续项。残余观察：真实 ffmpeg 截图与前端弹窗交互属人工运行级验证；重建失败原因不向前端展示（异步 + 非破坏性），重试或走"重新总结"即可。
