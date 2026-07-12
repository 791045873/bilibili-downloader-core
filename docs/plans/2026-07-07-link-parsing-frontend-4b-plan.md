# Multi-Link Parsing Frontend (4b) Plan

> Plan Status: planned
> Last Reviewed: 2026-07-07
> Source: `docs/requirements/2026-07-07-multi-link-parsing-4b.md`
> Related: `docs/plans/2026-07-07-link-parsing-backend-4a-plan.md` (dependency)
> Audit: required
> Testing: `docs/testing/2026/07-07-link-parsing-frontend-4b-testing.md`

## Current Baseline

- `packages/frontend/src/views/Home.vue` has a single input form; placeholder is `"BV号 / AV号 / B站视频链接..."`; submit navigates to `{ name: "video", query: { input } }` (i.e., `VideoDetail.vue`)
- `packages/frontend/src/router/index.ts` has 5 routes: `/`, `/video`, `/downloading`, `/settings`, `/login` -- no `/parse-result` routes
- `packages/frontend/src/api/index.ts` has `getVideoInfo()`, `parseVideo()`, `parseAllVideos()`, `createDownload()`, `checkTasks()`, etc. -- no `parseLink()` or pagination API calls
- `packages/frontend/src/types/index.ts` has `VideoInfo`, `VideoPage`, `UgcSeasonInfo`, `UgcSection`, `UgcEpisode`, `TaskEntry`, `ParseResultItem` -- no `ParseLinkResult`, `PaginatedVideos`, `VideoSummary`, `UserSpaceResult`, `UgcSeasonResult`, `FavoritesResult` types
- `VideoDetail.vue` exists and handles single video detail with quality selection, subtitle download, and "add to queue" -- referenced as the interaction pattern to follow
- No `ParseResult.vue` or `ParseResultList.vue` exists

## Goals

- New overview page `ParseResult.vue` at `/parse-result?input=xxx` displays user-space results (user info + video group entries)
- New list page `ParseResultList.vue` at `/parse-result/list?type=xxx&...` displays video cards with pagination, selection, batch add to queue, AI summary entry
- `Home.vue` placeholder updated and submit navigates to `/parse-result?input=xxx`
- Router has new `/parse-result` and `/parse-result/list` routes
- `api/index.ts` has `parseLink()` and pagination API calls
- `types/index.ts` has all new type definitions
- List page items are per-page (fen P), with visual grouping for multi-page videos
- Already-queued items marked and non-selectable
- AI summary operation entry present on list page

## Non-Goals

- Do not implement backend APIs (4a plan)
- Do not implement AI summary functionality itself (5b plan)
- Do not change existing `VideoDetail.vue` functionality
- Do not remove `VideoDetail.vue` (kept as fallback)

## Infrastructure And Config Prereqs

- 4a plan must be completed first (backend APIs available)
- Frontend dev server and Vite build already configured
- No new env vars or external services

## Execution Plan

### Phase 1 - Add types and API calls

Status: planned
Targets: `packages/frontend/src/types/index.ts`, `packages/frontend/src/api/index.ts`

- Item Types: Add
- Prereqs: 4a completed

- [ ] Add types: `ParseLinkResult`, `PaginatedVideos`, `VideoSummary`, `UserSpaceResult`, `UgcSeasonResult`, `FavoritesResult`, `UgcSeasonInfoSimple` (with `seasonId`, `title`, `cover`, `videoCount`)
- [ ] Add `parseLink(input: string): Promise<ParseLinkResult>` to `api/index.ts`
- [ ] Add `getUserSpaceVideos(mid, page, pageSize)`, `getUgcSeasonVideos(seasonId, page, pageSize)`, `getFavoritesVideos(mediaId, page, pageSize)` to `api/index.ts`

Exit Criteria:

- [ ] All types defined matching backend response shapes
- [ ] API functions call correct endpoints
- [ ] `pnpm typecheck` passes

### Phase 2 - Add routes and update Home.vue

Status: planned
Targets: `packages/frontend/src/router/index.ts`, `packages/frontend/src/views/Home.vue`

- Item Types: Add | Fix
- Prereqs: Phase 1

- [ ] Add routes: `/parse-result` (name: `parse-result`, component: `ParseResult.vue`), `/parse-result/list` (name: `parse-result-list`, component: `ParseResultList.vue`)
- [ ] Update `Home.vue` placeholder to support multi-link types (e.g., "BV号 / 视频链接 / 用户空间 / 合集 / 收藏夹链接...")
- [ ] Update `Home.vue` submit to navigate to `{ name: 'parse-result', query: { input } }`

Exit Criteria:

- [ ] Routes registered and lazy-loaded
- [ ] Home.vue placeholder updated and navigates to parse-result
- [ ] `pnpm typecheck` passes

### Phase 3 - Create ParseResult.vue (overview page)

Status: planned
Targets: `packages/frontend/src/views/ParseResult.vue`

- Item Types: Add
- Prereqs: Phase 2

- [ ] Call `parseLink(input)` on mount; handle loading and error states
- [ ] `type=user-space`: display user info (avatar, name) + video group entries (each showing title + first 4 video thumbnails + enter button)
- [ ] `type=ugc-season`: redirect to list page with `type=ugc-season&seasonId=xxx`
- [ ] `type=favorites`: redirect to list page with `type=favorites&mediaId=xxx`
- [ ] `type=video` without UGC season: redirect to list page with `type=video&bvid=xxx`
- [ ] `type=video` with UGC season: redirect to list page with `type=ugc-season&seasonId={ugcSeason.id}` (extract season ID from `VideoInfo.ugcSeason.id`, highlight current video in list)
- [ ] Error state: show specific error message from API response

Exit Criteria:

- [ ] User-space overview displays user info and group entries with thumbnails
- [ ] Non-user-space types redirect to list page
- [ ] `type=video` with UGC season redirects to season list page (not video list page) — code review confirms `ugcSeason` existence check before redirect
- [ ] Parse errors show specific messages
- [ ] `pnpm typecheck` passes

### Phase 4 - Create ParseResultList.vue (list page)

Status: planned
Targets: `packages/frontend/src/views/ParseResultList.vue`

- Item Types: Add
- Prereqs: Phase 3

- [ ] Fetch video list based on route `type` and params (`mid`, `seasonId`, `mediaId`, `bvid`)
- [ ] For `type=video`: if video has UGC season, fetch season videos; display all videos pages flat. Highlight current video.
- [ ] Item granularity is per-page (fen P): no-page video = single item; multi-page video = multiple items titled `{video title} P{n}`
- [ ] Visual grouping: same video pages share left color bar + compact spacing; different videos have larger gap
- [ ] Each item has independent checkbox for selection
- [ ] Load already-queued status via `checkTasks()` on mount; mark queued items as non-selectable. `checkTasks()` accepts `{ items: { bvid: string; cid: number }[] }` and returns task status for each — construct the items array from the video list's `bvid` + `cid` fields.
- [ ] Add to queue button: batch add selected items to download queue (follow VideoDetail.vue `doAddToQueue()` pattern — call `api.createDownload()` for each selected item)
- [ ] Load more button or scroll loading for pagination
- [ ] AI summary operation entry (button/switch) present — actual functionality in 5b plan
- [ ] Cover image display via existing cover proxy

Exit Criteria:

- [ ] List displays correct items based on type
- [ ] Multi-page videos grouped visually with color bar and compact spacing (code review of CSS classes)
- [ ] Per-page items independently selectable (code review of checkbox binding)
- [ ] Already-queued items marked and non-selectable — verified by: start dev server, navigate to list page with items that have existing download tasks, confirm "已入队" label and disabled checkbox
- [ ] Batch add to queue works — verified by: select 2+ items, click "加入待下载", then call `curl -X POST http://localhost:3000/api/tasks/check -H "Content-Type: application/json" -d '{"items":[{"bvid":"<selected bvid>","cid":<selected cid>}]}'` and confirm returned status is not empty
- [ ] Pagination loads more items — verified by: click "加载更多", confirm new items appear in DOM
- [ ] AI summary entry visible (code review)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

### Phase 5 - Verification

Status: planned

- Item Types: Proof
- Prereqs: Phase 4

- [ ] Create/update `docs/testing/2026/07-07-link-parsing-frontend-4b-testing.md` with requirement-level testing directions
- [ ] Run `pnpm typecheck` -- zero errors
- [ ] Run `pnpm build` -- zero errors
- [ ] Manually verify: overview page, list page for each type, multi-page grouping, selection, batch add, pagination, AI summary entry, error handling, Home.vue navigation

Exit Criteria:

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] Testing document covers: overview page user-space display, list page per-type, multi-page grouping, per-item selection, queued status, batch add, pagination, AI summary entry, error display, Home.vue redirect

## Plan Audit

- Status: pending
- Reviewer / Agent: TBD (independent subagent or reviewer)
- Evidence: TBD

## Closure Gates

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] 4a plan (`2026-07-07-link-parsing-backend-4a-plan.md`) is closed — backend APIs available
- [ ] `Home.vue` navigates to `/parse-result?input=xxx` on submit (code review)
- [ ] `/parse-result` route renders overview page for `type=user-space` (code review + dev server manual check)
- [ ] `/parse-result/list` route renders list page for each type (code review + dev server manual check)
- [ ] `type=video` with UGC season redirects to season list page using `ugcSeason.id` as `seasonId` (code review confirms redirect logic checks `ugcSeason` existence)
- [ ] Multi-page videos displayed with visual grouping: same video pages share left color bar + compact spacing (code review of CSS/component structure)
- [ ] Per-page items independently selectable via checkbox (code review)
- [ ] Already-queued items marked and non-selectable — verified by: start dev server, open list page, confirm items with existing download tasks show "已入队" and checkbox disabled
- [ ] Batch add to queue works — verified by: select items, click "加入待下载", confirm `POST /api/tasks/check` returns these items as queued
- [ ] Pagination loads more items — verified by: scroll to bottom or click "加载更多", confirm new items appear and `hasMore` updates
- [ ] AI summary entry visible on list page (code review)
- [ ] Parse errors display specific API error message (code review of error handling)
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred/follow-up without recorded rationale
- [ ] plan audit passed before implementation
- [ ] text consistency verified: status, phases, gates, testing document, and log all agree
- [ ] closure audit was independent (or cold-replay proxy documented)
- [ ] closure evidence exists in files

## Deferred But Adjudicated

### AI summary functionality

- Classification: out-of-scope improvement
- Why Not Blocking Closure: AI summary entry is a UI placeholder only; actual functionality is owned by `2026-07-07-ai-summary-trigger-5b-plan.md`
- Successor Required: yes (5b plan)

### VideoDetail.vue removal

- Classification: watch-only residual
- Why Not Blocking Closure: VideoDetail.vue is kept as fallback per requirement; removal is a future decision after new pages stabilize
- Successor Required: no

## Closure

Status Note: Plan not yet started. Closure requires overview page, list page with multi-page grouping, selection and batch add, pagination, AI summary entry, and Home.vue integration all verified.

Closure Audit Evidence:

- Reviewer / Agent: TBD
- Evidence: TBD

Follow-up:

- 5b plan will add AI summary switch and one-click button to ParseResultList.vue
