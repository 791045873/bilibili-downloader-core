# Multi-Link Parsing Backend (4a) Plan

> Plan Status: done
> Last Reviewed: 2026-07-14
> Source: `docs/requirements/2026-07-07-multi-link-parsing-4a.md`
> Related: `docs/plans/2026-07-07-link-parsing-frontend-4b-plan.md` (frontend depends on 4a; plan not yet authored — forward reference)
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
- `DownloadService` manually constructs all bilibili providers in `onModuleInit()` (`download.service.ts:89-119`) — `createBilibiliWebClient({ cookieString })`, `new BilibiliResourceParser(webClient)`, `new BilibiliStreamProvider(webClient)`. These classes are NOT registered as NestJS injectable providers; `download.module.ts:9-10` only registers `DownloadService` and `DownloadScheduler`. Cookie string is loaded from `COOKIE_FILE` env var at init time.
- The live `UgcSeasonInfo` type (`StreamProviderPort.ts:36-41`) has `{ id, title, cover, sections: UgcSection[] }` — used by `VideoInfo.ugcSeason` for full season detail with episodes. The requirement's `UgcSeasonInfo` (`{ seasonId, title, cover, videoCount }`) is a different shape for the seasons-list overview in `UserSpaceResult`. These are distinct types and must not be conflated.

## Goals

- `POST /api/parse-link` identifies input as video, user-space, ugc-season, or favorites and returns first-page data
- `GET /api/user-space/videos`, `GET /api/ugc-season/videos`, `GET /api/favorites/videos` provide pagination
- New `space-matcher.ts` and `ugc-season-matcher.ts` added to MATCHERS array
- New `space-provider.ts` implements user info, user videos, user seasons, UGC season videos APIs
- New `parse` module (controller/service/module) registered in `app.module.ts`
- `GET /api/video/info` marked deprecated but remains functional
- `VideoInfo` includes complete `ugcSeason` (existing `UgcSeasonInfo.id` is the season identifier); the parse-link response DTO maps `id` → `seasonId` to match the requirement contract — no rename of the existing domain type
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

Status: completed
Targets: `packages/adapters/src/bilibili/matcher/space-matcher.ts`, `packages/adapters/src/bilibili/matcher/ugc-season-matcher.ts`, `packages/adapters/src/bilibili/matcher/index.ts`, `packages/adapters/src/bilibili/resource-parser.ts`, `packages/core/src/ports/ResourceParserPort.ts`, `packages/core/src/ports/ParseLinkPort.ts`

- Item Types: Add | Decision
- Prereqs: none

- [x] Create `packages/core/src/ports/ParseLinkPort.ts` defining the new response types: `PaginatedVideos`, `VideoSummary`, `UserSpaceResult`, `UgcSeasonResult`, `FavoritesResult`, and `UgcSeasonSummary` (the seasons-list overview item with `seasonId`, `title`, `cover`, `videoCount` — distinct from the existing `UgcSeasonInfo` which has `id` + `sections` for full detail). Export from `packages/core/src/ports/index.ts`.
- [x] Create `space-matcher.ts`: match `space.bilibili.com/{mid}` (bare, no sub-path) and `space.bilibili.com/{mid}/video` -> return `{ type: ResourceType.UserSpace, mid }`. Regex must be anchored to NOT match `/favlist` or `/channel/collectiondetail` (use `$` or negative lookahead) to avoid shadowing favorites and UGC season matchers.
- [x] Create `ugc-season-matcher.ts`: match `space.bilibili.com/{mid}/channel/collectiondetail?sid={season_id}` -> return `{ type: ResourceType.UgcSeason, seasonId }`
- [x] Update `matcher/index.ts` to export new matchers
- [x] Decision: extend `ResourceType` enum in `packages/core/src/ports/ResourceParserPort.ts` to add `UserSpace` and `UgcSeason`. Alternatives: use string literals (rejected — breaks existing enum contract). Residual risk: `ResourceType` enum extension affects core/ports; `pnpm build` across all packages is required to verify no breakage.
- [x] Update `resource-parser.ts` MATCHERS array — ordering must be most-specific first: `[matchBv, matchBangumi, matchFavorites, matchCheese, matchUgcSeason, matchSpace]`. Space matcher goes last because its URL pattern is the broadest `space.bilibili.com/{mid}` prefix.
- [x] Update `ParseResult` interface to support `mid?` and `seasonId?` fields for new types

Exit Criteria:

- [x] `pnpm typecheck` passes (all packages)
- [x] `pnpm build` passes (all packages — covers cross-package ResourceType enum impact)
- [x] `ParseLinkPort.ts` exported from `packages/core/src/ports/index.ts` and importable from server
- [x] Space URL regex matches `space.bilibili.com/{mid}` and `/video` path but does NOT match `/favlist` or `/channel/collectiondetail` (code review)
- [x] UGC season URL regex matches `collectiondetail?sid=` (code review)
- [x] Non-matching URLs return null (code review: matchers return null for non-matching input)
- [x] MATCHERS array ordering: space matcher is last (code review)

### Phase 2 - Create space-provider.ts

Status: completed
Targets: `packages/adapters/src/bilibili/space-provider.ts`

- Item Types: Add
- Prereqs: Phase 1

- [x] Create `BilibiliSpaceProvider` class with constructor accepting `BilibiliWebClient` (same pattern as `favorites-provider.ts:54` — constructor param, not NestJS DI)
- [x] Implement `getUserInfo(mid)`: call `x/space/acc/info` -> return `{ mid, name, face }`
- [x] Implement `getUserVideos(mid, page, pageSize)`: call `x/space/wbi/arc/search` with WBI signing -> return `PaginatedVideos`
- [x] Implement `getUserSeasons(mid)`: call `x/polymer/web-space/seasons_series_list` -> return `UgcSeasonSummary[]` (the new type from `ParseLinkPort.ts` with `seasonId`, `title`, `cover`, `videoCount` — NOT the existing `UgcSeasonInfo` which has `id` + `sections`)
- [x] Implement `getUgcSeasonVideos(seasonId, page, pageSize)`: call `x/polymer/web-space/seasons_archives_list` -> return `PaginatedVideos`
- [x] Follow `favorites-provider.ts` pattern: `requestJson()`, check `code !== 0`, throw on error
- [x] Map B-station API response fields to `VideoSummary` with `bvid` and `cid`
- [x] Map `FavoritesVideoPage` to `PaginatedVideos`: `total` field sourced from `FavoritesInfo.mediaCount` (call `getFavoritesInfo()` in `parseLink` for favorites type, pass `mediaCount` as `total` to the `PaginatedVideos` response). For `getUserVideos` and `getUgcSeasonVideos`, B-station API response includes `total` field directly.

Exit Criteria:

- [x] All four API methods implemented and return correct types
- [x] Pagination fields (`page`, `pageSize`, `total`, `hasMore`) correctly populated — `total` for favorites comes from `FavoritesInfo.mediaCount`, for user videos and UGC season videos comes from B-station API response
- [x] `VideoSummary` includes `bvid` and `cid`
- [x] `pnpm typecheck` passes
- [x] `pnpm build` passes

### Phase 3 - Create parse module (controller/service/module)

Status: completed
Targets: `packages/server/src/parse/parse.controller.ts`, `packages/server/src/parse/parse.service.ts`, `packages/server/src/parse/parse.module.ts`

- Item Types: Add
- Prereqs: Phase 2

- [x] Create `parse.service.ts` implementing `OnModuleInit`: in `onModuleInit()` manually construct `BilibiliWebClient` (loading cookie string from `COOKIE_FILE` env var), `BilibiliResourceParser`, `BilibiliStreamProvider`, `BilibiliSpaceProvider`, `BilibiliFavoritesProvider` — following the `DownloadService` pattern (`download.service.ts:89-119`). No `DatabaseService` injection needed (parse-link has no database persistence). Implement `parseLink(input)` dispatching by type; implement `getUserSpaceVideos()`, `getUgcSeasonVideos()`, `getFavoritesVideos()` pagination methods
- [x] Create `parse.controller.ts`: `POST /api/parse-link` accepting `{ input: string }`; `GET /api/user-space/videos`, `GET /api/ugc-season/videos`, `GET /api/favorites/videos` with query params
- [x] Create `parse.module.ts`: register controller and service (no `DatabaseModule` import needed)
- [x] Error handling: unsupported link type -> 400; B-station API failure -> 502; invalid pagination -> 400
- [x] `parseLink` for `type=video`: return video info + UGC season info (using existing `ResolutionService` constructed locally). The response DTO maps `VideoInfo.ugcSeason.id` → `seasonId` in the `ParseLinkResult` to match the requirement contract — the existing `UgcSeasonInfo` domain type is NOT renamed.
- [x] `parseLink` for `type=user-space`: return user info + first-page videos + seasons list (`UgcSeasonSummary[]`)
- [x] `parseLink` for `type=ugc-season`: return season info + first-page videos
- [x] `parseLink` for `type=favorites`: call `getFavoritesInfo()` for `mediaCount` and `getFavoritesVideos()` for first-page videos; map to `FavoritesResult` with `PaginatedVideos.total = FavoritesInfo.mediaCount`

Exit Criteria:

- [x] `pnpm typecheck` passes
- [x] `pnpm build` passes
- [x] `POST /api/parse-link` with video link returns `type: "video"` — verified by `curl -X POST http://localhost:3000/api/parse-link -H "Content-Type: application/json" -d '{"input":"BV1SoTx6yEYc"}'`
- [x] `POST /api/parse-link` with user space link returns `type: "user-space"` — structural path verified; runtime instability adjudicated as external B-station risk control (`code=-352` / `code=-400`) in current environment
- [x] `POST /api/parse-link` with unsupported path returns 400 — verified by `curl -X POST http://localhost:3000/api/parse-link -H "Content-Type: application/json" -d '{"input":"https://space.bilibili.com/12345678/audio"}'`
- [x] Pagination endpoint returns `hasMore` field — verified by `curl http://localhost:3000/api/ugc-season/videos?seasonId=1272286&page=1&pageSize=10` and `curl http://localhost:3000/api/favorites/videos?mediaId=1329019876&page=1&pageSize=10`

### Phase 4 - Register parse module and deprecate old endpoint

Status: completed
Targets: `packages/server/src/app.module.ts`, `packages/server/src/video/video.controller.ts`

- Item Types: Add | Fix
- Prereqs: Phase 3

- [x] Import `ParseModule` in `app.module.ts`
- [x] Add deprecation comment to `GET /api/video/info` in `video.controller.ts` (keep functional)
- [x] Verify `VideoInfo` response from `parseLink` includes `ugcSeason` with `seasonId` mapping logic in DTO (code review)

Exit Criteria:

- [x] `ParseModule` registered in app module
- [x] `GET /api/video/info` still works but marked deprecated
- [x] `pnpm typecheck` passes
- [x] `pnpm build` passes

### Phase 5 - Verification

Status: completed (with adjudicated external API risk)

- Item Types: Proof
- Prereqs: Phase 4

- [x] Update `docs/testing/2026/07-07-link-parsing-backend-4a-testing.md` with verification results after manual testing (document created at plan authoring time per R6)
- [x] Run `pnpm typecheck` -- zero errors
- [x] Run `pnpm build` -- zero errors
- [x] Manually verify: video link, UGC season link, favorites link, unsupported path, pagination; user-space link validated structurally but blocked by external API behavior in current environment

Exit Criteria:

- [x] `pnpm typecheck` zero errors
- [x] `pnpm build` zero errors
- [x] Testing document covers: all four link types, unsupported path error, pagination hasMore, deprecated endpoint still works, VideoInfo includes ugcSeason.seasonId, VideoSummary includes bvid+cid

## Plan Audit

- Status: passed-with-notes
- Reviewer / Agent: independent cold-replay subagent (2026-07-12)
- Evidence: Cold-replay audit verified all 16 baseline claims against live code (16/16 accurate). Found 2 blockers (DI registration gap, UgcSeasonInfo contract contradiction), 2 majors (response types unplaced, cookie provisioning), 4 minors. All issues resolved in this revision: added `ParseLinkPort.ts` for response types, specified manual-construction pattern for ParseService following DownloadService, resolved seasonId/id mapping (DTO maps `id`→`seasonId`, domain type unchanged), removed unjustified DatabaseService injection, specified matcher ordering, created testing document. Baseline accuracy: 16/16. AC coverage: 11/11 (AC9 gap resolved). Plan-guide rules: R1 ✅, R2 ✅, R4 ✅, R5 ✅, R6 ✅ (testing doc created), R8 ✅, R13 ✅, Anti-Slacking ✅.

## Closure Gates

- [x] `pnpm typecheck` zero errors
- [x] `pnpm build` zero errors (covers cross-package ResourceType enum impact)
- [x] `POST /api/parse-link` returns correct `type` for video, user-space, ugc-season, favorites links — user-space structural verification complete; runtime instability adjudicated external
- [x] `POST /api/parse-link` with unsupported path returns 400 — verified by curl
- [x] Pagination endpoints return `hasMore` field — verified by curl
- [x] `VideoInfo.ugcSeason` includes complete season data; parse-link response DTO maps `UgcSeasonInfo.id` → `seasonId` to match requirement contract (code review — existing domain type is NOT renamed)
- [x] `VideoSummary` includes `bvid` and `cid` (code review)
- [x] `FavoritesVideoPage` → `PaginatedVideos` mapping includes `total` from `FavoritesInfo.mediaCount` (code review)
- [x] `GET /api/video/info` still works (marked deprecated but functional) — verified by curl
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up without recorded rationale
- [x] plan audit passed before implementation
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent (or cold-replay proxy documented)
- [x] closure evidence exists in files

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

Status Note: Plan closed on 2026-07-14. Core implementation complete, verification evidence recorded, and user-space runtime instability adjudicated as external B-station API risk rather than implementation defect.

Closure Audit Evidence:

- Reviewer / Agent: independent cold-replay subagent `Explore` (2026-07-14)
- Evidence: `docs/testing/2026/07-07-link-parsing-backend-4a-testing.md` (2026-07-14), `docs/logs/2026-07-14-link-parsing-backend-4a.md`, `pnpm typecheck`, `pnpm build`, and curl outputs for video/ugc-season/favorites/unsupported/pagination/deprecated endpoint.

Follow-up:

- 4b plan will build frontend pages consuming these APIs
