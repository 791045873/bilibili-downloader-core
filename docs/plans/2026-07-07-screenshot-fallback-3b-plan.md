# Screenshot Source Fallback (3b) Plan

> Plan Status: planned
> Last Reviewed: 2026-07-07
> Source: `docs/requirements/2026-07-07-screenshot-source-fallback-3b.md`
> Related: `docs/plans/2026-07-07-screenshot-remote-3a-plan.md` (dependency), `docs/plans/2026-07-07-analysis-formal-api-plan.md` (AnalysisInput metadata)
> Audit: required
> Testing: `docs/testing/2026/07-07-screenshot-fallback-3b-testing.md`

## Current Baseline

- `packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts` supports local file paths only (3a will add HTTP URL + headers support)
- `packages/server/src/analysis/analysis-engine.ts` uses `input.videoPath` directly for both LLM analysis and screenshot via `this.screenshotter.takeScreenshots({ videoPath: input.videoPath, ... })`
- `AnalysisInput` currently has `videoPath` and `subtitlePath` -- no `metadata`, no `screenshotVideoPath` (formal API plan adds these)
- `BilibiliStreamProvider.getPlayStreams()` returns `PlayStreams` with `videoStreams` and `audioStreams`, each `MediaStreamInfo` has `url`, `codec`, `quality`, `format`
- `ResolutionService.selectBestStream()` selects stream by quality/codec; `resolveStreams()` returns all available streams
- `DatabaseService` has `getTasks()`, `getTaskById()`, `findTasksByBvidsAndCids()` -- can query tasks by bvid+cid
- `DownloadService.executeTask()` executes a download synchronously; `DownloadScheduler` manages concurrency
- `analysis.module.ts` only registers `AnalysisController`, no providers for DatabaseService or DownloadService
- No `ScreenshotSourceResolver` abstraction exists

## Goals

- New `ScreenshotSourceResolver` interface and implementation class in `packages/server/src/analysis/screenshot-source-resolver.ts`
- `AnalysisEngine` depends on `ScreenshotSourceResolver` interface, not directly on `DatabaseService` or `DownloadService`
- For `metadata.type=local`: returns local video path directly
- For `metadata.type=bilibili`: tries remote high-res stream URL -> database existing download (quality >= 80) -> sync re-download
- `AnalysisInput.screenshotVideoPath` present -> skip resolver entirely
- Remote screenshot failure -> remaining time points all use local fallback
- Screenshot failure for a segment does not interrupt overall analysis

## Non-Goals

- Do not change LLM analysis flow
- Do not change Python thin proxy
- Do not change document generation logic
- Do not implement async analysis task state machine (covered by 5b plan)
- No frontend polling or progress display
- No `metadata.type` platform extension

## Infrastructure And Config Prereqs

- B-station API access requires valid cookies (`COOKIE_FILE` env var or cookie string)
- `BilibiliStreamProvider` and `ResolutionService` must be initialized with web client and auth provider
- `DatabaseService` and `DownloadService` must be available via NestJS DI
- Sync re-download has 10-minute timeout
- 3a plan must be completed first (FfmpegScreenshot HTTP URL + headers support)

## Execution Plan

### Phase 1 - Define ScreenshotSourceResolver interface and implementation

Status: planned
Targets: `packages/server/src/analysis/screenshot-source-resolver.ts`

- Item Types: Add
- Prereqs: 3a completed

- [ ] Define `ScreenshotSourceResolver` interface: `resolve(params: { metadata, localVideoPath? }): Promise<{ source: string; sourceType: "remote" | "local"; headers?: Record<string, string> }>`
- [ ] Implement resolver class that depends on `BilibiliStreamProvider`, `ResolutionService`, `DatabaseService`, `DownloadService` (injected via constructor)
- [ ] Implement `metadata.type=local` path: return `{ source: localVideoPath, sourceType: "local" }`
- [ ] Implement `metadata.type=bilibili` Step 1: call `ResolutionService.resolveStreams()` + `selectBestStream()` to get highest quality remote stream URL; return `{ source: remoteUrl, sourceType: "remote", headers: { Referer: "https://www.bilibili.com" } }`
- [ ] Implement Step 2: query `DatabaseService` for existing task by bvid+cid with quality >= 80; return `{ source: localFilePath, sourceType: "local" }`
- [ ] Implement Step 3: call `DownloadService.executeTask()` synchronously (bypass scheduler); 10-minute timeout; return local path on success, throw on failure
- [ ] Decision: resolver is a concrete class implementing the interface, registered as NestJS provider. Alternatives: factory pattern (rejected -- over-engineering for single implementation). Residual risk: if multiple resolver strategies are needed in future, refactoring required.

Exit Criteria:

- [ ] `ScreenshotSourceResolver` interface and implementation exist
- [ ] All three fallback steps implemented for bilibili type
- [ ] Local type returns immediately
- [ ] `pnpm typecheck` passes

### Phase 2 - Integrate resolver into AnalysisEngine

Status: planned
Targets: `packages/server/src/analysis/analysis-engine.ts`, `packages/server/src/analysis/index.ts`

- Item Types: Add | Fix
- Prereqs: Phase 1, formal API plan (AnalysisInput with metadata)

- [ ] `AnalysisEngine` constructor accepts `ScreenshotSourceResolver` as a dependency
- [ ] In `analyze()`: if `input.screenshotVideoPath` present, use it directly for screenshots; otherwise call `resolver.resolve()` to get screenshot source
- [ ] Pass `headers` from resolver result to `screenshotter.takeScreenshots()` when `sourceType === "remote"`
- [ ] Implement remote-to-local fallback: once a remote screenshot fails, set a flag to use local source for all remaining time points
- [ ] Screenshot failure for a segment: skip screenshots for that segment, continue analysis (existing behavior preserved)
- [ ] Export resolver types from `index.ts`

Exit Criteria:

- [ ] `AnalysisEngine` uses resolver when `screenshotVideoPath` is absent
- [ ] `screenshotVideoPath` present skips resolver
- [ ] Remote failure triggers local fallback for remaining time points
- [ ] Segment screenshot failure does not interrupt analysis
- [ ] `pnpm typecheck` passes

### Phase 3 - Update controller and module wiring

Status: planned
Targets: `packages/server/src/analysis/analysis.controller.ts`, `packages/server/src/analysis/analysis.module.ts`

- Item Types: Add | Fix
- Prereqs: Phase 2

- [ ] `analysis.module.ts` imports `DatabaseModule` and `DownloadModule` to make `DatabaseService` and `DownloadService` injectable
- [ ] Register `ScreenshotSourceResolver` as a provider
- [ ] `AnalysisController` injects `ScreenshotSourceResolver` and `LlmConfig` (or reads env vars) to construct `AnalysisEngine` with resolver
- [ ] Formal API endpoint passes `metadata` with `bvid`/`cid` from request body to `AnalysisInput`

Exit Criteria:

- [ ] `AnalysisEngine` is constructed with resolver dependency via DI
- [ ] `metadata.bvid` and `metadata.cid` flow from request to resolver
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] DI wiring verified at runtime: start server, send `curl -X POST http://localhost:3000/api/analysis/run -H "Content-Type: application/json" -d '{"videoPath":"","subtitlePath":"","videoTitle":"test","metadata":{"type":"local"}}'`, confirm response is NOT HTTP 500 (400/422 acceptable — means DI wiring works, request validation rejecting empty videoPath)

### Phase 4 - Verification

Status: planned

- Item Types: Proof
- Prereqs: Phase 3

Environment prerequisites:
- Server running on `localhost:3000`
- `COOKIE_FILE` env var pointing to valid B-station cookie file (for bilibili type tests)
- Database contains at least one completed download task for a known bvid (for DB fallback test)
- Test video: `BV1SoTx6yEYc` (same as 3a plan)
- Python vision proxy running if LLM analysis is needed; for resolver-only tests, LLM is not needed

- [ ] Create/update `docs/testing/2026/07-07-screenshot-fallback-3b-testing.md` with requirement-level testing directions, including specific curl commands and expected outputs for each test case
- [ ] Run `pnpm typecheck` -- zero errors
- [ ] Run `pnpm build` -- zero errors
- [ ] Verify `metadata.type=local` path: `curl -X POST http://localhost:3000/api/analysis/run -H "Content-Type: application/json" -d '{"videoPath":"<local path>","subtitlePath":"<local srt>","videoTitle":"test","summaryDir":"./test-summary","metadata":{"type":"local"}}'` — confirm response includes `summaryPath` and screenshots are generated in `./test-summary/screenshots/`
- [ ] Verify `screenshotVideoPath` bypass: send request with `screenshotVideoPath` set to a different file than `videoPath`; confirm screenshots are taken from `screenshotVideoPath` (check file timestamps or logs)
- [ ] Verify bilibili remote path: send request with `metadata.type=bilibili`, `bvid`, `cid` for `BV1SoTx6yEYc`; confirm resolver attempts remote stream URL (check server logs for ffmpeg with HTTP URL input)
- [ ] Verify remote failure fallback: if remote screenshot fails, confirm remaining time points use local source (check server logs for fallback message)
- [ ] Verify DB fallback: if remote fails and DB has a completed task for the bvid with quality >= 80, confirm local file is used (check server logs)
- [ ] Verify re-download fallback: if remote fails and DB has no suitable task, confirm sync download is triggered (check server logs and `downloads/` directory for new file)

Exit Criteria:

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] All curl verification commands executed with expected responses
- [ ] Testing document covers: local type, bilibili remote path, bilibili DB fallback, bilibili re-download fallback, screenshotVideoPath bypass, remote failure fallback — each with curl command, environment prerequisite, and expected output

## Plan Audit

- Status: pending
- Reviewer / Agent: TBD (independent subagent or reviewer)
- Evidence: TBD

## Closure Gates

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] 3a plan (`2026-07-07-screenshot-remote-3a-plan.md`) is closed — FfmpegScreenshot supports HTTP URL + headers
- [ ] formal API plan (`2026-07-07-analysis-formal-api-plan.md`) is closed — AnalysisInput includes `metadata` and `screenshotVideoPath`
- [ ] `ScreenshotSourceResolver` interface and implementation exist and compile
- [ ] `AnalysisEngine` uses resolver when `screenshotVideoPath` is absent (code review)
- [ ] `screenshotVideoPath` present skips resolver (code review)
- [ ] remote failure triggers local fallback for remaining time points (code review)
- [ ] NestJS DI wiring verified: server starts without DI errors, `POST /api/analysis/run` responds (not 500) — verified by `curl -X POST http://localhost:3000/api/analysis/run` returning non-500 status
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred/follow-up without recorded rationale
- [ ] plan audit passed before implementation
- [ ] text consistency verified: status, phases, gates, testing document, and log all agree
- [ ] closure audit was independent (or cold-replay proxy documented)
- [ ] closure evidence exists in files

## Deferred But Adjudicated

### Async analysis task state machine

- Classification: out-of-scope improvement
- Why Not Blocking Closure: Async task tracking and progress is owned by `2026-07-07-ai-summary-trigger-5b-plan.md`. This plan resolver is synchronous.
- Successor Required: yes (5b plan)

### Frontend polling for screenshot progress

- Classification: out-of-scope improvement
- Why Not Blocking Closure: No frontend interaction in scope
- Successor Required: no

## Closure

Status Note: Plan not yet started. Closure requires ScreenshotSourceResolver abstraction, three-step bilibili fallback, AnalysisEngine integration, remote-to-local degradation, and DI wiring all verified.

Closure Audit Evidence:

- Reviewer / Agent: TBD
- Evidence: TBD

Follow-up:

- 5b plan will use `screenshotVideoPath` to bypass this resolver when high-res video is already available locally
