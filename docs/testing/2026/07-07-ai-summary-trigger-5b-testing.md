# AI Summary Trigger And Dual-Path Analysis (5b) Testing

> Source: `docs/plans/2026-07-07-ai-summary-trigger-5b-plan.md`
> Requirement: `docs/requirements/2026-07-07-ai-summary-interaction-5b.md`
> Created: 2026-07-12 (plan audit phase)

## Environment Prerequisites

- Server running on `localhost:3000`
- Python vision proxy running (`QWEN_VISION_PROXY_URL` set)
- `COOKIE_FILE` pointing to valid B-station cookie file
- `QWEN_API_KEY`, `QWEN_API_BASE`, `QWEN_MODEL`, `QWEN_VISION_MODEL` env vars set
- `MAX_CONCURRENT_LOW_RES_DOWNLOADS` env var set (default 1)
- `ANALYSIS_LLM_VIDEO_DIR` env var set (default `downloads/.analysis-llm/`)
- Test video: `BV1SoTx6yEYc` (or any video with multiple qualities)
- Database has at least one completed download task for testing auto-trigger
- 5a plan completed (database fields exist), formal-api plan completed, 4b plan completed (`ParseResultList.vue` exists)

## Testing Directions

### 1. AI Summary Switch Per Video (AC1, AC2)

**Should:** Each video item in `ParseResultList.vue` list page has an "AI 总结" toggle switch. When the switch is ON and the video is added to the download queue, the created task has `auto_summary=true`.

**Should not:** The switch state should not affect videos already in the queue that were added with `auto_summary=false` without explicit user action.

**Verification:**
- Navigate to list page, toggle switch ON for a video, add to queue
- Check network tab: `POST /api/download` request body includes `autoSummary: true`
- Query database: `SELECT auto_summary FROM task WHERE id = <new task id>` returns `1`

### 2. Auto-Trigger After Download Completion (AC3)

**Should:** When a download task with `auto_summary=true` completes successfully (`status=success`), analysis is automatically triggered. `summary_status` transitions from `none` to `pending` to `completed`.

**Should not:** Tasks with `auto_summary=false` should NOT trigger analysis after download completion.

**Verification:**
- Create a download task with `autoSummary: true` for a single-quality video
- Wait for download to complete
- Check server logs for analysis trigger
- Query database: `SELECT summary_status FROM task WHERE id = <task id>` — should be `completed` (or `pending` if still running)
- Repeat with `autoSummary: false` — confirm no analysis trigger in logs, `summary_status` remains `none`

### 3. Download Pipeline Not Blocked (AC3)

**Should:** When a download task with `auto_summary=true` completes and analysis starts, the next download task in the queue should start immediately without waiting for analysis to finish.

**Should not:** Analysis should not block the download scheduler from picking up the next `created` task.

**Verification:**
- Create 2 download tasks with `autoSummary: true` for videos with single quality
- Wait for first download to complete
- Check server logs: `tryScheduleNext` called after first download completes, second download starts before first analysis completes
- Confirm second download `status` becomes `downloading` while first task `summary_status` is still `pending`

### 4. Quality Reuse — Single Quality or Lowest Already Downloaded (AC4)

**Should:** When the downloaded video is the lowest available quality OR the video has only one quality, analysis reuses the downloaded video directly (no low-res download). `videoPath` and `screenshotVideoPath` are the same.

**Should not:** No `analysis_sub_task` record should be created in the reuse path.

**Verification:**
- Download a video with single quality using `autoSummary: true`
- After analysis completes, query: `SELECT * FROM analysis_sub_task WHERE task_id = <task id>` — should return no rows
- Check `summary_status = completed` and Markdown file exists

### 5. Dual Download — Low-Res for LLM, High-Res for Screenshots (AC5)

**Should:** When the video has multiple qualities and the downloaded quality is NOT the lowest, a low-res download is triggered. Analysis uses the low-res video for LLM and the high-res video for screenshots.

**Should not:** Low-res download should not appear in the frontend task list (not in `taskCache`).

**Verification:**
- Trigger one-click AI summary on a video with multiple qualities (not in queue)
- Check: high-res download task created with `auto_summary=true`
- Check: `analysis_sub_task` record created with `status = created` then `completed`
- After both downloads complete, check analysis uses low-res for LLM (server logs)
- Check frontend task list: low-res download NOT visible (only high-res task visible)

### 6. Low-Res Video Cleanup (AC6)

**Should:** After analysis completes (Path 2 — dual download), the low-res video file is deleted from `ANALYSIS_LLM_VIDEO_DIR`.

**Should not:** The high-res video file in `downloads/` should NOT be deleted.

**Verification:**
- Complete Path 2 analysis (dual download)
- Check `ANALYSIS_LLM_VIDEO_DIR` directory: low-res video file should be absent
- Check `downloads/` directory: high-res video file should still exist

### 7. One-Click AI Summary — 4 Behavior Branches (AC7, AC8, AC9, AC10, AC11)

**Should:** The "一键 AI 总结" button executes the correct branch based on video state:

| # | Video State | Button State | Expected API Call |
|---|---|---|---|
| 1 | Not in any queue | Clickable | `POST /api/analysis/trigger` with `{ bvid, cid }` — backend creates task + low-res sub-task if needed |
| 2 | In queue, downloading, auto_summary=false | Clickable | `POST /api/tasks/:id/auto-summary` with `{ enabled: true }` |
| 3 | In queue, downloaded, auto_summary=false | Clickable | `POST /api/analysis/trigger` with `{ bvid, cid }` — backend checks if low-res needed |
| 4 | In queue, auto_summary=true | Greyed out (disabled) | No API call on click |

**Should not:** Button should not be clickable when `auto_summary=true`. Button should not call the wrong API for the given state.

**Verification:**
- Test each of the 4 scenarios with a different video
- For branch 1: confirm `POST /api/analysis/trigger` called, task created
- For branch 2: confirm `POST /api/tasks/:id/auto-summary` called, `auto_summary` set to `1` in DB
- For branch 3: confirm `POST /api/analysis/trigger` called, analysis starts
- For branch 4: confirm button is disabled (greyed out), no network request on click

### 8. Low-Res Quality Selection (AC12)

**Should:** Low-res download selects the lowest available quality from the video's quality list.

**Should not:** Low-res download should not select a higher quality than necessary.

**Verification:**
- Trigger one-click AI summary on a multi-quality video
- Check server logs or `analysis_sub_task.quality` field — should be the lowest quality ID from available qualities
- Compare with `GET /api/video/parse?bvid=<bvid>&cid=<cid>` response quality list

### 9. Low-Res Concurrency Control (AC13)

**Should:** Low-res downloads have an independent concurrency limit (`MAX_CONCURRENT_LOW_RES_DOWNLOADS`, default 1). Low-res downloads do NOT occupy high-res download concurrency slots.

**Should not:** Low-res downloads should not consume `maxConcurrency` slots from the high-res scheduler.

**Verification:**
- Set `MAX_CONCURRENT_LOW_RES_DOWNLOADS=1` and `MAX_CONCURRENT_DOWNLOADS=2`
- Trigger 3 one-click AI summaries on multi-quality videos simultaneously
- Confirm: 2 high-res downloads run concurrently (filling `maxConcurrency=2`)
- Confirm: only 1 low-res download runs at a time (low-res concurrency = 1)
- Confirm: remaining low-res downloads queue and start as slots free up

### 10. No-Subtitle Analysis (AC14)

**Should:** When a video has no subtitles, analysis completes successfully using only the video file (no subtitle passed to LLM).

**Should not:** Analysis should not fail or return empty summary solely because subtitles are absent.

**Verification:**
- Download a video known to have no subtitles with `autoSummary: true`
- Confirm analysis completes: `summary_status = completed`, Markdown file generated
- Check server logs: no SRT parsing attempt, LLM user message contains only `video_url` content part

### 11. "Wait" Path Re-Trigger (AC3, AC5)

**Should:** When high-res download completes before low-res download, the trigger returns (waits). When low-res download completes, `analysisTriggerService.trigger(taskId)` is called again to re-check and proceed with analysis.

**Should not:** Analysis should not start until both high-res and low-res downloads are complete.

**Verification:**
- Trigger one-click AI summary on a multi-quality video
- Ensure high-res download completes first (e.g., high-res is faster or low-res is delayed)
- Check server logs: first trigger returns early (`analysis_sub_task.status != completed`)
- Check server logs: low-res completion calls trigger again, analysis proceeds
- Confirm `summary_status = completed` after both complete

### 12. Mutual Exclusion (AC7)

**Should:** A video already in one-click AI summary (auto_summary=true) cannot be added to the download queue separately. The frontend blocks the add-to-queue action.

**Should not:** A video with `auto_summary=false` in the queue should still allow the AI summary button to be clicked.

**Verification:**
- Add a video to queue with `autoSummary: true` (switch ON)
- Try to add the same video to queue again — confirm blocked (button disabled or error message)
- Add a video to queue with `autoSummary: false` (switch OFF) — confirm AI summary button is still clickable

### 13. Error Handling — API Responses (AC7)

**Should:** Error messages from API responses (404, 409, 502) are displayed to the user.

**Should not:** Errors should not be silently swallowed.

**Verification:**
- `POST /api/analysis/trigger` with non-existent bvid/cid — confirm 404 and error toast shows "task not found" message
- `POST /api/analysis/trigger` with a task that already has `auto_summary=true` — confirm 409 and error toast shows conflict message
- Simulate quality list fetch failure (e.g., invalid cookie) — confirm 502 and error toast shows upstream error

### 14. Compilation (AC15)

**Should:** `pnpm typecheck` and `pnpm build` pass with zero errors across all packages.

**Should not:** No new TypeScript errors or build failures introduced.

**Verification:**
- Run `pnpm typecheck` — zero errors
- Run `pnpm build` — zero errors

### 15. Summary Status State Machine

**Should:** `summary_status` transitions correctly: `none` (default) -> `pending` (triggered) -> `completed` (success) or `failed` (error). On low-res download failure, `summary_status` transitions to `failed` with error message.

**Should not:** `summary_status` should not remain `pending` indefinitely after analysis completes or fails.

**Verification:**
- Monitor `summary_status` through a full analysis cycle: `none` -> `pending` -> `completed`
- Trigger an analysis failure (e.g., invalid video path) — confirm `summary_status = failed` with error message in `summary_output`
- Trigger a low-res download failure — confirm `summary_status = failed`
