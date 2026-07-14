# AI Summary Trigger And Dual-Path Analysis (5b) Plan

> Plan Status: done
> Last Reviewed: 2026-07-14
> Source: `docs/requirements/2026-07-07-ai-summary-interaction-5b.md`
> Related: `docs/plans/2026-07-07-ai-summary-database-5a-plan.md` (dependency), `docs/plans/2026-07-07-analysis-formal-api-plan.md` (AnalysisInput), `docs/plans/2026-07-07-document-structure-optimization-plan.md` (document structure), `docs/plans/2026-07-07-screenshot-fallback-3b-plan.md` (resolver bypass), `docs/plans/2026-07-07-link-parsing-frontend-4b-plan.md` (ParseResultList.vue)
> Audit: required
> Testing: `docs/testing/2026/07-07-ai-summary-trigger-5b-testing.md`

## Current Baseline

- `packages/server/src/download/download.service.ts`: `executeTask()` (line 210) downloads video + audio + subtitle; on completion calls `this.onTaskFinished?.(id)` in `finally` block (line 320); `onTaskFinished` is set by `DownloadScheduler` to trigger next scheduling (download-scheduler.ts line 42); `createTask()` (line 185) accepts `DownloadDto` and calls `db.insertTask()` (line 187) — no `autoSummary` field; `ResolutionService` and `BilibiliStreamProvider` are private members (lines 59, 62), not injectable via NestJS DI
- `packages/server/src/download/download.dto.ts`: `DownloadDto` (lines 4-14) has `bvid`, `cid`, `title`, `quality?`, `codec?`, `outputPath?`, `subtitleLang?` — no `autoSummary` field
- `packages/server/src/download/download-scheduler.ts`: manages `maxConcurrency` from `MAX_CONCURRENT_DOWNLOADS` env var, default 2 (line 26); `runningSet` tracks running downloads (line 20); `tryScheduleNext()` (line 83) picks next `created` task via `db.findNextCreatedTask()` (line 85); no concept of low-res download scheduling; `onTaskFinished` callback (lines 42-45) deletes from `runningSet` and calls `tryScheduleNext()`
- `packages/server/src/analysis/analysis-engine.ts`: `AnalysisInput` (lines 32-54) has `videoPath` (required), `subtitlePath?` (optional, formal-api done), `summaryDir`, `videoTitle`, `metadata` (lines 42-51: `type`, `videoUrl?`, `bvid?`, `cid?` — formal-api done), `screenshotVideoPath?` (line 53 — formal-api done); `analyze()` (line 101) already skips SRT parsing when `subtitlePath` is undefined or file does not exist (lines 108-113 — formal-api done, video-only path IS supported); LLM uses `input.videoPath` for `video_url` content part (line 123); screenshots use `input.videoPath` (lines 165-170) — `screenshotVideoPath` field exists in the type but is NOT yet wired into `analyze()` for screenshot source selection; `AnalysisEngine` constructor (lines 93-96) is `constructor(llmConfig: LlmConfig, httpClient?: typeof fetch)` — instantiated per-request in controller, not DI-managed
- `packages/server/src/analysis/analysis.controller.ts`: exposes `POST /api/analysis/run` (line 26, formal-api done) with `AnalysisRequest` body and input validation (lines 68-102); debug endpoint removed (formal-api done); no internal trigger method; `AnalysisEngine` instantiated per-request via `new AnalysisEngine(this.getLlmConfig())` (line 37); `getLlmConfig()` reads env vars (lines 41-65)
- `packages/server/src/analysis/analysis.module.ts`: only registers `AnalysisController`, no providers (lines 4-6)
- `packages/server/src/download/download.module.ts`: `providers: [DownloadService, DownloadScheduler]` (line 10), NO `exports` field — neither `DownloadService` nor `DownloadScheduler` is injectable outside `DownloadModule` without adding exports
- `packages/server/src/database/database.module.ts`: `@Global()` (line 4), exports `DatabaseService` (line 7) — globally available without importing the module
- `packages/frontend/src/api/index.ts`: has `createDownload()` (line 57), `checkTasks()` (line 98); no AI summary API; `createDownload()` does not accept `autoSummary` parameter
- `packages/frontend/src/views/ParseResultList.vue`: does NOT exist (4b plan not yet implemented)
- Database (5a plan): `task.auto_summary`, `task.summary_status`, `task.summary_output`, `analysis_sub_task` table — not yet implemented (live: `database.service.ts` `TaskRecord` lines 8-28 has no summary fields; `initSchema()` lines 52-86 has no such columns or table)
- Formal API (formal-api plan): COMPLETED — `POST /api/analysis/run` exists (live: `analysis.controller.ts` line 26); `AnalysisInput` includes `metadata`, `screenshotVideoPath?`, optional `subtitlePath` (live: `analysis-engine.ts` lines 32-54); `analyze()` supports video-only path (live: lines 108-113)

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

### Phase 1 - AnalysisEngine: wire screenshotVideoPath into analyze() for dual video source

Status: completed
Targets: `packages/server/src/analysis/analysis-engine.ts`

- Item Types: Fix
- Prereqs: formal API plan COMPLETED (AnalysisInput with optional subtitlePath and screenshotVideoPath)

- [x] Already done by formal-api plan: `analyze()` skips SRT parsing when `subtitlePath` is undefined or file does not exist (live: lines 108-113) — no action needed
- [x] Update `analyze()`: screenshot source changes from `input.videoPath` (live: line 166) to `input.screenshotVideoPath ?? input.videoPath` — this is the core dual video source wiring
- [x] When `screenshotVideoPath` is present, use it directly for `screenshotter.takeScreenshots()` (bypass ScreenshotSourceResolver)
- [x] Retain existing error handling: screenshot failure skips segment, LLM failure returns empty summary

Exit Criteria:

- [x] Analysis without subtitlePath completes (video-only LLM call) — already verified by formal-api plan; no action needed
- [x] Analysis with `screenshotVideoPath` uses it for screenshots, `videoPath` for LLM — verified by code review: screenshot source is `input.screenshotVideoPath ?? input.videoPath` (live line 166 changed)
- [x] `pnpm typecheck` passes
- [x] `pnpm build` passes

### Phase 2 - AnalysisTriggerService and download completion callback

Status: completed
Targets: `packages/server/src/analysis/analysis-trigger.service.ts` (new), `packages/server/src/download/download-scheduler.ts`, `packages/server/src/download/download.module.ts`, `packages/server/src/analysis/analysis.module.ts`

- Item Types: Add | Fix | Decision
- Prereqs: Phase 1, 5a plan (database fields)

- [x] Create `AnalysisTriggerService` (Injectable) with method `trigger(taskId: number): Promise<void>` that manages the full analysis lifecycle independently from download pipeline
- [x] `AnalysisTriggerService.trigger()` flow:
  1. Read task from DB; if `auto_summary=false` or `status != success`, return
  2. Update `summary_status = 'pending'`
  3. Check for `analysis_sub_task` — if exists and `status != completed`, return (wait for low-res download)
  4. If `analysis_sub_task` exists and `status = completed`: use low-res path for `videoPath`, high-res path for `screenshotVideoPath`
  5. If no `analysis_sub_task`: determine if low-res download needed (get quality list, compare with downloaded quality)
  6. If low-res needed: create `analysis_sub_task`, schedule low-res download, return (will be re-triggered when low-res completes)
  7. If low-res not needed (reuse): set `videoPath = screenshotVideoPath = downloaded video path`
  8. Construct `AnalysisInput` including `metadata` from task fields (`type: "bilibili"`, `bvid`, `cid`, `videoUrl` constructed from bvid)
  9. Call `AnalysisEngine.analyze()` with correct `AnalysisInput`
  10. Update `summary_status = 'completed'` and `summary_output` on success
  11. Update `summary_status = 'failed'` on error
  12. Clean up low-res video file from `ANALYSIS_LLM_VIDEO_DIR` after analysis
- [x] Decision: break circular module dependency between `AnalysisModule` (needs `DownloadScheduler` for low-res scheduling) and `DownloadModule` (needs `AnalysisTriggerService` for completion callback). Use callback pattern consistent with existing `onTaskFinished` (download-scheduler.ts line 42): `DownloadScheduler` exposes a public `onAnalysisTrigger?: (taskId: number) => void` callback that `AnalysisTriggerService` sets. This avoids circular DI. Alternatives: NestJS `forwardRef` (rejected — adds complexity, existing codebase uses callback pattern); shared event bus (rejected — over-engineering for single callback). Residual risk: callback must be set before any download completes; `onModuleInit` ordering ensures this.
- [x] Decision: `AnalysisTriggerService` instantiates `AnalysisEngine` per-use via `new AnalysisEngine(getLlmConfig())`, consistent with the existing controller pattern (analysis.controller.ts line 37). Alternatives: make `AnalysisEngine` a NestJS provider (rejected — changes existing instantiation pattern, requires module restructuring). Residual risk: `getLlmConfig()` env-var reading logic is duplicated; acceptable given consistency with controller.
- [x] Decision: `DownloadModule` must export `DownloadScheduler` (add `exports: [DownloadScheduler]` to `download.module.ts`) so `AnalysisModule` can inject it. `DownloadService` export is also needed if 3b plan has not yet added it. `DatabaseService` is already `@Global()` (database.module.ts line 4), no import needed.
- [x] Update `download-scheduler.ts` `onTaskFinished` callback (lines 42-45): after `runningSet.delete()` and `tryScheduleNext()`, call `this.onAnalysisTrigger?.(taskId)` as fire-and-forget. `AnalysisTriggerService` sets this callback and internally checks `auto_summary` and `status` before triggering analysis (`.catch(err => logger.error(...))`)
- [x] `analysis.module.ts` updated to provide `AnalysisTriggerService` and import `DownloadModule` (for `DownloadScheduler` injection). `DatabaseService` is `@Global()`, no import needed.
- [x] Decision: analysis trigger is asynchronous via `AnalysisTriggerService`, completely decoupled from `executeTask()`. Alternatives: synchronous within `executeTask()` (rejected — blocks `onTaskFinished`, preventing download pipeline from scheduling next tasks). Residual risk: if server restarts during analysis, analysis is lost; `summary_status = 'pending'` can be used for future recovery.

Exit Criteria:

- [x] `AnalysisTriggerService` exists and is registered in `analysis.module.ts` (code review)
- [x] `DownloadModule` exports `DownloadScheduler` (code review — `download.module.ts` has `exports: [DownloadScheduler]`)
- [x] `DownloadScheduler` exposes `onAnalysisTrigger` callback; `AnalysisTriggerService` sets it (code review — callback pattern, no circular DI)
- [x] `onTaskFinished` callback calls `this.onAnalysisTrigger?.(taskId)` as fire-and-forget (code review — confirms `.catch()` pattern, no `await`)
- [x] `auto_summary=false` tasks do not trigger analysis (code review — `trigger()` checks `auto_summary` first)
- [x] `auto_summary=true` tasks trigger analysis after download success (code review — callback checks `status === 'success'`)
- [x] Unified analysis flow determines quality and decides reuse vs. low-res download (code review of `trigger()` quality check logic)
- [x] `summary_status` updated to `pending`/`completed`/`failed` (code review)
- [x] Low-res video cleaned up after analysis (code review — `fs.unlink` or `rm` in `trigger()` finally block)
- [x] `pnpm typecheck` passes
- [x] `pnpm build` passes
- [x] Download pipeline not blocked: start server, create 2 download tasks with `auto_summary=true`, confirm second download starts while first analysis is running — verified by checking server logs for `tryScheduleNext` call after first download completes but before first analysis completes

### Phase 3 - Low-res download scheduler with completion callback

Status: completed
Targets: `packages/server/src/download/download-scheduler.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`

- Item Types: Add
- Prereqs: Phase 2, 5a plan (analysis_sub_task table)

- [x] Add `maxConcurrentLowRes` from `MAX_CONCURRENT_LOW_RES_DOWNLOADS` env var (default 1)
- [x] Add `lowResRunningSet` for tracking low-res downloads
- [x] Implement `scheduleLowResDownload(taskId, bvid, cid)`: creates `analysis_sub_task` record, selects lowest quality stream via `ResolutionService`, downloads to `ANALYSIS_LLM_VIDEO_DIR`
- [x] Low-res download uses a dedicated `executeLowResDownload()` method — does NOT call `executeTask()`, does NOT update `taskCache`, does NOT call `onTaskFinished`
- [x] Low-res downloads do not occupy high-res concurrency slots
- [x] Low-res downloads are silent (not shown in frontend task list — not in `taskCache`)
- [x] Low-res download completion callback: update `analysis_sub_task.status = completed`, then call `analysisTriggerService.trigger(taskId)` to re-check the waiting high-res task
- [x] Low-res download failure: update `analysis_sub_task.status = failed`, update `task.summary_status = failed` with error message

Exit Criteria:

- [x] Low-res download uses independent concurrency limit (code review — `lowResRunningSet` separate from `runningSet`)
- [x] Low-res download does not appear in frontend task list (code review — `executeLowResDownload()` does not touch `taskCache`)
- [x] Low-res download does not trigger `onTaskFinished` (code review — `executeLowResDownload()` has no `onTaskFinished` call)
- [x] `analysis_sub_task` record created and updated through lifecycle (code review)
- [x] Lowest quality stream selected (code review — `selectBestStream()` with ascending sort or explicit min quality selection)
- [x] Low-res download completion calls `analysisTriggerService.trigger(taskId)` to re-check waiting task (code review — solves the "wait" path dead-end)
- [x] `pnpm typecheck` passes

### Phase 4 - Backend HTTP endpoints and DownloadDto update

Status: completed
Targets: `packages/server/src/download/download.dto.ts`, `packages/server/src/download/download.service.ts`, `packages/server/src/download/download.controller.ts`, `packages/server/src/analysis/analysis.controller.ts`

- Item Types: Add | Fix
- Prereqs: Phase 2, Phase 3

- [x] Add `autoSummary?: boolean` to `DownloadDto`
- [x] Update `createTask()` in `download.service.ts` to pass `autoSummary` to `db.insertTask()`
- [x] Add `POST /api/tasks/:id/auto-summary` endpoint: accepts `{ enabled: boolean }`, calls `db.updateTaskStatus(id, { autoSummary: enabled })` — for setting auto_summary on existing tasks
- [x] Add `POST /api/analysis/trigger` endpoint: accepts `{ bvid: string, cid: number }`, finds task by bvid+cid, calls `analysisTriggerService.trigger(taskId)` — for one-click AI summary
- [x] One-click flow endpoint logic: get quality list -> if single quality: create download task with `autoSummary=true` -> if multiple qualities: create high-res download task + `scheduleLowResDownload()` + set `autoSummary=true`
- [x] Error handling: task not found -> 404; task already has `autoSummary=true` -> 409 Conflict; quality list fetch failure -> 502

Exit Criteria:

- [x] `DownloadDto` includes `autoSummary?: boolean` (code review)
- [x] `createTask()` passes `autoSummary` to `insertTask()` (code review)
- [x] `POST /api/tasks/:id/auto-summary` returns 200 on success — verified by `curl -X POST http://localhost:3000/api/tasks/1/auto-summary -H "Content-Type: application/json" -d '{"enabled":true}'`
- [x] `POST /api/analysis/trigger` returns 200/202 on success — verified by `curl -X POST http://localhost:3000/api/analysis/trigger -H "Content-Type: application/json" -d '{"bvid":"BV1SoTx6yEYc","cid":12345}'`
- [x] `POST /api/analysis/trigger` with non-existent task returns 404 — verified by curl
- [x] `POST /api/analysis/trigger` with `autoSummary=true` task returns 409 — verified by curl
- [x] `pnpm typecheck` passes
- [x] `pnpm build` passes

### Phase 5 - Frontend: AI summary switch and one-click button

Status: completed
Targets: `packages/frontend/src/views/ParseResultList.vue`, `packages/frontend/src/api/index.ts`, `packages/frontend/src/types/index.ts`

- Item Types: Add
- Prereqs: Phase 4, 4b plan (ParseResultList.vue exists)

- [x] Add per-video AI summary switch (toggle) in list page
- [x] Switch ON + add to queue -> `createDownload()` called with `autoSummary: true`
- [x] Update frontend `createDownload()` in `api/index.ts` to accept `autoSummary?: boolean` parameter
- [x] Add one-click AI summary button with 4 behavior branches:
  - Video not in queue: call `POST /api/analysis/trigger` (backend creates task + low-res sub-task if needed)
  - In queue, downloading, auto_summary=false: call `POST /api/tasks/:id/auto-summary` with `enabled: true`
  - In queue, downloaded, auto_summary=false: call `POST /api/analysis/trigger` (backend checks if low-res needed)
  - In queue, auto_summary=true: button disabled (greyed out)
- [x] Add `triggerAiSummary(bvid, cid)` API call to `api/index.ts` — calls `POST /api/analysis/trigger`
- [x] Add `setAutoSummary(taskId, enabled)` API call — calls `POST /api/tasks/:id/auto-summary`
- [x] Add types for AI summary request/response
- [x] Mutual exclusion: video already in one-click AI summary cannot be added to download queue separately — frontend checks `checkTasks()` response for `auto_summary` status
- [x] Button state updates after action
- [x] Error handling: show error message from API response (404/409/502)

Exit Criteria:

- [x] AI summary switch works per-video — verified by: toggle switch, add to queue, confirm `createDownload()` called with `autoSummary: true` (check network tab)
- [x] One-click button executes correct branch based on video state — verified by: test each of the 4 scenarios, confirm correct API endpoint called
- [x] Button disabled when `auto_summary=true` — verified by: check task with `auto_summary=true`, confirm button is greyed out
- [x] Mutual exclusion enforced — verified by: try adding to queue a video that already has `auto_summary=true`, confirm blocked
- [x] Error messages displayed from API response — verified by: trigger error (e.g., non-existent task), confirm error toast shows API message
- [x] `pnpm typecheck` passes
- [x] `pnpm build` passes

### Phase 6 - Verification

Status: completed

- Item Types: Proof
- Prereqs: Phase 5

Environment prerequisites:
- Server running on `localhost:3000`
- Python vision proxy running
- `COOKIE_FILE` pointing to valid B-station cookie file
- `QWEN_API_KEY`, `QWEN_VISION_PROXY_URL`, `QWEN_VISION_MODEL` env vars set
- Test video: `BV1SoTx6yEYc`
- Database has at least one completed download task for testing auto-trigger

- [x] Create/update `docs/testing/2026/07-07-ai-summary-trigger-5b-testing.md` with requirement-level testing directions, including specific curl commands and expected outputs
- [x] Run `pnpm typecheck` -- zero errors
- [x] Run `pnpm build` -- zero errors
- [x] Verify download pipeline not blocked: create 2 download tasks with `auto_summary=true`, confirm second download starts while first analysis runs (check server logs)
- [x] Verify Path 1 (no low-res): download video with `auto_summary=true` where video has single quality or downloaded quality is lowest — confirm analysis auto-triggers, `summary_status` becomes `completed`, Markdown file generated
- [x] Verify Path 2 (dual download): trigger one-click AI summary on video with multiple qualities — confirm high-res download + low-res download run in parallel, analysis uses low-res for LLM and high-res for screenshots
- [x] Verify "wait" path re-trigger: high-res download completes before low-res — confirm analysis waits, then triggers when low-res completes (check server logs for re-trigger)
- [x] Verify low-res cleanup: after Path 2 analysis completes, confirm low-res video file deleted from `ANALYSIS_LLM_VIDEO_DIR`
- [x] Verify no-subtitle analysis: download a video without subtitles with `auto_summary=true` — confirm analysis completes without subtitle
- [x] Verify one-click 4 branches: test each branch (not in queue / downloading / downloaded / already auto_summary) — confirm correct API calls and button states
- [x] Verify mutual exclusion: try adding to queue a video that already has `auto_summary=true` — confirm blocked

Exit Criteria:

- [x] `pnpm typecheck` zero errors
- [x] `pnpm build` zero errors
- [x] All curl and manual verification steps executed with expected results
- [x] Testing document covers: download pipeline not blocked, Path 1 auto-trigger, Path 2 dual download, "wait" path re-trigger, low-res cleanup, no-subtitle analysis, one-click 4 branches, mutual exclusion, button disabled state — each with curl command or manual steps and expected output

## Plan Audit

- Status: passed (cold-replay proxy, reviewer availability = none)
- Reviewer / Agent: 独立 subagent cold-replay
- Evidence:
  - Baseline 准确性: 逐条核对 live 代码，发现 3 blocker + 3 major，全部修订：
    - B1 (blocker): baseline line 15 声称 `AnalysisInput` 的 `subtitlePath` required、无 `screenshotVideoPath`、无 video-only path — 与 live 代码矛盾。formal-api 已 done：`subtitlePath?` optional (line 36)，`screenshotVideoPath?` 存在 (line 53)，`metadata` 存在 (lines 42-51)，`analyze()` 已支持 video-only (lines 108-113)。已修订 baseline。
    - B2 (blocker): baseline line 16 声称 controller 只有 `POST /api/analysis/debug` — 与 live 矛盾。formal-api 已 done：controller 暴露 `POST /api/analysis/run` (line 26)，debug 端点已移除。已修订 baseline。
    - B3 (blocker): baseline line 20 声称 formal API "not yet implemented" — formal-api plan 已 completed。已修订为 "COMPLETED"。
    - M1 (major): 循环依赖未处理 — `AnalysisModule` 需 `DownloadScheduler` (低分辨率调度)，`DownloadModule` 需 `AnalysisTriggerService` (完成回调)。已新增 Decision：使用 callback pattern (`onAnalysisTrigger`) 与现有 `onTaskFinished` 一致，避免循环 DI。
    - M2 (major): `DownloadModule` 无 `exports` (live: download.module.ts)，`DownloadScheduler` 不可注入。已新增 Decision：`DownloadModule` 须 `exports: [DownloadScheduler]`。
    - M3 (major): `AnalysisEngine` 实例化模式未说明 — `AnalysisTriggerService` 需调用 `analyze()` 但 `AnalysisEngine` 非 DI provider (per-request instantiated)。已新增 Decision：`AnalysisTriggerService` per-use 实例化 `AnalysisEngine`，与 controller 一致。
    - M4 (minor): Phase 1 item "skip SRT parsing when subtitlePath absent" 已由 formal-api 实现 (lines 108-113)。已标注 "Already done by formal-api plan"，Phase 1 聚焦 screenshotVideoPath wiring。
    - M5 (minor): baseline 缺少 `DownloadModule` 无 exports、`DatabaseModule` @Global、`ParseResultList.vue` 不存在等关键事实。已补充。
    - M6 (minor): baseline 缺少 file:line 证据。已逐条补充。
  - AC 覆盖: 15/15 全部被 exit criteria 覆盖（AC1→Phase 5 exit; AC2→Phase 4+5 exit; AC3→Phase 2 exit; AC4→Phase 2 exit line 107; AC5→Phase 2+3 exit; AC6→Phase 2 exit line 109 + Phase 6; AC7→Phase 5 exit; AC8→Phase 4+5 exit; AC9→Phase 4+5 exit; AC10→Phase 4+5 exit; AC11→Phase 5 exit; AC12→Phase 3 exit; AC13→Phase 3 exit; AC14→Phase 1 exit; AC15→all phases typecheck/build）
  - 依赖方向: 5b depends on 5a, formal-api (done), doc-opt, 3b, 4b — 方向正确。5a plan line 6 确认；formal-api plan 已 completed；3b plan follow-up 确认 5b 使用 screenshotVideoPath bypass；4b plan follow-up 确认 5b 在 ParseResultList.vue 添加功能。
  - R6 testing 文档: `docs/testing/2026/07-07-ai-summary-trigger-5b-testing.md` 不存在 — 已创建，含 15 个需求级测试方向（should/should-not）。
  - R8 Item Types: Phase 1 已从 `Add | Fix` 修正为 `Fix`（仅 wiring 改动）；Phase 2 已从 `Add | Fix` 修正为 `Add | Fix | Decision`。
  - Anti-Slacking: 未发现 optional/if time permits/consider/maybe/nice to have/as needed 禁用词用于 in-scope items。
  - 5b 涉及 API、integration、cross-module DI 行为，但非 protected area（auth/data-deletion/payment/deployment 均不触及），符合 cold-replay 适用条件。

## Closure Gates

- [x] `pnpm typecheck` zero errors
- [x] `pnpm build` zero errors
- [x] 5a plan (`2026-07-07-ai-summary-database-5a-plan.md`) is closed — `task.auto_summary`, `task.summary_status`, `task.summary_output`, `analysis_sub_task` table exist
- [x] Formal API plan (`2026-07-07-analysis-formal-api-plan.md`) is closed — `AnalysisInput` includes `metadata`, `screenshotVideoPath?`, optional `subtitlePath` (already done)
- [x] Document structure plan (`2026-07-07-document-structure-optimization-plan.md`) is closed — front matter `video_url` derivation from `metadata.type`
- [x] 3b plan (`2026-07-07-screenshot-fallback-3b-plan.md`) is closed OR `screenshotVideoPath` bypass makes resolver unnecessary (code review confirms 5b always passes `screenshotVideoPath`)
- [x] 4b plan (`2026-07-07-link-parsing-frontend-4b-plan.md`) is closed — `ParseResultList.vue` exists
- [x] `AnalysisTriggerService` exists and is registered (code review)
- [x] `DownloadModule` exports `DownloadScheduler` (code review — `download.module.ts` has `exports`)
- [x] `DownloadScheduler` exposes `onAnalysisTrigger` callback, `AnalysisTriggerService` sets it — no circular DI (code review)
- [x] `onTaskFinished` calls `this.onAnalysisTrigger?.(taskId)` as fire-and-forget, does not block download pipeline (code review + manual verification: second download starts while first analysis runs)
- [x] `executeLowResDownload()` does not touch `taskCache` or call `onTaskFinished` (code review)
- [x] Low-res download completion calls `analysisTriggerService.trigger(taskId)` to re-check waiting task (code review)
- [x] `DownloadDto` includes `autoSummary?: boolean` (code review)
- [x] `POST /api/tasks/:id/auto-summary` returns 200 on success — verified by curl
- [x] `POST /api/analysis/trigger` returns 200/202 on success, 404 for non-existent task, 409 for already-auto-summary task — verified by curl
- [x] Frontend AI summary switch passes `autoSummary: true` to `createDownload()` — verified by network tab inspection
- [x] One-click button executes 4 branches correctly — verified by manual testing
- [x] Mutual exclusion enforced — verified by manual testing
- [x] Low-res video cleaned up after analysis — verified by checking `ANALYSIS_LLM_VIDEO_DIR` after Path 2 analysis
- [x] `docs/logs/` updated with implementation record
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up without recorded rationale
- [x] plan audit passed before implementation
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent (or cold-replay proxy documented)
- [x] closure evidence exists in files

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

Status Note: Plan closed on 2026-07-14. AnalysisTriggerService async trigger chain, low-res dual-path scheduler, backend endpoints, DownloadDto update, frontend switch/one-click branches, and no-subtitle analysis path are implemented and verified.

Closure Audit Evidence:

- Reviewer / Agent: independent closure audit by subagent Explore (2026-07-14)
- Evidence: pnpm typecheck, pnpm build, runtime route/HTTP checks for /api/analysis/trigger and /api/tasks/:id/auto-summary, docs/testing/2026/07-07-ai-summary-trigger-5b-testing.md execution record, docs/logs/2026-07-14-ai-summary-trigger-5b.md, and independent subagent audit PASS.

Follow-up:

- 5d plan will add email notification on analysis completion/failure

