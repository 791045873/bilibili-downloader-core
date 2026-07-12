# Multi-Link Parsing Backend (4a) Plan

> Plan Status: planned
> Last Reviewed: 2026-07-07
> Source: `docs/requirements/2026-07-07-multi-link-parsing-4a.md`
> Related: `docs/plans/2026-07-07-link-parsing-frontend-4b-plan.md` (frontend depends on 4a)
> Audit: required
> Testing: `docs/testing/2026/07-07-link-parsing-backend-4a-testing.md`

## Current Baseline

- `packages/adapters/src/bilibili/resource-parser.ts` has `MATCHERS = [matchBv, matchBangumi, matchFavorites, matchCheese]` -- no space or UGC season matcher
- `packages/adapters/src/bilibili/matcher/favorites-matcher.ts` matches `space.bilibili.com/{uid}/favlist?fid={id}` -- already exists and works
- `packages/adapters/src/bilibili/favorites-provider.ts` implements `BilibiliFavoritesProvider` with `getFavoritesInfo()` and `getFavoritesVideos()` -- already exists with pagination
- `FavoritesVideoPage` (in `FavoritesProviderPort.ts:31`) has `videos: FavoritesVideo[]` and `hasMore: boolean` only — no `page`, `pageSize`, `total` fields
- `FavoritesInfo` (in `FavoritesProviderPort.ts:24`) has `mediaCount: number` — can be used as `total` in `PaginatedVideos`
- `UgcSeasonInfo` (in `StreamProviderPort.ts:36`) has `id: number` (not `seasonId`), `title`, `cover`, `sections: UgcSection[]` — the season identifier is `id`, not `seasonId`
- `BilibiliWebClient` provides `requestJson()` and `requestText()` with cookie support
- `wbiSign()` is available for WBI-signed API calls
- `BilibiliStreamProvider` has `getVideoInfo()` which returns `ugcSeason` with sections and episodes — UGC season data already fetchable via video info API
- No `space-provider.ts` exists -- no user space, user videos, user seasons, or UGC season video list API
- No `space-matcher.ts` or `ugc-season-matcher.ts` exists
- `packages/server/src/video/video.controller.ts` has `GET /api/video/info` -- no `POST /api/parse-link` endpoint
- No `parse` module (controller/service/module) exists in server
- `app.module.ts` imports `DatabaseModule`, `DownloadModule`, `AnalysisModule` -- no parse module
- `DownloadModule` registers `DownloadController`, `VideoController`, `AuthController` and provides `DownloadService`, `DownloadScheduler`
- `DownloadService` has `getVideoInfo()` using `ResolutionService.resolve()` and `parseVideo()` using `resourceParser.parse()` + `resolutionService.resolveStreams()`

## Goals

- `POST /api/parse-link` identifies input as video, user-space, ugc-season, or favorites and returns first-page data
- `GET /api/user-space/videos`, `GET /api/ugc-season/videos`, `GET /api/favorites/videos` provide pagination
- New `space-matcher.ts` and `ugc-season-matcher.ts` added to MATCHERS array
- New `space-provider.ts` implements user info, user videos, user seasons, UGC season videos APIs
- New `parse` module (controller/service/module) registered in `app.module.ts`
- `GET /api/video/info` marked deprecated but remains functional
- `VideoInfo` includes complete `ugcSeason` with `seasonId`
- `VideoSummary` includes `bvid` and `cid`

## Non-Goals

- Do not implement frontend pages (4b plan)
- Do not implement video analysis
- Do not implement POST request B-station API support (all new APIs are GET)
- Do not implement favorites video UGC season association
- Do not remove `GET /api/video/info` (keep as deprecated fallback)

## Infrastructure And Config Prereqs

- B-station API access requires valid cookies (`COOKIE_FILE` env var)
- `BilibiliWebClient` must be initialized with cookie string
- WBI signing required for `x/space/wbi/arc/search` endpoint
- `BILI_API_BASE` constant already defined in `packages/adapters/src/bilibili/constants.ts`

## Execution Plan

### Phase 1 - Add space-matcher and ugc-season-matcher

Status: planned
Targets: `packages/adapters/src/bilibili/matcher/space-matcher.ts`, `packages/adapters/src/bilibili/matcher/ugc-season-matcher.ts`, `packages/adapters/src/bilibili/matcher/index.ts`, `packages/adapters/src/bilibili/resource-parser.ts`, `packages/core/src/ports/ResourceParserPort.ts`

- Item Types: Add | Decision
- Prereqs: none

- [ ] Create `space-matcher.ts`: match `space.bilibili.com/{mid}` and `space.bilibili.com/{mid}/video` -> return `{ type: ResourceType.UserSpace, mid }`
- [ ] Create `ugc-season-matcher.ts`: match `space.bilibili.com/{mid}/channel/collectiondetail?sid={season_id}` -> return `{ type: ResourceType.UgcSeason, seasonId }`
- [ ] Update `matcher/index.ts` to export new matchers
- [ ] Decision: extend `ResourceType` enum in `packages/core/src/ports/ResourceParserPort.ts` to add `UserSpace` and `UgcSeason`. Alternatives: use string literals (rejected — breaks existing enum contract). Residual risk: `ResourceType` enum extension affects core/ports; `pnpm build` across all packages is required to verify no breakage.
- [ ] Update `resource-parser.ts` MATCHERS array to include new matchers
- [ ] Update `ParseResult` interface to support `mid?` and `seasonId?` fields for new types

Exit Criteria:

- [ ] `pnpm typecheck` passes (all packages)
- [ ] `pnpm build` passes (all packages — covers cross-package ResourceType enum impact)
- [ ] Space URL regex matches correctly (code review: regex pattern matches `space.bilibili.com/{mid}` and `/video` path)
- [ ] UGC season URL regex matches correctly (code review: regex pattern matches `collectiondetail?sid=`)
- [ ] Non-matching URLs return null (code review: matchers return null for non-matching input)

### Phase 2 - Create space-provider.ts

Status: planned
Targets: `packages/adapters/src/bilibili/space-provider.ts`

- Item Types: Add
- Prereqs: Phase 1

- [ ] Create `BilibiliSpaceProvider` class injecting `BilibiliWebClient`
- [ ] Implement `getUserInfo(mid)`: call `x/space/acc/info` -> return `{ mid, name, face }`
- [ ] Implement `getUserVideos(mid, page, pageSize)`: call `x/space/wbi/arc/search` with WBI signing -> return `PaginatedVideos`
- [ ] Implement `getUserSeasons(mid)`: call `x/polymer/web-space/seasons_series_list` -> return `UgcSeasonInfo[]`
- [ ] Implement `getUgcSeasonVideos(seasonId, page, pageSize)`: call `x/polymer/web-space/seasons_archives_list` -> return `PaginatedVideos`
- [ ] Follow `favorites-provider.ts` pattern: `requestJson()`, check `code !== 0`, throw on error
- [ ] Map B-station API response fields to `VideoSummary` with `bvid` and `cid`
- [ ] Map `FavoritesVideoPage` to `PaginatedVideos`: `total` field sourced from `FavoritesInfo.mediaCount` (call `getFavoritesInfo()` in `parseLink` for favorites type, pass `mediaCount` as `total` to the `PaginatedVideos` response). For `getUserVideos` and `getUgcSeasonVideos`, B-station API response includes `total` field directly.

Exit Criteria:

- [ ] All four API methods implemented and return correct types
- [ ] Pagination fields (`page`, `pageSize`, `total`, `hasMore`) correctly populated — `total` for favorites comes from `FavoritesInfo.mediaCount`, for user videos and UGC season videos comes from B-station API response
- [ ] `VideoSummary` includes `bvid` and `cid`
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

### Phase 3 - Create parse module (controller/service/module)

Status: planned
Targets: `packages/server/src/parse/parse.controller.ts`, `packages/server/src/parse/parse.service.ts`, `packages/server/src/parse/parse.module.ts`

- Item Types: Add
- Prereqs: Phase 2

- [ ] Create `parse.service.ts`: inject `BilibiliResourceParser`, `BilibiliStreamProvider`, `BilibiliSpaceProvider`, `BilibiliFavoritesProvider`, `DatabaseService`; implement `parseLink(input)` dispatching by type; implement `getUserSpaceVideos()`, `getUgcSeasonVideos()`, `getFavoritesVideos()` pagination methods
- [ ] Create `parse.controller.ts`: `POST /api/parse-link` accepting `{ input: string }`; `GET /api/user-space/videos`, `GET /api/ugc-season/videos`, `GET /api/favorites/videos` with query params
- [ ] Create `parse.module.ts`: register controller and service, import `DatabaseModule`
- [ ] Error handling: unsupported link type -> 400; B-station API failure -> 502; invalid pagination -> 400
- [ ] `parseLink` for `type=video`: return video info + UGC season info (using existing `ResolutionService.resolve()`). `VideoInfo.ugcSeason.id` is the season identifier — frontend uses this as `seasonId`.
- [ ] `parseLink` for `type=user-space`: return user info + first-page videos + seasons list
- [ ] `parseLink` for `type=ugc-season`: return season info + first-page videos
- [ ] `parseLink` for `type=favorites`: call `getFavoritesInfo()` for `mediaCount` and `getFavoritesVideos()` for first-page videos; map to `FavoritesResult` with `PaginatedVideos.total = FavoritesInfo.mediaCount`

Exit Criteria:

- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] `POST /api/parse-link` with video link returns `type: "video"` — verified by `curl -X POST http://localhost:3000/api/parse-link -H "Content-Type: application/json" -d '{"input":"BV1SoTx6yEYc"}'`
- [ ] `POST /api/parse-link` with user space link returns `type: "user-space"` — verified by `curl -X POST http://localhost:3000/api/parse-link -H "Content-Type: application/json" -d '{"input":"https://space.bilibili.com/12345678"}'`
- [ ] `POST /api/parse-link` with unsupported path returns 400 — verified by `curl -X POST http://localhost:3000/api/parse-link -H "Content-Type: application/json" -d '{"input":"https://space.bilibili.com/12345678/audio"}'`
- [ ] Pagination endpoint returns `hasMore` field — verified by `curl http://localhost:3000/api/user-space/videos?mid=12345678&page=1&pageSize=10`

### Phase 4 - Register parse module and deprecate old endpoint

Status: planned
Targets: `packages/server/src/app.module.ts`, `packages/server/src/video/video.controller.ts`

- Item Types: Add | Fix
- Prereqs: Phase 3

- [ ] Import `ParseModule` in `app.module.ts`
- [ ] Add deprecation comment to `GET /api/video/info` in `video.controller.ts` (keep functional)
- [ ] Verify `VideoInfo` response from `parseLink` includes `ugcSeason` with `seasonId`

Exit Criteria:

- [ ] `ParseModule` registered in app module
- [ ] `GET /api/video/info` still works but marked deprecated
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

### Phase 5 - Verification

Status: planned

- Item Types: Proof
- Prereqs: Phase 4

- [ ] Create/update `docs/testing/2026/07-07-link-parsing-backend-4a-testing.md` with requirement-level testing directions
- [ ] Run `pnpm typecheck` -- zero errors
- [ ] Run `pnpm build` -- zero errors
- [ ] Manually verify: video link, user space link, UGC season link, favorites link, unsupported path, pagination

Exit Criteria:

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] Testing document covers: all four link types, unsupported path error, pagination hasMore, deprecated endpoint still works, VideoInfo includes ugcSeason.seasonId, VideoSummary includes bvid+cid

## Plan Audit

- Status: pending
- Reviewer / Agent: TBD (independent subagent or reviewer)
- Evidence: TBD

## Closure Gates

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors (covers cross-package ResourceType enum impact)
- [ ] `POST /api/parse-link` returns correct `type` for video, user-space, ugc-season, favorites links — verified by curl
- [ ] `POST /api/parse-link` with unsupported path returns 400 — verified by curl
- [ ] Pagination endpoints return `hasMore` field — verified by curl
- [ ] `VideoInfo.ugcSeason.id` is accessible as the season identifier (code review confirms `UgcSeasonInfo.id` is the season ID; requirement doc's `seasonId` maps to this field)
- [ ] `VideoSummary` includes `bvid` and `cid` (code review)
- [ ] `FavoritesVideoPage` → `PaginatedVideos` mapping includes `total` from `FavoritesInfo.mediaCount` (code review)
- [ ] `GET /api/video/info` still works (marked deprecated but functional) — verified by curl
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred/follow-up without recorded rationale
- [ ] plan audit passed before implementation
- [ ] text consistency verified: status, phases, gates, testing document, and log all agree
- [ ] closure audit was independent (or cold-replay proxy documented)
- [ ] closure evidence exists in files

## Deferred But Adjudicated

### Favorites video UGC season association

- Classification: out-of-scope improvement
- Why Not Blocking Closure: Requirement explicitly excludes associating favorites videos with UGC seasons
- Successor Required: no

### POST request B-station API support

- Classification: out-of-scope improvement
- Why Not Blocking Closure: All new B-station APIs are GET requests
- Successor Required: no

## Closure

Status Note: Plan not yet started. Closure requires four link type parsing, three pagination endpoints, space-provider APIs, parse module registration, and old endpoint deprecation all verified.

Closure Audit Evidence:

- Reviewer / Agent: TBD
- Evidence: TBD

Follow-up:

- 4b plan will build frontend pages consuming these APIs
