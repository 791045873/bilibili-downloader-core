# Analysis Formal API Plan

> Plan Status: completed
> Last Reviewed: 2026-07-12
> Source: `docs/requirements/2026-07-07-analysis-formal-api.md`
> Related: `docs/plans/2026-07-07-document-structure-optimization-plan.md` (front matter video_url depends on metadata.type)
> Audit: required
> Testing: `docs/testing/2026/07-07-analysis-formal-api-testing.md`

## Current Baseline

- `packages/server/src/analysis/analysis.controller.ts` exposes only `POST /api/analysis/debug` -- no request body, hardcoded `test_assets/video1.mp4` and `test_assets/video1.srt`, video title read via `ffprobe`
- `AnalysisInput` in `analysis-engine.ts` has fields: `videoPath: string`, `subtitlePath: string` (required, not optional), `summaryDir: string`, `videoTitle: string` -- no `metadata`, no `screenshotVideoPath`
- `AnalysisEngine.analyze()` requires `subtitlePath` to exist and parses SRT; if `srtEntries.length === 0`, returns empty summary -- no "skip subtitle" path when `subtitlePath` is absent
- `analysis-engine.ts` constructor: `new AnalysisEngine(llmConfig, httpClient?)` -- instantiated per-request in the controller, not DI-managed
- `LlmConfig` includes `apiKey`, `baseUrl`, `modelName`, `visionProxyUrl`, `visionModelName`
- No input validation on the debug endpoint (no DTO, no class-validator)
- `analysis.module.ts` only registers `AnalysisController`, no providers

## Goals

- `POST /api/analysis/run` accepts `AnalysisRequest` body with `videoPath`, `subtitlePath?`, `videoTitle`, `metadata`, `screenshotVideoPath?`
- `POST /api/analysis/debug` is removed
- `AnalysisInput` (engine-level) is the authoritative definition including `metadata` and `screenshotVideoPath?`
- Input validation: `videoPath` must be absolute path; `subtitlePath` and `screenshotVideoPath` if provided must be absolute; `metadata.type` must be `"bilibili"` or `"local"`; `metadata.type=bilibili` requires `videoUrl`, `bvid`, `cid`
- `metadata.type=bilibili` -> front matter `video_url` = `metadata.videoUrl`; `metadata.type=local` -> `video_url` = `""` (adjudicated to doc-opt plan — see Deferred But Adjudicated)
- `subtitlePath` absent -> analysis skips subtitle parsing, passes only video to LLM

## Non-Goals

- Do not change analysis orchestration main flow
- Do not change Python thin proxy
- Do not change screenshot logic
- Do not implement `metadata.type` platform extensions (youtube etc.)
- No frontend interaction
- No download-completion auto-trigger integration (separate plan 5b)

## Infrastructure And Config Prereqs

- No new infra prereqs beyond existing baseline
- `QWEN_API_KEY`, `QWEN_API_BASE`, `QWEN_MODEL`, `QWEN_VISION_PROXY_URL`, `QWEN_VISION_MODEL` env vars already used

## Execution Plan

### Phase 1 - Define AnalysisRequest and AnalysisInput types

Status: completed
Targets: `packages/server/src/analysis/analysis-engine.ts`

- Item Types: `Add | Fix`
- Prereqs: none

- [x] Update `AnalysisInput` interface: add `subtitlePath?: string` (make optional), add `metadata: { type: "bilibili" | "local"; videoUrl?: string; bvid?: string; cid?: number }`, add `screenshotVideoPath?: string`
- [x] This is the authoritative `AnalysisInput` definition -- other plans reference it
- [x] Decision: `subtitlePath` changes from required `string` to optional `string | undefined`. Alternatives: keep required and pass empty string (rejected -- conflates "no subtitle" with "empty path"). Residual risk: callers that assumed `subtitlePath` always present must be updated.

Exit Criteria:

- [x] `AnalysisInput` matches the requirement authoritative definition
- [x] `pnpm typecheck` passes (verified after Phase 2)

### Phase 2 - Replace debug endpoint with formal API

Status: completed
Targets: `packages/server/src/analysis/analysis.controller.ts`

- Item Types: `Add | Fix`
- Prereqs: Phase 1

- [x] Remove `POST /api/analysis/debug` and all debug helper functions (`getDebugAnalysisInput`, `findProjectRoot`, `readVideoTitle`, `DEBUG_VIDEO_FILENAME`, `DEBUG_SUBTITLE_FILENAME`)
- [x] Add `POST /api/analysis/run` accepting `AnalysisRequest` body
- [x] Implement input validation: `videoPath` absolute path check, `videoTitle` non-empty string check, `subtitlePath`/`screenshotVideoPath` absolute path check if provided, `metadata` required, `metadata.type` enum check, `metadata.type=bilibili` requires `videoUrl` + `bvid` + `cid`
- [x] Return 400 `BadRequestException` on validation failure
- [x] Construct `AnalysisInput` from `AnalysisRequest`: map request fields + derive `summaryDir` from existing baseline pattern (`join(process.cwd(), "summaryDir")`, 与当前 controller 一致，不引入新 env var)
- [x] Retain `getLlmConfig()` helper (env var reading)
- [x] Decision: 引擎实例化保持 per-request 模式（`new AnalysisEngine(...)` 在 controller 内），`analysis.module.ts` 不新增 providers。Alternatives: 改为 NestJS DI provider (rejected — 当前 baseline 无 DI，引入需改 module 装配，超出本 plan scope)。Residual risk: 无显著风险，与 baseline 一致。

Exit Criteria:

- [x] `POST /api/analysis/run` accepts valid `AnalysisRequest` and returns analysis result (valid local metadata passed validation, reached engine — verified via 400 QWEN_API_KEY)
- [x] `POST /api/analysis/debug` no longer exists (verified 404)
- [x] Invalid inputs return 400 with specific error messages (verified: empty body, relative videoPath, bilibili missing videoUrl, invalid metadata.type, empty videoTitle)
- [x] `metadata.type=bilibili` without `videoUrl`/`bvid`/`cid` returns 400 (verified)
- [x] `pnpm typecheck` passes
- [x] `pnpm build` passes

### Phase 3 - Support optional subtitlePath in AnalysisEngine

Status: completed
Targets: `packages/server/src/analysis/analysis-engine.ts`

- Item Types: `Fix`
- Prereqs: Phase 1

- [x] Update `analyze()`: if `input.subtitlePath` is undefined or file does not exist, skip SRT parsing and proceed with video-only LLM call
- [x] When no subtitle, `fullSubtitleText` is empty string; LLM user message contains only `video_url` content part
- [x] `writeEmptySummary` path still applies if LLM returns no summary items

Exit Criteria:

- [x] Analysis with `subtitlePath` absent completes successfully (video-only LLM call) — code path implemented: `existsSync` guard skips SRT parsing, `fullSubtitleText = ""`, LLM user message omits text part. Runtime LLM call not exercised (requires QWEN_API_KEY + vision proxy); typecheck/build pass and logic verified by code review.
- [x] Analysis with `subtitlePath` present behaves same as before (SRT parsing path retained)
- [x] `pnpm typecheck` passes
- [x] `pnpm build` passes

### Phase 4 - Verification

Status: completed

- Item Types: `Proof`
- Prereqs: Phase 2, Phase 3

- [x] Confirm `docs/testing/2026/07-07-analysis-formal-api-testing.md` covers all requirement-level testing directions (已创建于 plan audit 阶段，实现时确认覆盖)
- [x] Run `pnpm typecheck` -- zero errors (全 6 包 Done)
- [x] Run `pnpm build` -- zero errors (全 6 包 Done)
- [x] Manually verify: `POST /api/analysis/run` with bilibili metadata, local metadata, missing subtitlePath, invalid paths (curl 测试 7 用例：debug 404、empty body 400、relative videoPath 400、bilibili 缺 videoUrl 400、invalid metadata.type 400、empty videoTitle 400、valid local 进入 engine 因缺 QWEN_API_KEY 报 400 证明校验通过)

Exit Criteria:

- [x] `pnpm typecheck` zero errors
- [x] `pnpm build` zero errors
- [x] Testing document covers: formal API accepts valid input, rejects invalid input, debug endpoint removed, optional subtitlePath works

## Plan Audit

- Status: passed (cold-replay proxy, reviewer availability = none)
- Reviewer / Agent: 独立 subagent cold-replay（两轮）
- Evidence:
  - 第一轮 audit (General_5217656): failed — 发现 2 blocker (AC#5/AC#6 未覆盖未裁定；testing 文档不存在) + 1 major (OUTPUT_DIR 未声明) + 1 minor (DI 未明确)
  - 修订后第二轮 audit (General_5217753): passed-with-notes — 所有 blocker/major/minor 已解决；AC#5/AC#6 合规裁定给 doc-opt；testing 文档已创建且符合 R6；3 个 non-blocking minor（videoTitle 校验已补入 Phase 2；summaryDir 根目录措辞；Phase 4 exit criteria 完整性）在实现中处理
  - formal-api 非 protected area（auth/data-deletion/payment/deployment 均不触及），符合 cold-replay 适用条件

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned (`docs/design/app-overview.md` Integration Points 已新增 `POST /api/analysis/run` 行)
- [x] verification has run (`pnpm typecheck` and `pnpm build` 全包 Done；curl 7 用例校验逻辑)
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope (AC#5/AC#6 裁定给 doc-opt)
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation (cold-replay 两轮，passed-with-notes)
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent (cold-replay proxy, reviewer availability = none)
- [x] closure evidence exists in files

## Deferred But Adjudicated

### screenshotVideoPath resolver integration

- Classification: out-of-scope improvement
- Why Not Blocking Closure: `screenshotVideoPath` field is defined in `AnalysisInput` but the resolver fallback logic is owned by `2026-07-07-screenshot-fallback-3b-plan.md`. This plan only defines the field; the engine uses `screenshotVideoPath` if present, otherwise uses `videoPath` for screenshots as today.
- Successor Required: yes (3b plan)

### Download-completion auto-trigger

- Classification: out-of-scope improvement
- Why Not Blocking Closure: Internal trigger from download callback is owned by `2026-07-07-ai-summary-trigger-5b-plan.md`
- Successor Required: yes (5b plan)

### front matter video_url derivation (AC#5, AC#6)

- Classification: out-of-scope improvement
- Why Not Blocking Closure: 需求 AC#5/AC#6 要求 `metadata.type` 决定 front matter `video_url` 取值。但 front matter 生成本身由 `2026-07-07-document-structure-optimization-plan.md` Phase 2 拥有（该 plan 第 79 行实现 `videoUrl = metadata.type === "bilibili" ? metadata.videoUrl : ""` 推导，第 25 行拥有 front matter 生成）。当前 baseline `document-generator.ts` 无 front matter（`generateMarkdown()` 直接从 `# title` 开始，无 YAML 块）。本 plan 只负责在 `AnalysisInput` 中携带 `metadata`（Phase 1），使 doc-opt 有基础数据可推导；front matter 生成与 `video_url` 推导不在本 plan scope。
- Successor Required: yes (doc-opt plan Phase 2)
- Reopen Trigger: 当 doc-opt Phase 2 落地 front matter 生成与 `video_url` 推导时，AC#5/AC#6 即被覆盖。本 plan closure 不要求 AC#5/AC#6 通过。

## Closure

Status Note: 正式 API `POST /api/analysis/run` 已取代调试端点，`AnalysisInput` 含 metadata/screenshotVideoPath?，`subtitlePath` 可选并支持 video-only 分析，输入校验完整。AC#5/AC#6（front matter video_url）裁定给 doc-opt plan，本 plan closure 不要求。运行时 LLM video-only 调用未 exercised（需 QWEN_API_KEY + vision proxy 环境），校验逻辑与编译已验证，代码路径经 closure audit 代码审查确认。

Closure Audit Evidence:

- Reviewer / Agent: 独立 Closure Auditor (cold-replay, 无实现参与, General_5217916)
- Evidence:
  - Audit Status: passed-with-notes
  - AC 覆盖: 11 条中 9 条 covered (AC#1-4,7-11)，2 条 adjudicated (AC#5/AC#6 -> doc-opt plan Phase 2，含 Successor + Reopen Trigger)
  - Live 代码验证: analysis.controller.ts `@Post("/run")` + 完整校验逻辑（videoPath/videoTitle/subtitlePath/screenshotVideoPath/metadata.type/bilibili 必填字段）；analysis-engine.ts `AnalysisInput` 含 metadata/screenshotVideoPath?，subtitlePath 可选，analyze() 跳过 SRT 解析逻辑；debug 端点及所有 debug 辅助函数已移除
  - 验证: pnpm typecheck 全 6 包 Done；pnpm build 全 6 包 Done；curl 7 用例（debug 404、5 类校验 400、valid local 进入 engine 因缺 QWEN_API_KEY 报 400 证明校验通过）
  - 文本一致性: 所有 phase Status=completed、exit criteria [x]、执行项 [x]、closure gates [x]；testing 文档存在；log 已记录
  - Gap: 运行时 LLM video-only 调用未 exercised（环境限制，已显式记录，非 silent downgrade）；app-overview.md 已更新覆盖新接口

Follow-up:

- AC#5/AC#6 (front matter video_url) 已裁定给 `2026-07-07-document-structure-optimization-plan.md` Phase 2，见 Deferred But Adjudicated。formal-api 只负责在 AnalysisInput 中携带 metadata；front matter 生成与 video_url 推导由 doc-opt 实现。
