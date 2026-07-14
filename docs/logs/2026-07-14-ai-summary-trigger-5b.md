# 2026-07-14 AI Summary Trigger And Dual-Path Analysis (5b)

## Summary

Completed Seq 8 implementation for AI summary trigger and dual-path analysis integration across server and frontend.

## Implemented

### Server

- Added `AnalysisTriggerService`:
  - file: `packages/server/src/analysis/analysis-trigger.service.ts`
  - manages unified analysis lifecycle for `auto_summary` tasks
  - updates `summary_status` (`pending` / `completed` / `failed`)
  - decides reuse-vs-low-res path based on quality list
  - creates `analysis_sub_task` and schedules silent low-res download when needed
  - re-triggers analysis after low-res completion callback
  - cleans low-res files from `ANALYSIS_LLM_VIDEO_DIR` after analysis
- Updated `AnalysisModule` wiring:
  - registered `AnalysisTriggerService`
  - kept resolver provider
- Added `POST /api/analysis/trigger` endpoint:
  - updates `auto_summary` on latest task and triggers analysis
  - returns HTTP 404 for missing task and 409 for already-enabled task
- Updated `DownloadScheduler`:
  - added `onAnalysisTrigger` callback hook on download completion
  - added independent low-res queue with configurable concurrency (`MAX_CONCURRENT_LOW_RES_DOWNLOADS`)
  - added `onLowResFinished` callback for analysis re-trigger / failure propagation
- Updated `DownloadService`:
  - added `executeLowResDownload()` for silent low-res download (no taskCache and no scheduler callback pollution)
  - `createTask()` now persists `autoSummary`
- Updated `DownloadController`:
  - added `POST /api/tasks/:id/auto-summary`
- Updated `DatabaseService`:
  - `findTasksByBvidsAndCids()` now returns `id` and `autoSummary`
  - added `findLatestTaskByBvidAndCid()` helper
- Updated `DownloadModule` export list to include `DownloadScheduler`
- Updated `DownloadDto` with `autoSummary?: boolean`

### Frontend

- Updated `api/index.ts`:
  - `createDownload()` accepts `autoSummary`
  - `checkTasks()` response includes `id` and `autoSummary`
  - added `triggerAiSummary()` and `setAutoSummary()`
- Updated `types/index.ts`:
  - `TaskEntry` includes `autoSummary`
- Updated `ParseResultList.vue`:
  - per-item AI summary switch
  - one-click AI summary button and branch handling
  - disabled one-click button when already queued with `autoSummary=true`
  - queue/add flow sends `autoSummary` on createDownload

## Verification

- `pnpm typecheck` passed
- `pnpm build` passed
- Runtime server startup evidence confirms:
  - `AnalysisModule` and `DownloadModule` initialized
  - `/api/analysis/trigger` route mapped
  - `/api/tasks/:id/auto-summary` route mapped
- Runtime endpoint checks:
  - `POST /api/analysis/trigger` with missing task -> 404
  - `POST /api/tasks/999999/auto-summary` -> 400

## Independent Review

- Independent subagent (`Explore`) closure audit result: PASS
- Review note addressed:
  - upgraded `/api/analysis/trigger` error handling to use Nest exceptions (`NotFoundException`, `ConflictException`) for proper HTTP status codes
