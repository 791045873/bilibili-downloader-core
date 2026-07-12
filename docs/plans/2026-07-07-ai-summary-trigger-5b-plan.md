# AI Summary Trigger And Dual-Path Analysis (5b) Plan

> Plan Status: planned
> Last Reviewed: 2026-07-11
> Source: `docs/requirements/2026-07-07-ai-summary-interaction-5b.md`
> Related: `docs/plans/2026-07-07-ai-summary-database-5a-plan.md` (dependency), `docs/plans/2026-07-07-analysis-formal-api-plan.md` (AnalysisInput), `docs/plans/2026-07-07-document-structure-optimization-plan.md` (document structure), `docs/plans/2026-07-07-screenshot-fallback-3b-plan.md` (resolver bypass), `docs/plans/2026-07-07-link-parsing-frontend-4b-plan.md` (ParseResultList.vue)
> Audit: required
> Testing: `docs/testing/2026/07-07-ai-summary-trigger-5b-testing.md`

## Current Baseline

- `packages/server/src/download/download.service.ts`: `executeTask()` downloads video + audio + subtitle; on completion calls `this.onTaskFinished?.(id)` in `finally` block; `onTaskFinished` is set by `DownloadScheduler` to trigger next scheduling; `createTask()` accepts `DownloadDto` and calls `db.insertTask()` — no `autoSummary` field
- `packages/server/src/download/download.dto.ts`: `DownloadDto` has `bvid`, `cid`, `title`, `quality`, `codec`, `outputPath`, `subtitleLang` — no `autoSummary` field
- `packages/server/src/download/download-scheduler.ts`: manages `maxConcurrency` (from `MAX_CONCURRENT_DOWNLOADS` env var, default 2); `tryScheduleNext()` picks next `created` task; no concept of low-res download scheduling; `onTaskFinished` callback deletes from `runningSet` and calls `tryScheduleNext()`
- `packages/server/src/analysis/analysis-engine.ts`: `AnalysisInput` has `videoPath` (required), `subtitlePath` (required), `summaryDir`, `videoTitle`; `analyze()` always parses SRT first — no video-only path; no `screenshotVideoPath` support; uses `input.videoPath` for both LLM and screenshots
- `packages/server/src/analysis/analysis.controller.ts`: only `POST /api/analysis/debug` with hardcoded test assets; no internal trigger method
- `packages/server/src/analysis/analysis.module.ts`: only registers `AnalysisController`, no providers
- `packages/frontend/src/api/index.ts`: has `createDownload()`, `checkTasks()`; no AI summary API; `createDownload()` does not accept `autoSummary` parameter
- Database (5a plan): `task.auto_summary`, `task.summary_status`, `task.summary_output`, `analysis_sub_task` table — not yet implemented
- Formal API (formal API plan): `POST /api/analysis/run` with `AnalysisInput` including `metadata`, `screenshotVideoPath?`, optional `subtitlePath` — not yet implemented

## Goals

- New `AnalysisTriggerService` that manages analysis lifecycle independently from download pipeline
- Download scheduler's `onTaskFinished` callback checks `auto_summary` and triggers `AnalysisTriggerService` asynchronously (fire-and-forget, does not block download pipeline)
- Unified analysis flow: check available qualities -> determine if low-res download needed -> download low-res for LLM + use high-res for screenshots -> generate doc -> update summary_status
- Low-res download: select lowest quality, store in `ANALYSIS_LLM_VIDEO_DIR`, clean up after analysis; isolated from taskCache and scheduler callbacks
- Low-res download completion triggers re-check of waiting high-res tasks (solves the "wait" path dead-end)
- `AnalysisEngine` supports: optional `subtitlePath` (video-only analysis), dual video source (`videoPath` for LLM + `screenshotVideoPath` for screenshots)
- Backend HTTP endpoints for frontend AI summary operations
- `DownloadDto` and `createTask()` support `autoSummary` parameter
- `ParseResultList.vue`: per-video AI summary switch + one-click AI summary button with 4 behavior branches
- No-subtitle case: skip subtitle, pass only video to LLM
- Low-res video file deleted after analysis completion

## Non-Goals

- Do not implement database changes (5a plan)
- Do not implement email notification (5d plan)
- Do not implement analysis progress display
- Do not change Python thin proxy
- Do not change LLM analysis core chain

## Infrastructure And Config Prereqs

- 5a plan completed (database fields and analysis_sub_task table)
- Formal API plan completed (AnalysisInput with metadata, screenshotVideoPath, optional subtitlePath)
- Document structure optimization plan completed (front matter with video_url from metadata.type)
- 3b plan completed (ScreenshotSourceResolver — 5b bypasses it via screenshotVideoPath)
- 4b plan completed (ParseResultList.vue exists)
- New env vars: `MAX_CONCURRENT_LOW_RES_DOWNLOADS` (default 1), `ANALYSIS_LLM_VIDEO_DIR` (default `downloads/.analysis-llm/`)
- Cookie file for B-station API access (`COOKIE_FILE`)

## Execution Plan

### Phase 1 - AnalysisEngine: support optional subtitlePath and dual video source

Status: planned
Targets: `packages/server/src/analysis/analysis-engine.ts`

- Item Types: Add | Fix
- Prereqs: formal API plan (AnalysisInput with optional subtitlePath and screenshotVideoPath)

- [ ] Update `analyze()`: if `input.subtitlePath` is undefined or file does not exist, skip SRT parsing; LLM user message contains only `video_url` content part (no text part for subtitle)
- [ ] Update `analyze()`: LLM `video_url` content part continues to use `input.videoPath` (low-res path); screenshot source changes to `input.screenshotVideoPath ?? input.videoPath`
- [ ] When `screenshotVideoPath` is present, use it directly for `screenshotter.takeScreenshots()` (bypass ScreenshotSourceResolver)
- [ ] Retain existing error handling: screenshot failure skips segment, LLM failure returns empty summary

Exit Criteria:

- [ ] Analysis without subtitlePath completes (video-only LLM call) — verified by code review: `analyze()` checks `subtitlePath` existence before `parseSrtFile()`
- [ ] Analysis with `screenshotVideoPath` uses it for screenshots, `videoPath` for LLM — verified by code review: screenshot source is `input.screenshotVideoPath ?? input.videoPath`
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

### Phase 2 - AnalysisTriggerService and download completion callback

Status: planned
Targets: `packages/server/src/analysis/analysis-trigger.service.ts` (new), `packages/server/src/download/download-scheduler.ts`, `packages/server/src/analysis/analysis.module.ts`

- Item Types: Add | Fix
- Prereqs: Phase 1, 5a plan (database fields)

- [ ] Create `AnalysisTriggerService` (Injectable) with method `trigger(taskId: number): Promise<void>` that manages the full analysis lifecycle independently from download pipeline
- [ ] `AnalysisTriggerService.trigger()` flow:
  1. Read task from DB; if `auto_summary=false` or `status != success`, return
  2. Update `summary_status = 'pending'`
  3. Check for `analysis_sub_task` — if exists and `status != completed`, return (wait for low-res download)
  4. If `analysis_sub_task` exists and `status = completed`: use low-res path for `videoPath`, high-res path for `screenshotVideoPath`
  5. If no `analysis_sub_task`: determine if low-res download needed (get quality list, compare with downloaded quality)
  6. If low-res needed: create `analysis_sub_task`, schedule low-res download, return (will be re-triggered when low-res completes)
  7. If low-res not needed (reuse): set `videoPath = screenshotVideoPath = downloaded video path`
  8. Call `AnalysisEngine.analyze()` with correct `AnalysisInput`
  9. Update `summary_status = 'completed'` and `summary_output` on success
  10. Update `summary_status = 'failed'` on error
  11. Clean up low-res video file from `ANALYSIS_LLM_VIDEO_DIR` after analysis
- [ ] Update `download-scheduler.ts` `onTaskFinished` callback: after `runningSet.delete()` and `tryScheduleNext()`, check task `auto_summary` and `status`; if both true, call `analysisTriggerService.trigger(taskId)` as fire-and-forget (`.catch(err => logger.error(...))`)
- [ ] `analysis.module.ts` updated to provide `AnalysisTriggerService` and import `DatabaseModule`, `DownloadModule`
- [ ] Decision: analysis trigger is asynchronous via `AnalysisTriggerService`, completely decoupled from `executeTask()`. Alternatives: synchronous within `executeTask()` (rejected — blocks `onTaskFinished`, preventing download pipeline from scheduling next tasks). Residual risk: if server restarts during analysis, analysis is lost; `summary_status = 'pending'` can be used for future recovery.

Exit Criteria:

- [ ] `AnalysisTriggerService` exists and is registered in `analysis.module.ts` (code review)
- [ ] `onTaskFinished` callback calls `analysisTriggerService.trigger()` as fire-and-forget (code review — confirms `.catch()` pattern, no `await`)
- [ ] `auto_summary=false` tasks do not trigger analysis (code review — `trigger()` checks `auto_summary` first)
- [ ] `auto_summary=true` tasks trigger analysis after download success (code review — scheduler callback checks `status === 'success'`)
- [ ] Unified analysis flow determines quality and decides reuse vs. low-res download (code review of `trigger()` quality check logic)
- [ ] `summary_status` updated to `pending`/`completed`/`failed` (code review)
- [ ] Low-res video cleaned up after analysis (code review — `fs.unlink` or `rm` in `trigger()` finally block)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] Download pipeline not blocked: start server, create 2 download tasks with `auto_summary=true`, confirm second download starts while first analysis is running — verified by checking server logs for `tryScheduleNext` call after first download completes but before first analysis completes

### Phase 3 - Low-res download scheduler with completion callback

Status: planned
Targets: `packages/server/src/download/download-scheduler.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`

- Item Types: Add
- Prereqs: Phase 2, 5a plan (analysis_sub_task table)

- [ ] Add `maxConcurrentLowRes` from `MAX_CONCURRENT_LOW_RES_DOWNLOADS` env var (default 1)
- [ ] Add `lowResRunningSet` for tracking low-res downloads
- [ ] Implement `scheduleLowResDownload(taskId, bvid, cid)`: creates `analysis_sub_task` record, selects lowest quality stream via `ResolutionService`, downloads to `ANALYSIS_LLM_VIDEO_DIR`
- [ ] Low-res download uses a dedicated `executeLowResDownload()` method — does NOT call `executeTask()`, does NOT update `taskCache`, does NOT call `onTaskFinished`
- [ ] Low-res downloads do not occupy high-res concurrency slots
- [ ] Low-res downloads are silent (not shown in frontend task list — not in `taskCache`)
- [ ] Low-res download completion callback: update `analysis_sub_task.status = completed`, then call `analysisTriggerService.trigger(taskId)` to re-check the waiting high-res task
- [ ] Low-res download failure: update `analysis_sub_task.status = failed`, update `task.summary_status = failed` with error message

Exit Criteria:

- [ ] Low-res download uses independent concurrency limit (code review — `lowResRunningSet` separate from `runningSet`)
- [ ] Low-res download does not appear in frontend task list (code review — `executeLowResDownload()` does not touch `taskCache`)
- [ ] Low-res download does not trigger `onTaskFinished` (code review — `executeLowResDownload()` has no `onTaskFinished` call)
- [ ] `analysis_sub_task` record created and updated through lifecycle (code review)
- [ ] Lowest quality stream selected (code review — `selectBestStream()` with ascending sort or explicit min quality selection)
- [ ] Low-res download completion calls `analysisTriggerService.trigger(taskId)` to re-check waiting task (code review — solves the "wait" path dead-end)
- [ ] `pnpm typecheck` passes

### Phase 4 - Backend HTTP endpoints and DownloadDto update

Status: planned
Targets: `packages/server/src/download/download.dto.ts`, `packages/server/src/download/download.service.ts`, `packages/server/src/download/download.controller.ts`, `packages/server/src/analysis/analysis.controller.ts`

- Item Types: Add | Fix
- Prereqs: Phase 2, Phase 3

- [ ] Add `autoSummary?: boolean` to `DownloadDto`
- [ ] Update `createTask()` in `download.service.ts` to pass `autoSummary` to `db.insertTask()`
- [ ] Add `POST /api/tasks/:id/auto-summary` endpoint: accepts `{ enabled: boolean }`, calls `db.updateTaskStatus(id, { autoSummary: enabled })` — for setting auto_summary on existing tasks
- [ ] Add `POST /api/analysis/trigger` endpoint: accepts `{ bvid: string, cid: number }`, finds task by bvid+cid, calls `analysisTriggerService.trigger(taskId)` — for one-click AI summary
- [ ] One-click flow endpoint logic: get quality list -> if single quality: create download task with `autoSummary=true` -> if multiple qualities: create high-res download task + `scheduleLowResDownload()` + set `autoSummary=true`
- [ ] Error handling: task not found -> 404; task already has `autoSummary=true` -> 409 Conflict; quality list fetch failure -> 502

Exit Criteria:

- [ ] `DownloadDto` includes `autoSummary?: boolean` (code review)
- [ ] `createTask()` passes `autoSummary` to `insertTask()` (code review)
- [ ] `POST /api/tasks/:id/auto-summary` returns 200 on success — verified by `curl -X POST http://localhost:3000/api/tasks/1/auto-summary -H "Content-Type: application/json" -d '{"enabled":true}'`
- [ ] `POST /api/analysis/trigger` returns 200/202 on success — verified by `curl -X POST http://localhost:3000/api/analysis/trigger -H "Content-Type: application/json" -d '{"bvid":"BV1SoTx6yEYc","cid":12345}'`
- [ ] `POST /api/analysis/trigger` with non-existent task returns 404 — verified by curl
- [ ] `POST /api/analysis/trigger` with `autoSummary=true` task returns 409 — verified by curl
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

### Phase 5 - Frontend: AI summary switch and one-click button

Status: planned
Targets: `packages/frontend/src/views/ParseResultList.vue`, `packages/frontend/src/api/index.ts`, `packages/frontend/src/types/index.ts`

- Item Types: Add
- Prereqs: Phase 4, 4b plan (ParseResultList.vue exists)

- [ ] Add per-video AI summary switch (toggle) in list page
- [ ] Switch ON + add to queue -> `createDownload()` called with `autoSummary: true`
- [ ] Update frontend `createDownload()` in `api/index.ts` to accept `autoSummary?: boolean` parameter
- [ ] Add one-click AI summary button with 4 behavior branches:
  - Video not in queue: call `POST /api/analysis/trigger` (backend creates task + low-res sub-task if needed)
  - In queue, downloading, auto_summary=false: call `POST /api/tasks/:id/auto-summary` with `enabled: true`
  - In queue, downloaded, auto_summary=false: call `POST /api/analysis/trigger` (backend checks if low-res needed)
  - In queue, auto_summary=true: button disabled (greyed out)
- [ ] Add `triggerAiSummary(bvid, cid)` API call to `api/index.ts` — calls `POST /api/analysis/trigger`
- [ ] Add `setAutoSummary(taskId, enabled)` API call — calls `POST /api/tasks/:id/auto-summary`
- [ ] Add types for AI summary request/response
- [ ] Mutual exclusion: video already in one-click AI summary cannot be added to download queue separately — frontend checks `checkTasks()` response for `auto_summary` status
- [ ] Button state updates after action
- [ ] Error handling: show error message from API response (404/409/502)

Exit Criteria:

- [ ] AI summary switch works per-video — verified by: toggle switch, add to queue, confirm `createDownload()` called with `autoSummary: true` (check network tab)
- [ ] One-click button executes correct branch based on video state — verified by: test each of the 4 scenarios, confirm correct API endpoint called
- [ ] Button disabled when `auto_summary=true` — verified by: check task with `auto_summary=true`, confirm button is greyed out
- [ ] Mutual exclusion enforced — verified by: try adding to queue a video that already has `auto_summary=true`, confirm blocked
- [ ] Error messages displayed from API response — verified by: trigger error (e.g., non-existent task), confirm error toast shows API message
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

### Phase 6 - Verification

Status: planned

- Item Types: Proof
- Prereqs: Phase 5

Environment prerequisites:
- Server running on `localhost:3000`
- Python vision proxy running
- `COOKIE_FILE` pointing to valid B-station cookie file
- `QWEN_API_KEY`, `QWEN_VISION_PROXY_URL`, `QWEN_VISION_MODEL` env vars set
- Test video: `BV1SoTx6yEYc`
- Database has at least one completed download task for testing auto-trigger

- [ ] Create/update `docs/testing/2026/07-07-ai-summary-trigger-5b-testing.md` with requirement-level testing directions, including specific curl commands and expected outputs
- [ ] Run `pnpm typecheck` -- zero errors
- [ ] Run `pnpm build` -- zero errors
- [ ] Verify download pipeline not blocked: create 2 download tasks with `auto_summary=true`, confirm second download starts while first analysis runs (check server logs)
- [ ] Verify Path 1 (no low-res): download video with `auto_summary=true` where video has single quality or downloaded quality is lowest — confirm analysis auto-triggers, `summary_status` becomes `completed`, Markdown file generated
- [ ] Verify Path 2 (dual download): trigger one-click AI summary on video with multiple qualities — confirm high-res download + low-res download run in parallel, analysis uses low-res for LLM and high-res for screenshots
- [ ] Verify "wait" path re-trigger: high-res download completes before low-res — confirm analysis waits, then triggers when low-res completes (check server logs for re-trigger)
- [ ] Verify low-res cleanup: after Path 2 analysis completes, confirm low-res video file deleted from `ANALYSIS_LLM_VIDEO_DIR`
- [ ] Verify no-subtitle analysis: download a video without subtitles with `auto_summary=true` — confirm analysis completes without subtitle
- [ ] Verify one-click 4 branches: test each branch (not in queue / downloading / downloaded / already auto_summary) — confirm correct API calls and button states
- [ ] Verify mutual exclusion: try adding to queue a video that already has `auto_summary=true` — confirm blocked

Exit Criteria:

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] All curl and manual verification steps executed with expected results
- [ ] Testing document covers: download pipeline not blocked, Path 1 auto-trigger, Path 2 dual download, "wait" path re-trigger, low-res cleanup, no-subtitle analysis, one-click 4 branches, mutual exclusion, button disabled state — each with curl command or manual steps and expected output

## Plan Audit

- Status: pending
- Reviewer / Agent: TBD (independent subagent or reviewer)
- Evidence: TBD

## Closure Gates

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] 5a plan (`2026-07-07-ai-summary-database-5a-plan.md`) is closed — `task.auto_summary`, `task.summary_status`, `task.summary_output`, `analysis_sub_task` table exist
- [ ] Formal API plan (`2026-07-07-analysis-formal-api-plan.md`) is closed — `AnalysisInput` includes `metadata`, `screenshotVideoPath?`, optional `subtitlePath`
- [ ] Document structure plan (`2026-07-07-document-structure-optimization-plan.md`) is closed — front matter `video_url` derivation from `metadata.type`
- [ ] 3b plan (`2026-07-07-screenshot-fallback-3b-plan.md`) is closed OR `screenshotVideoPath` bypass makes resolver unnecessary (code review confirms 5b always passes `screenshotVideoPath`)
- [ ] 4b plan (`2026-07-07-link-parsing-frontend-4b-plan.md`) is closed — `ParseResultList.vue` exists
- [ ] `AnalysisTriggerService` exists and is registered (code review)
- [ ] `onTaskFinished` calls `analysisTriggerService.trigger()` as fire-and-forget, does not block download pipeline (code review + manual verification: second download starts while first analysis runs)
- [ ] `executeLowResDownload()` does not touch `taskCache` or call `onTaskFinished` (code review)
- [ ] Low-res download completion calls `analysisTriggerService.trigger(taskId)` to re-check waiting task (code review)
- [ ] `DownloadDto` includes `autoSummary?: boolean` (code review)
- [ ] `POST /api/tasks/:id/auto-summary` returns 200 on success — verified by curl
- [ ] `POST /api/analysis/trigger` returns 200/202 on success, 404 for non-existent task, 409 for already-auto-summary task — verified by curl
- [ ] Frontend AI summary switch passes `autoSummary: true` to `createDownload()` — verified by network tab inspection
- [ ] One-click button executes 4 branches correctly — verified by manual testing
- [ ] Mutual exclusion enforced — verified by manual testing
- [ ] Low-res video cleaned up after analysis — verified by checking `ANALYSIS_LLM_VIDEO_DIR` after Path 2 analysis
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred/follow-up without recorded rationale
- [ ] plan audit passed before implementation
- [ ] text consistency verified: status, phases, gates, testing document, and log all agree
- [ ] closure audit was independent (or cold-replay proxy documented)
- [ ] closure evidence exists in files

## Deferred But Adjudicated

### Analysis progress display

- Classification: out-of-scope improvement
- Why Not Blocking Closure: Requirement explicitly excludes progress display
- Successor Required: no

### Analysis retry logic

- Classification: optimization candidate
- Why Not Blocking Closure: Current behavior sets `summary_status=failed` on error; retry can be added later. `summary_status='pending'` can be used for future recovery after server restart.
- Successor Required: no

## Closure

Status Note: Plan not yet started. Closure requires `AnalysisTriggerService` with async trigger, download pipeline not blocked, low-res download scheduler with completion callback, backend HTTP endpoints, DownloadDto update, frontend switch and button with 4 branches, and no-subtitle analysis all verified.

Closure Audit Evidence:

- Reviewer / Agent: TBD
- Evidence: TBD

Follow-up:

- 5d plan will add email notification on analysis completion/failure
