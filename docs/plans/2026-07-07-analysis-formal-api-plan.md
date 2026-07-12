# Analysis Formal API Plan

> Plan Status: planned
> Last Reviewed: 2026-07-07
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
- `metadata.type=bilibili` -> front matter `video_url` = `metadata.videoUrl`; `metadata.type=local` -> `video_url` = `""`
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

Status: planned
Targets: `packages/server/src/analysis/analysis-engine.ts`

- Item Types: `Add | Fix`
- Prereqs: none

- [ ] Update `AnalysisInput` interface: add `subtitlePath?: string` (make optional), add `metadata: { type: "bilibili" | "local"; videoUrl?: string; bvid?: string; cid?: number }`, add `screenshotVideoPath?: string`
- [ ] This is the authoritative `AnalysisInput` definition -- other plans reference it
- [ ] Decision: `subtitlePath` changes from required `string` to optional `string | undefined`. Alternatives: keep required and pass empty string (rejected -- conflates "no subtitle" with "empty path"). Residual risk: callers that assumed `subtitlePath` always present must be updated.

Exit Criteria:

- [ ] `AnalysisInput` matches the requirement authoritative definition
- [ ] `pnpm typecheck` passes (will fail until Phase 2 updates controller)

### Phase 2 - Replace debug endpoint with formal API

Status: planned
Targets: `packages/server/src/analysis/analysis.controller.ts`

- Item Types: `Add | Fix`
- Prereqs: Phase 1

- [ ] Remove `POST /api/analysis/debug` and all debug helper functions (`getDebugAnalysisInput`, `findProjectRoot`, `readVideoTitle`, `DEBUG_VIDEO_FILENAME`, `DEBUG_SUBTITLE_FILENAME`)
- [ ] Add `POST /api/analysis/run` accepting `AnalysisRequest` body
- [ ] Implement input validation: `videoPath` absolute path check, `subtitlePath`/`screenshotVideoPath` absolute path check if provided, `metadata` required, `metadata.type` enum check, `metadata.type=bilibili` requires `videoUrl` + `bvid` + `cid`
- [ ] Return 400 `BadRequestException` on validation failure
- [ ] Construct `AnalysisInput` from `AnalysisRequest`: map request fields + derive `summaryDir` from `OUTPUT_DIR` or `process.cwd()` + `summaryDir`
- [ ] Retain `getLlmConfig()` helper (env var reading)

Exit Criteria:

- [ ] `POST /api/analysis/run` accepts valid `AnalysisRequest` and returns analysis result
- [ ] `POST /api/analysis/debug` no longer exists
- [ ] Invalid inputs return 400 with specific error messages
- [ ] `metadata.type=bilibili` without `videoUrl`/`bvid`/`cid` returns 400
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

### Phase 3 - Support optional subtitlePath in AnalysisEngine

Status: planned
Targets: `packages/server/src/analysis/analysis-engine.ts`

- Item Types: `Fix`
- Prereqs: Phase 1

- [ ] Update `analyze()`: if `input.subtitlePath` is undefined or file does not exist, skip SRT parsing and proceed with video-only LLM call
- [ ] When no subtitle, `fullSubtitleText` is empty string; LLM user message contains only `video_url` content part
- [ ] `writeEmptySummary` path still applies if LLM returns no summary items

Exit Criteria:

- [ ] Analysis with `subtitlePath` absent completes successfully (video-only LLM call)
- [ ] Analysis with `subtitlePath` present behaves same as before
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

### Phase 4 - Verification

Status: planned

- Item Types: `Proof`
- Prereqs: Phase 2, Phase 3

- [ ] Create/update `docs/testing/2026/07-07-analysis-formal-api-testing.md` with requirement-level testing directions
- [ ] Run `pnpm typecheck` -- zero errors
- [ ] Run `pnpm build` -- zero errors
- [ ] Manually verify: `POST /api/analysis/run` with bilibili metadata, local metadata, missing subtitlePath, invalid paths

Exit Criteria:

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] Testing document covers: formal API accepts valid input, rejects invalid input, debug endpoint removed, optional subtitlePath works

## Plan Audit

- Status: pending
- Reviewer / Agent: TBD (independent subagent or reviewer)
- Evidence: TBD

## Closure Gates

- [ ] in-scope behavior is complete
- [ ] relevant docs are aligned
- [ ] verification has run (`pnpm typecheck` and `pnpm build`)
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred/follow-up
- [ ] plan audit passed before implementation
- [ ] text consistency verified: status, phases, gates, testing document, and log all agree
- [ ] closure audit was independent (or cold-replay proxy documented)
- [ ] closure evidence exists in files

## Deferred But Adjudicated

### screenshotVideoPath resolver integration

- Classification: out-of-scope improvement
- Why Not Blocking Closure: `screenshotVideoPath` field is defined in `AnalysisInput` but the resolver fallback logic is owned by `2026-07-07-screenshot-fallback-3b-plan.md`. This plan only defines the field; the engine uses `screenshotVideoPath` if present, otherwise uses `videoPath` for screenshots as today.
- Successor Required: yes (3b plan)

### Download-completion auto-trigger

- Classification: out-of-scope improvement
- Why Not Blocking Closure: Internal trigger from download callback is owned by `2026-07-07-ai-summary-trigger-5b-plan.md`
- Successor Required: yes (5b plan)

## Closure

Status Note: Plan not yet started. Closure requires formal API endpoint replacing debug endpoint, authoritative AnalysisInput with metadata, input validation, and optional subtitlePath support all verified.

Closure Audit Evidence:

- Reviewer / Agent: TBD
- Evidence: TBD

Follow-up:

- Coordinate with document-structure-optimization plan to ensure `metadata.type` -> `video_url` derivation is consistent
