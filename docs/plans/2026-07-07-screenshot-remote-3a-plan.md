# Screenshot Remote Support (3a) Plan

> Plan Status: in-progress
> Last Reviewed: 2026-07-13
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
- Verification script requires valid B-station cookies (`COOKIE_FILE` env var or cookie string) to call `BilibiliStreamProvider.getPlayStreams()`
- Verification script requires server to be running (or `DownloadService` initialised) to call `BilibiliStreamProvider`
- Test video: `https://www.bilibili.com/video/BV1SoTx6yEYc` (BV1SoTx6yEYc), screenshot at t=5s
- Note: ffmpeg spawn for remote URLs does not set a process timeout; if the CDN URL is expired or returns 403, ffmpeg may hang. Verification script should use a freshly-resolved URL and may add a process timeout wrapper.

## Execution Plan

### Phase 1 - Add headers support, HTTP URL detection, and ffprobe error handling

Status: completed
Targets: `packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts`

- Item Types: Add | Fix
- Prereqs: none

- [x] Add `headers?: Record<string, string>` to `ScreenshotParams` interface
- [x] Detect if `videoPath` starts with `http://` or `https://` to determine remote mode
- [x] When remote and `headers` provided: construct ffmpeg `-headers` arg string (`"Key: value\r\n"` joined), inserted before `-i` in ffmpeg args
- [x] When remote and `headers` provided: also add `-headers` to ffprobe args in `probeVideoDuration()` call
- [x] Fix: wrap `getVideoDuration()` call in `takeScreenshots()` with try/catch; if remote URL and ffprobe fails, skip duration check (set `videoDuration = Infinity` so the `time > videoDuration` guard never skips frames)
- [x] When local: ignore `headers`; ffprobe and ffmpeg behave identically to before
- [x] Decision: Use `Infinity` as duration fallback for remote URLs rather than a configurable timeout. Rationale: the duration check's purpose is to skip frames past end-of-file — for remote URLs, skipping the check only means ffmpeg may try an impossible timestamp and fail (which `screenshotFrame()` already handles by returning false). Alternatives: configurable timeout (rejected — adds config surface for marginal benefit). Residual risk: ffmpeg may attempt out-of-range timestamps on remote URLs, but `screenshotFrame()` returns false gracefully.

Exit Criteria:

- [x] Local path screenshots work identically to before (no regression) — verified by `pnpm typecheck` + `pnpm build` + code review that local branch is unchanged
- [x] HTTP URL code path: `takeScreenshots()` does not throw even when ffprobe fails on remote URL — verified by code review that the try/catch is in place
- [x] HTTP URL code path: ffmpeg command args contain `-headers` when headers provided — verified by code review of args construction
- [x] HTTP URL code path: ffprobe args contain `-headers` when headers provided — verified by code review of args construction
- [x] `pnpm typecheck` passes
- [x] `pnpm build` passes

Note: "code review" as verification method is valid here because the behavior is deterministic from the code structure. No external service call needed to confirm the args array is constructed correctly.

### Phase 2 - Verification

Status: in-progress
- Item Types: Proof
- Prereqs: Phase 1

- [x] Create/update `docs/testing/2026/07-07-screenshot-remote-3a-testing.md` with requirement-level testing directions
- [x] Run `pnpm typecheck` — zero errors
- [x] Run `pnpm build` — zero errors
- [x] Code review: confirm local branch unchanged (no headers, no try/catch)
- [x] Code review: confirm remote branch adds -headers to ffmpeg args and ffprobe args when headers provided
- [x] Code review: confirm try/catch wraps getVideoDuration in takeScreenshots and falls back to Infinity
- [ ] Run verification script (inline, not committed): use `BilibiliStreamProvider.getVideoInfo("BV1SoTx6yEYc")` to obtain `cid` from `pages[0]`, then `getPlayStreams({bvid, cid, resourceType: ResourceType.Video, cookieString})` to resolve stream URL, select lowest quality video stream URL, call `takeScreenshots()` with `timePoints=[5]`, `headers={Referer: "https://www.bilibili.com"}`, assert `outputFiles.length > 0` and each file exists with size > 0 — script prints PASS or FAIL and exits. Script and output screenshot files are deleted after verification.
- [ ] Human final review at Closure: re-run verification script or confirm screenshot files were produced during Phase 2 run.

Exit Criteria:

- [x] `pnpm typecheck` zero errors
- [x] `pnpm build` zero errors
- [x] Code review confirms local path unchanged, remote branch adds -headers to ffmpeg and ffprobe args, try/catch is in place
- [ ] Verification script exits PASS (outputFiles non-empty, files exist with size > 0) — deferred: requires B站 cookies not available in current environment
- [ ] Testing document covers: local path no regression, HTTP URL args construction, headers in ffprobe, ffprobe failure handling, remote live CDN screenshot PASS confirmed (directions 1-4 verified by code review; direction 5 pending)
- [x] `docs/logs/` updated with current implementation and verification status

## Plan Audit

- Status: passed (cold-replay proxy, reviewer availability = none)
- Reviewer / Agent: 独立 subagent cold-replay（General_5222089）
- Evidence:
  - Baseline 准确性: 7/7 ✅（ffmpeg-screenshot.ts live 代码逐条核对）
  - AC 覆盖: 5/5 covered（AC1-5 全部被 exit criteria 覆盖）
  - 依赖方向: 3b depends on 3a，方向正确 ✅
  - 发现 6 个 minor（无 blocker/major）：testing 文档缺失（R6，已创建）、Cookie 前置条件未声明（已补入 Infrastructure）、cid 获取步骤缺失（已补入验证脚本）、Decision 项格式（已改为 checkbox）、docs/logs/ 更新步骤（已加入 Phase 2 exit criteria）、ffmpeg 超时风险（已加备注）
  - 3a 涉及 integration 行为（HTTP URL + CDN headers）但非 protected area，符合 cold-replay 适用条件

## Closure Gates

- [x] in-scope implementation is complete
- [x] relevant docs are aligned with the current open status
- [x] verification has run (`pnpm typecheck` and `pnpm build`)
- [ ] verification script exited PASS: real B-station URL screenshot produced non-empty outputFiles with files of size > 0
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed (directions 1-4 verified by code review; direction 5 pending)
- [x] no in-scope item downgraded to deferred/follow-up without recorded rationale
- [x] plan audit passed before implementation
- [ ] text consistency verified for final closure
- [ ] closure audit completed after all verification gates pass
- [ ] final closure evidence exists in files

## Deferred But Adjudicated

### ScreenshotSourceResolver

- Classification: out-of-scope improvement
- Why Not Blocking Closure: Resolver and fallback strategy are owned by `2026-07-07-screenshot-fallback-3b-plan.md`. This plan only provides the adapter-layer capability.
- Successor Required: yes (3b plan)

### Live CDN screenshot verification (testing direction #5)

- Classification: blocking verification prerequisite
- Why Blocking Closure: The plan explicitly requires a live B-station CDN screenshot with headers. Valid B站 cookies (`COOKIE_FILE` or cookie string) are not available in the current environment, so this gate remains open.
- Resolution Required: run the Phase 2 verification script with valid cookies, then perform the final closure audit.

## Closure

Status Note: Implementation complete but plan remains open. `ScreenshotParams` supports `headers` and HTTP URL input; ffmpeg/ffprobe args include `-headers` for remote sources; ffprobe failure on remote URLs falls back to `Infinity`; screenshot success now requires a real, non-empty output file. Live CDN verification is still pending valid B站 cookies.

Closure Audit Evidence:

- Reviewer / Agent: pending after live CDN verification
- Current evidence:
  - Code review: local paths ignore headers; remote paths add `-headers` before `-i` in ffmpeg and before the URL in ffprobe; remote probe failure falls back to `Infinity`
  - Screenshot success requires `stat(outputPath)` to confirm a file with `size > 0`
  - `pnpm typecheck` and `pnpm build` passed after the output validation fix on 2026-07-13
  - Testing doc exists at `docs/testing/2026/07-07-screenshot-remote-3a-testing.md`; directions 1-4 reviewed, direction 5 pending
  - Log recorded at `docs/logs/2026-07-13-screenshot-remote-3a.md`

Follow-up:

- Run Phase 2 live CDN verification with valid B站 cookies
- After all gates pass, perform a separate cold-replay closure audit and only then mark the plan and backlog item completed
