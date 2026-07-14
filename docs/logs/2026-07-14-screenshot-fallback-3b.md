# 2026-07-14 Screenshot Source Fallback (3b)

## Summary

Implemented screenshot source fallback resolver for analysis flow with priority:
1) remote best stream (bilibili),
2) completed local task from DB (quality >= 80),
3) synchronous re-download.

## Implemented

- Added `packages/server/src/analysis/screenshot-source-resolver.ts`:
  - `ScreenshotSourceResolver` interface
  - `DefaultScreenshotSourceResolver` implementation (`@Injectable()`)
  - local path short-circuit for `metadata.type=local`
  - bilibili fallback chain (remote -> DB -> re-download)
  - 10-minute timeout for sync re-download
- Updated `packages/server/src/analysis/analysis-engine.ts`:
  - constructor now accepts resolver dependency
  - `screenshotVideoPath` bypass implemented
  - resolver source used when bypass is absent
  - remote screenshot failure triggers local fallback for remaining time points
- Updated `packages/server/src/analysis/analysis.controller.ts`:
  - inject resolver and pass to `AnalysisEngine`
- Updated `packages/server/src/analysis/analysis.module.ts`:
  - import `DownloadModule`
  - register resolver provider
- Updated `packages/server/src/analysis/index.ts`:
  - export resolver interfaces and implementation
- Updated `packages/server/src/download/download.service.ts`:
  - added `resolveBestVideoStream(bvid, cid)` delegation method
- Updated `packages/server/src/download/download.module.ts`:
  - export `DownloadService`
- Updated `packages/server/src/database/database.service.ts`:
  - added `findCompletedTaskByBvidAndCid(bvid, cid)` returning full `TaskRecord`

## Verification

- `pnpm typecheck`: pass
- `pnpm build`: pass
- Runtime DI wiring:
  - Nest startup confirms `AnalysisModule` and `DownloadModule` initialized
  - `POST /api/analysis/run` returns 400 (non-500), confirming DI wiring path is healthy
- End-to-end remote/DB/re-download fallback scenarios were not executed in this environment due missing runtime prerequisites (valid bilibili cookies and prepared DB fixtures).

## Independent Review

- Independent subagent review (`Explore`) result: PASS
- One requirement-alignment issue found and fixed:
  - removed forced `outputPath: "analysis"` so re-download uses default `downloads/` location
- Remaining note:
  - full E2E fallback branches should be manually replayed when cookie/fixture prerequisites are available.
