# Screenshot Remote Support (3a) Plan

> Plan Status: planned
> Last Reviewed: 2026-07-11
> Source: `docs/requirements/2026-07-07-screenshot-source-fallback-3a.md`
> Related: `docs/plans/2026-07-07-screenshot-fallback-3b-plan.md` (depends on 3a)
> Audit: required
> Testing: `docs/testing/2026/07-07-screenshot-remote-3a-testing.md`

Note: Originally classified as micro-plan exception. Reclassified as Audit: required after audit identified two blocking issues (B1: probeVideoDuration throws on remote URL; B2: no reliable verification path for headers without test URL). The fix scope expands to cover ffprobe error handling, exceeding the micro-plan spirit even if still under 200 lines.

## Current Baseline

- `packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts` exports `ScreenshotParams` with `videoPath: string`, `timePoints: number[]`, `outputDir: string`, `filenamePrefix?: string`
- `takeScreenshots()` calls `getVideoDuration(videoPath)` first, then `screenshotFrame()` for each time point
- `probeVideoDuration()` calls ffprobe; on failure it calls `reject()` — exception propagates uncaught through `takeScreenshots()`
- ffprobe args do not include headers; will fail on B-station CDN URLs that require Referer
- `screenshotFrame()` returns `Promise<boolean>` — already handles failure gracefully (returns false on non-zero exit or spawn error)
- No `headers` parameter in `ScreenshotParams`
- `videoPath` is only used as a local file path; no HTTP URL support

## Goals

- `ScreenshotParams` includes optional `headers?: Record<string, string>` field
- `FfmpegScreenshot` accepts HTTP URL as `videoPath` and passes `-headers` parameter to ffmpeg
- `probeVideoDuration()` on remote URL: ffprobe is called with same headers; if it fails, `takeScreenshots()` skips the duration check and proceeds (time-over-duration guard is disabled for remote sources)
- Local file path behavior is unchanged (headers ignored; ffprobe without headers as before)
- Remote screenshot failure returns false, does not throw

## Non-Goals

- Do not implement ScreenshotSourceResolver (3b plan)
- Do not implement fallback/degradation strategy
- Do not change AnalysisEngine
- Do not change screenshot time-point calculation logic

## Infrastructure And Config Prereqs

- No infra prereqs beyond existing baseline
- ffmpeg/ffprobe must be installed and in PATH (already required by existing code)
- Verification script requires server to be running (or `DownloadService` initialised) to call `BilibiliStreamProvider`
- Test video: `https://www.bilibili.com/video/BV1SoTx6yEYc` (BV1SoTx6yEYc), screenshot at t=5s

## Execution Plan

### Phase 1 - Add headers support, HTTP URL detection, and ffprobe error handling

Status: planned
Targets: `packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts`

- Item Types: Add | Fix
- Prereqs: none

- [ ] Add `headers?: Record<string, string>` to `ScreenshotParams` interface
- [ ] Detect if `videoPath` starts with `http://` or `https://` to determine remote mode
- [ ] When remote and `headers` provided: construct ffmpeg `-headers` arg string (`"Key: value\r\n"` joined), inserted before `-i` in ffmpeg args
- [ ] When remote and `headers` provided: also add `-headers` to ffprobe args in `probeVideoDuration()` call
- [ ] Fix: wrap `getVideoDuration()` call in `takeScreenshots()` with try/catch; if remote URL and ffprobe fails, skip duration check (set `videoDuration = Infinity` so the `time > videoDuration` guard never skips frames)
- [ ] When local: ignore `headers`; ffprobe and ffmpeg behave identically to before

Decision: Use `Infinity` as duration fallback for remote URLs rather than a configurable timeout, because the purpose of the duration check is to skip frames past end-of-file — for remote URLs, the downside of skipping the check is only that ffmpeg may try an impossible timestamp and fail (which `screenshotFrame()` already handles by returning false).

Exit Criteria:

- [ ] Local path screenshots work identically to before (no regression) — verified by `pnpm typecheck` + `pnpm build` + code review that local branch is unchanged
- [ ] HTTP URL code path: `takeScreenshots()` does not throw even when ffprobe fails on remote URL — verified by code review that the try/catch is in place
- [ ] HTTP URL code path: ffmpeg command args contain `-headers` when headers provided — verified by code review of args construction
- [ ] HTTP URL code path: ffprobe args contain `-headers` when headers provided — verified by code review of args construction
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

Note: "code review" as verification method is valid here because the behavior is deterministic from the code structure. No external service call needed to confirm the args array is constructed correctly.

### Phase 2 - Verification

Status: planned

- Item Types: Proof
- Prereqs: Phase 1

- [ ] Create/update `docs/testing/2026/07-07-screenshot-remote-3a-testing.md` with requirement-level testing directions
- [ ] Run `pnpm typecheck` — zero errors
- [ ] Run `pnpm build` — zero errors
- [ ] Code review: confirm local branch unchanged (no headers, no try/catch)
- [ ] Code review: confirm remote branch adds -headers to ffmpeg args and ffprobe args when headers provided
- [ ] Code review: confirm try/catch wraps getVideoDuration in takeScreenshots and falls back to Infinity
- [ ] Run verification script (inline, not committed): use BilibiliStreamProvider to resolve BV1SoTx6yEYc (https://www.bilibili.com/video/BV1SoTx6yEYc), select lowest quality video stream URL, call takeScreenshots() with timePoints=[5], headers={Referer: "https://www.bilibili.com"}, assert outputFiles.length > 0 and each file exists with size > 0 — script prints PASS or FAIL and exits. Script and output screenshot files are deleted after verification.
- [ ] Human final review at Closure: re-run verification script or confirm screenshot files were produced during Phase 2 run.

Exit Criteria:

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] Code review confirms local path unchanged, remote branch adds -headers to ffmpeg and ffprobe args, try/catch is in place
- [ ] Verification script exits PASS (outputFiles non-empty, files exist with size > 0)
- [ ] Testing document covers: local path no regression, HTTP URL args construction, headers in ffprobe, ffprobe failure handling, remote live CDN screenshot PASS confirmed

## Plan Audit

- Status: pending
- Reviewer / Agent: independent subagent or cold-replay proxy
- Evidence: TBD

## Closure Gates

- [ ] in-scope behavior is complete
- [ ] relevant docs are aligned
- [ ] verification has run (`pnpm typecheck` and `pnpm build`)
- [ ] verification script exited PASS: real B-station URL screenshot produced non-empty outputFiles with files of size > 0
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred/follow-up without recorded rationale
- [ ] plan audit passed before implementation
- [ ] text consistency verified: status, phases, gates, testing document, and log all agree
- [ ] closure audit was independent (or cold-replay proxy documented)
- [ ] closure evidence exists in files

## Deferred But Adjudicated

### ScreenshotSourceResolver

- Classification: out-of-scope improvement
- Why Not Blocking Closure: Resolver and fallback strategy are owned by `2026-07-07-screenshot-fallback-3b-plan.md`. This plan only provides the adapter-layer capability.
- Successor Required: yes (3b plan)

## Closure

Status Note: Plan not yet started.

Closure Audit Evidence:

- Reviewer / Agent: TBD
- Evidence: TBD

Follow-up:

- 3b plan will consume this capability for the ScreenshotSourceResolver remote fallback path and provide live CDN integration verification
