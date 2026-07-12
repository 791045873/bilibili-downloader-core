# Screenshot Source Fallback (3b) Plan

> Plan Status: planned
> Last Reviewed: 2026-07-12
> Source: `docs/requirements/2026-07-07-screenshot-source-fallback-3b.md`
> Related: `docs/plans/2026-07-07-screenshot-remote-3a-plan.md` (dependency), `docs/plans/2026-07-07-analysis-formal-api-plan.md` (AnalysisInput metadata)
> Audit: required
> Testing: `docs/testing/2026/07-07-screenshot-fallback-3b-testing.md`

## Current Baseline

- `packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts` supports local file paths only: `ScreenshotParams` has `videoPath: string` with no `headers` field (live: lines 9-18); `screenshotFrame()` ffmpeg args do not include `-headers` (live: lines 85-92); `probeVideoDuration()` ffprobe args do not include headers (live: lines 119-124). 3a plan (HTTP URL + headers support) is `planned` but NOT yet implemented.
- `packages/server/src/analysis/analysis-engine.ts` uses `input.videoPath` directly for both LLM analysis (live: line 123 `{ type: "video_url", video_url: { url: input.videoPath } }`) and screenshots (live: lines 165-170 `this.screenshotter.takeScreenshots({ videoPath: input.videoPath, ... })`). No resolver abstraction is wired in.
- `AnalysisInput` (live: lines 32-54) ALREADY includes `metadata` (lines 42-51: `type`, `videoUrl?`, `bvid?`, `cid?`) and `screenshotVideoPath?` (line 53) -- formal-api plan is `completed` and these fields exist. `subtitlePath` is optional (line 36). The `AnalysisEngine` constructor (live: lines 93-96) is `constructor(llmConfig: LlmConfig, httpClient?: typeof fetch)` -- instantiated per-request in the controller, not DI-managed.
- `packages/server/src/analysis/analysis.controller.ts` (live: lines 26-39) constructs `new AnalysisEngine(this.getLlmConfig())` per-request. `AnalysisController` has no injected dependencies beyond the NestJS framework. `analysis.module.ts` (live: lines 4-7) only registers `AnalysisController`, no providers.
- `BilibiliStreamProvider.getPlayStreams()` (live: stream-provider.ts line 150) returns `PlayStreams` with `videoStreams` and `audioStreams`; each `MediaStreamInfo` has `url`, `codec`, `quality`, `format` (live: stream-provider.ts lines 306-321 `dashToMediaStream`).
- `ResolutionService` (live: ResolutionService.ts lines 15-20) is instantiated as a PRIVATE member of `DownloadService` (live: download.service.ts lines 62, 107-111). It is NOT a NestJS provider and NOT injectable. `selectBestStream(streams, codecPreference?, qualityPreference?)` (live: lines 83-111) returns highest-quality stream when called with no preferences. `resolveStreams(params)` (live: line 66) returns all available `PlayStreams`.
- `BilibiliStreamProvider` (live: stream-provider.ts line 48) is also a PRIVATE member of `DownloadService` (live: download.service.ts line 59, 105). NOT injectable via NestJS DI.
- `DatabaseService` (live: database.service.ts) has `getTasks()` (line 183, returns `TaskRecord[]`), `getTaskById()` (line 190), `findTasksByBvidsAndCids()` (line 221). CRITICAL GAP: `findTasksByBvidsAndCids()` returns only `Pick<TaskRecord, "bvid" | "cid" | "status" | "createdAt">[]` (live: line 223) -- it does NOT return `quality` or `outputFile`, which the resolver needs for Step 2 fallback. A new query method or extended query is required.
- `DatabaseModule` is `@Global()` (live: database.module.ts line 4) and exports `DatabaseService` (line 7) -- globally available without importing the module.
- `DownloadService` (live: download.service.ts) is registered in `DownloadModule` (live: download.module.ts line 10) but `DownloadModule` has NO `exports` field -- `DownloadService` is NOT injectable outside `DownloadModule` without adding an export.
- `DownloadService.executeTask(task: TaskRecord)` (live: download.service.ts line 210) executes a download synchronously. PREREQUISITE GAP: it requires the task to already exist in `taskCache` (live: lines 212-215 throw if not cached) and be in `Created` or `Stopped` status (live: lines 218-223). This means `createTask()` (live: line 185) must be called first to insert the task into DB and cache before `executeTask()` can run. `DownloadScheduler` manages concurrency for normal downloads (live: download.module.ts line 10).
- `DownloadService` holds `ResolutionService`, `BilibiliStreamProvider`, `resourceParser`, `authProvider`, `fileStore`, `merger` as private members (live: download.service.ts lines 56-65) -- none are exposed via getters or methods. The resolver needs access to stream resolution capability; either `DownloadService` must expose it or `ResolutionService` must become a shared provider.
- No `ScreenshotSourceResolver` abstraction exists (live: `packages/server/src/analysis/` contains only `analysis-engine.ts`, `analysis.controller.ts`, `analysis.module.ts`, `document-generator.ts`, `index.ts`). No `ScreenshotSourceResolverPort` in `packages/core/src/ports/`.

## Goals

- New `ScreenshotSourceResolver` interface and implementation class in `packages/server/src/analysis/screenshot-source-resolver.ts`
- `AnalysisEngine` depends on `ScreenshotSourceResolver` interface, not directly on `DatabaseService` or `DownloadService`
- For `metadata.type=local`: returns local video path directly
- For `metadata.type=bilibili`: tries remote high-res stream URL -> database existing download (quality >= 80) -> sync re-download
- `AnalysisInput.screenshotVideoPath` present -> skip resolver entirely
- Remote screenshot failure -> remaining time points all use local fallback
- Screenshot failure for a segment does not interrupt overall analysis
- Resolver must obtain stream resolution capability: either `DownloadService` exposes a method (e.g., `resolveStreamsForBvid(bvid, cid)`) or `ResolutionService` is promoted to a shared NestJS provider. The resolver must NOT depend on `BilibiliStreamProvider` / `ResolutionService` via direct constructor injection because neither is a NestJS provider today.
- `DatabaseService` must gain a query method that returns `quality` and `outputFile` for tasks matching bvid+cid with `status=success`, because `findTasksByBvidsAndCids()` (live: database.service.ts line 223) returns only `{bvid, cid, status, createdAt}`.
- `DownloadService.executeTask()` (live: download.service.ts line 210) requires `createTask()` first; the resolver's Step 3 must call `createTask()` then `executeTask()` in sequence.
- `DownloadModule` must export `DownloadService` (add `exports: [DownloadService]`) so `AnalysisModule` can inject it. `DatabaseModule` is already `@Global()` so no import is needed for `DatabaseService`.

## Non-Goals

- Do not change LLM analysis flow
- Do not change Python thin proxy
- Do not change document generation logic
- Do not implement async analysis task state machine (covered by 5b plan)
- No frontend polling or progress display
- No `metadata.type` platform extension

## Infrastructure And Config Prereqs

- B-station API access requires valid cookies (`COOKIE_FILE` env var or cookie string)
- `BilibiliStreamProvider` and `ResolutionService` must be accessible to the resolver -- they are currently private members of `DownloadService` (live: download.service.ts lines 56-65). Either expose a delegation method on `DownloadService` or promote `ResolutionService` to a NestJS provider.
- `DatabaseService` is globally available via `@Global() DatabaseModule` (live: database.module.ts line 4) -- no module import needed.
- `DownloadService` is NOT exported by `DownloadModule` (live: download.module.ts has no `exports`). Must add `exports: [DownloadService]` to make it injectable in `AnalysisModule`.
- `DatabaseService` and `DownloadService` must be available via NestJS DI to the resolver
- Sync re-download has 10-minute timeout
- 3a plan must be completed first (FfmpegScreenshot HTTP URL + headers support)

## Execution Plan

### Phase 1 - Define ScreenshotSourceResolver interface and implementation

Status: planned
Targets: `packages/server/src/analysis/screenshot-source-resolver.ts`, `packages/server/src/database/database.service.ts` (new query method), `packages/server/src/download/download.service.ts` (expose stream resolution), `packages/server/src/download/download.module.ts` (export DownloadService)

- Item Types: Add | Decision
- Prereqs: 3a completed

- [ ] Define `ScreenshotSourceResolver` interface: `resolve(params: { metadata, localVideoPath? }): Promise<{ source: string; sourceType: "remote" | "local"; headers?: Record<string, string> }>`
- [ ] Decision: resolver obtains stream resolution capability via `DownloadService` delegation method (e.g., `DownloadService.resolveBestVideoStream(bvid, cid): Promise<{ url, quality }>`), NOT via direct injection of `ResolutionService`/`BilibiliStreamProvider` (neither is a NestJS provider -- live: download.service.ts lines 56-65). Alternatives: promote `ResolutionService` to a shared provider (rejected -- changes existing instantiation pattern in `DownloadService.onModuleInit()` and risks breaking download flow). Residual risk: `DownloadService` gains a new public method that exposes internal capability.
- [ ] Implement resolver class that depends on `DownloadService` and `DatabaseService` (injected via constructor). `DownloadService` provides both stream resolution (new delegation method) and sync download (`createTask()` + `executeTask()`).
- [ ] Add new query method to `DatabaseService`: `findCompletedTaskByBvidAndCid(bvid: string, cid: number): TaskRecord | undefined` that returns full `TaskRecord` including `quality` and `outputFile` for `status='success'` tasks. Existing `findTasksByBvidsAndCids()` (live: database.service.ts line 221) returns only `{bvid, cid, status, createdAt}` and cannot serve the resolver.
- [ ] Add delegation method to `DownloadService`: `resolveBestVideoStream(bvid, cid)` that calls the internal `ResolutionService.resolveStreams()` + `selectBestStream()` (no preferences = highest quality) and returns the remote stream URL + quality. Cookie loading reuses existing `loadCookieString()` (live: download.service.ts line 434).
- [ ] Add `exports: [DownloadService]` to `DownloadModule` (live: download.module.ts) so `AnalysisModule` can inject it.
- [ ] Implement `metadata.type=local` path: return `{ source: localVideoPath, sourceType: "local" }`
- [ ] Implement `metadata.type=bilibili` Step 1: call `DownloadService.resolveBestVideoStream(bvid, cid)` to get highest quality remote stream URL; return `{ source: remoteUrl, sourceType: "remote", headers: { Referer: "https://www.bilibili.com" } }`
- [ ] Implement Step 2: call new `DatabaseService.findCompletedTaskByBvidAndCid(bvid, cid)`; if found and `quality >= 80`, return `{ source: task.outputFile, sourceType: "local" }`
- [ ] Implement Step 3: call `DownloadService.createTask()` to insert task (required because `executeTask()` checks `taskCache` -- live: download.service.ts lines 212-215), then call `DownloadService.executeTask()` synchronously (bypass scheduler); 10-minute timeout; return `task.outputFile` on success, throw on failure
- [ ] Decision: resolver is a concrete class implementing the interface, registered as NestJS `@Injectable()` provider. Alternatives: factory pattern (rejected -- over-engineering for single implementation). Residual risk: if multiple resolver strategies are needed in future, refactoring required.

Exit Criteria:

- [ ] `ScreenshotSourceResolver` interface and implementation exist
- [ ] All three fallback steps implemented for bilibili type
- [ ] Local type returns immediately
- [ ] New `DatabaseService.findCompletedTaskByBvidAndCid()` method returns `quality` and `outputFile`
- [ ] `DownloadService` exposes stream resolution delegation method
- [ ] `DownloadModule` exports `DownloadService`
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

- [ ] `analysis.module.ts` imports `DownloadModule` (which now exports `DownloadService` after Phase 1) to make `DownloadService` injectable. `DatabaseService` is already `@Global()` (live: database.module.ts line 4) so no import needed for it.
- [ ] Register `ScreenshotSourceResolver` as an `@Injectable()` provider in `analysis.module.ts`
- [ ] `AnalysisController` injects `ScreenshotSourceResolver` via constructor and passes it to `new AnalysisEngine(llmConfig, undefined, resolver)` (engine constructor signature updated in Phase 2 to accept resolver). `getLlmConfig()` (live: analysis.controller.ts lines 41-65) is retained for env var reading.
- [ ] Formal API endpoint passes `metadata` with `bvid`/`cid` from request body to `AnalysisInput` (already done in formal-api plan -- live: analysis.controller.ts lines 29-36; no change needed beyond passing resolver to engine)

Exit Criteria:

- [ ] `AnalysisEngine` is constructed with resolver dependency via DI
- [ ] `metadata.bvid` and `metadata.cid` flow from request to resolver
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] DI wiring verified at runtime: start server, send `curl -X POST http://localhost:3000/api/analysis/run -H "Content-Type: application/json" -d '{"videoPath":"","subtitlePath":"","videoTitle":"test","metadata":{"type":"local"}}'`, confirm response is NOT HTTP 500 (400/422 acceptable -- means DI wiring works, request validation rejecting empty videoPath)

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

- Status: passed (cold-replay proxy, reviewer availability = none)
- Reviewer / Agent: 独立 subagent cold-replay
- Evidence:
  - Baseline 准确性: 逐条核对 live 代码，发现 1 blocker + 4 major，全部修订：
    - B1 (blocker): baseline line 14 声称 AnalysisInput "no metadata, no screenshotVideoPath (formal API plan adds these)" -- formal-api plan 已 completed，AnalysisInput 已含 metadata + screenshotVideoPath（live: analysis-engine.ts lines 42-53）。已修订 baseline。
    - M1 (major): `findTasksByBvidsAndCids()` (live: database.service.ts line 223) 返回仅 `{bvid, cid, status, createdAt}`，无 `quality`/`outputFile`，resolver Step 2 无法使用。已在 Phase 1 新增 `findCompletedTaskByBvidAndCid()` 查询方法。
    - M2 (major): `executeTask()` (live: download.service.ts lines 212-215) 要求 task 已在 `taskCache` 中，必须先 `createTask()`。Phase 1 Step 3 已补充 `createTask()` 前置步骤。
    - M3 (major): `ResolutionService` 和 `BilibiliStreamProvider` 是 `DownloadService` 私有成员（live: download.service.ts lines 56-65），非 NestJS provider，不可注入。已改为通过 `DownloadService` delegation 方法暴露流解析能力。
    - M4 (major): `DownloadModule` 无 `exports`（live: download.module.ts），`DownloadService` 不可注入。已加入 `exports: [DownloadService]`。`DatabaseModule` 已 `@Global()`（live: database.module.ts line 4），无需 import。
  - AC 覆盖: 11/11 covered（AC1-11 全部被 exit criteria 覆盖）
  - 依赖方向: 3b depends on 3a + formal-api，方向正确
  - R6 testing 文档: 不存在，已创建 `docs/testing/2026/07-07-screenshot-fallback-3b-testing.md`
  - R8 Item Types: Phase 1 已从 `Add` 修正为 `Add | Decision`
  - Anti-Slacking: 无禁用词
  - 3b 涉及 integration 行为（截图源降级、DI 装配、DB 查询扩展）但非 protected area（auth/data-deletion/payment/deployment 均不触及），符合 cold-replay 适用条件

## Closure Gates

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] 3a plan (`2026-07-07-screenshot-remote-3a-plan.md`) is closed — FfmpegScreenshot supports HTTP URL + headers
- [ ] formal API plan (`2026-07-07-analysis-formal-api-plan.md`) is closed — AnalysisInput includes `metadata` and `screenshotVideoPath` (already done)
- [ ] `ScreenshotSourceResolver` interface and implementation exist and compile
- [ ] `DatabaseService.findCompletedTaskByBvidAndCid()` returns `quality` and `outputFile`
- [ ] `DownloadService` exposes stream resolution delegation method
- [ ] `DownloadModule` exports `DownloadService`
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
