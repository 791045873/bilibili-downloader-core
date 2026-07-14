# Multi-Link Parsing Frontend (4b) Plan

> Plan Status: done
> Last Reviewed: 2026-07-14
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
  - Already-queued display: green text label `<span class="ml-2 text-green-500">已入队</span>` (`VideoDetail.vue:392`) + checkbox disabled via `:disabled="node.data.enqueued"` (`VideoDetail.vue:384`)
  - `doAddToQueue(outputPath)` pattern (`VideoDetail.vue:267-312`): opens directory confirmation Dialog (`VideoDetail.vue:249-261`) → calls `api.createDownload()` per selected page (`VideoDetail.vue:280-289`) → calls `queueStore.addTaskIds(successArr)` (`VideoDetail.vue:299`) → marks items `enqueued = true` and deselects (`VideoDetail.vue:301-308`)
  - Cover image proxy: `'/api/video/cover?url=' + encodeURIComponent(coverUrl)` (`VideoDetail.vue:341`)
- `useDownloadQueueStore` (`stores/useDownloadQueueStore.ts`) provides `addTaskIds(ids)` persisting created task IDs to localStorage -- the queue store the new list page must reuse for batch-add consistency
- `stores/` has `auth.ts`, `settings.ts`, `useDownloadQueueStore.ts` -- no parse-result store
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

Status: completed
Targets: `packages/frontend/src/types/index.ts`, `packages/frontend/src/api/index.ts`

- Item Types: Add
- Prereqs: 4a completed

- [x] Add types: `ParseLinkResult`, `PaginatedVideos`, `VideoSummary`, `UserSpaceResult`, `UgcSeasonResult`, `FavoritesResult`, `UgcSeasonSummary` (with `seasonId`, `title`, `cover`, `videoCount` -- matches 4a backend port type name)
- [x] Add `parseLink(input: string): Promise<ParseLinkResult>` to `api/index.ts`
- [x] Add `getUserSpaceVideos(mid, page, pageSize)`, `getUgcSeasonVideos(seasonId, page, pageSize)`, `getFavoritesVideos(mediaId, page, pageSize)` to `api/index.ts`

Exit Criteria:

- [x] All types defined matching backend response shapes
- [x] API functions call correct endpoints
- [x] `pnpm typecheck` passes

### Phase 2 - Add routes and update Home.vue

Status: completed
Targets: `packages/frontend/src/router/index.ts`, `packages/frontend/src/views/Home.vue`

- Item Types: Add | Fix
- Prereqs: Phase 1

- [x] Add routes: `/parse-result` (name: `parse-result`, component: `ParseResult.vue`), `/parse-result/list` (name: `parse-result-list`, component: `ParseResultList.vue`)
- [x] Update `Home.vue` placeholder to support multi-link types (e.g., "BV号 / 视频链接 / 用户空间 / 合集 / 收藏夹链接...")
- [x] Update `Home.vue` submit to navigate to `{ name: 'parse-result', query: { input } }`

Exit Criteria:

- [x] Routes registered and lazy-loaded
- [x] Home.vue placeholder updated and navigates to parse-result
- [x] `pnpm typecheck` passes

### Phase 3 - Create ParseResult.vue (overview page)

Status: completed
Targets: `packages/frontend/src/views/ParseResult.vue`

- Item Types: Add
- Prereqs: Phase 2

- [x] Call `parseLink(input)` on mount; handle loading and error states
- [x] `type=user-space`: display user info (avatar, name) + video group entries. Group entries are derived from the `UserSpaceResult` response: (a) a "投稿视频" entry built from `videos` (first page) navigating to `/parse-result/list?type=user-videos&mid=xxx`, and (b) one entry per item in `seasons` (UGC season list) navigating to `/parse-result/list?type=ugc-season&seasonId={season.seasonId}`. Each entry shows title + first 4 video thumbnails + "进入" button
- [x] `type=ugc-season`: redirect to list page with `type=ugc-season&seasonId=xxx`
- [x] `type=favorites`: redirect to list page with `type=favorites&mediaId=xxx`
- [x] `type=video` without UGC season: redirect to list page with `type=video&bvid=xxx`
- [x] `type=video` with UGC season: redirect to list page with `type=ugc-season&seasonId={ugcSeason.id}` (extract season ID from `VideoInfo.ugcSeason.id`, highlight current video in list)
- [x] Error state: show specific error message from API response

Exit Criteria:

- [x] User-space overview displays user info and group entries with thumbnails; "投稿视频" entry navigates to `type=user-videos` list page, season entries navigate to `type=ugc-season` list page (code review of navigation targets)
- [x] Non-user-space types redirect to list page
- [x] `type=video` with UGC season redirects to season list page (not video list page) — code review confirms `ugcSeason` existence check before redirect
- [x] Parse errors show specific messages
- [x] `pnpm typecheck` passes

### Phase 4 - Create ParseResultList.vue (list page)

Status: completed
Targets: `packages/frontend/src/views/ParseResultList.vue`

- Item Types: Add | Decision
- Prereqs: Phase 3

- [x] Fetch video list based on route `type` and params. Four list page types, each mapped to one API: `type=user-videos&mid=xxx` -> `getUserSpaceVideos(mid, page, pageSize)`; `type=ugc-season&seasonId=xxx` -> `getUgcSeasonVideos(seasonId, page, pageSize)`; `type=favorites&mediaId=xxx` -> `getFavoritesVideos(mediaId, page, pageSize)`; `type=video&bvid=xxx` -> fetch video info via `parseLink` or `getVideoInfo` (single video, no pagination)
- [x] For `type=video`: if video has UGC season, fetch season videos; display all videos pages flat. Highlight current video.
- [x] Item granularity is per-page (fen P): no-page video = single item; multi-page video = multiple items titled `{video title} P{n}`
- [x] Visual grouping: same video pages share left color bar + compact spacing; different videos have larger gap
- [x] Each item has independent checkbox for selection
- [x] Load already-queued status via `checkTasks()` on mount; mark queued items as non-selectable. `checkTasks()` accepts `{ items: { bvid: string; cid: number }[] }` and returns task status for each — construct the items array from the video list's `bvid` + `cid` fields. Already-queued display must match `VideoDetail.vue`: green "已入队" text label + disabled checkbox (`VideoDetail.vue:384,392`)
- [x] Add to queue button: batch add selected items to download queue following `VideoDetail.vue` `doAddToQueue()` pattern (`VideoDetail.vue:267-312`) — open directory confirmation Dialog, call `api.createDownload()` per selected item, call `queueStore.addTaskIds()` from `useDownloadQueueStore`, mark items enqueued and deselect
- [x] Decision: pagination uses "加载更多" button (not scroll loading). Alternatives: infinite scroll (rejected -- harder to verify closure and less predictable for batch selection). Residual risk: none.
- [x] AI summary operation entry (button) present — actual functionality in 5b plan
- [x] Cover image display via existing cover proxy `/api/video/cover?url=` + encodeURIComponent (same as `VideoDetail.vue:341`)

Exit Criteria:

- [x] List displays correct items for all four types: `user-videos`, `ugc-season`, `favorites`, `video` (code review of type dispatch)
- [x] Multi-page videos grouped visually with color bar and compact spacing (code review of CSS classes)
- [x] Per-page items independently selectable (code review of checkbox binding)
- [x] Already-queued items marked and non-selectable, display matches VideoDetail.vue (green "已入队" text + disabled checkbox) — verified by: start dev server, navigate to list page with items that have existing download tasks, confirm "已入队" label and disabled checkbox
- [x] Batch add to queue works, follows VideoDetail.vue pattern (directory dialog + createDownload + queueStore.addTaskIds) — verified by: select 2+ items, click "加入待下载", confirm directory dialog appears, then call `curl -X POST http://localhost:3000/api/tasks/check -H "Content-Type: application/json" -d '{"items":[{"bvid":"<selected bvid>","cid":<selected cid>}]}'` and confirm returned status is not empty
- [x] Pagination loads more items via "加载更多" button — verified by: click "加载更多", confirm new items appear in DOM
- [x] AI summary entry visible (code review)
- [x] `pnpm typecheck` passes
- [x] `pnpm build` passes

### Phase 5 - Verification

Status: completed

- Item Types: Proof
- Prereqs: Phase 4

- [x] Create/update `docs/testing/2026/07-07-link-parsing-frontend-4b-testing.md` with requirement-level testing directions
- [x] Run `pnpm typecheck` -- zero errors
- [x] Run `pnpm build` -- zero errors
- [x] Manually verify: overview page, list page for each type, multi-page grouping, selection, batch add, pagination, AI summary entry, error handling, Home.vue navigation

Exit Criteria:

- [x] `pnpm typecheck` zero errors
- [x] `pnpm build` zero errors
- [x] Testing document covers: overview page user-space display (with group entries navigating to user-videos and ugc-season list pages), list page for all four types (user-videos, ugc-season, favorites, video), multi-page grouping, per-item selection, queued status (matching VideoDetail.vue pattern), batch add (matching VideoDetail.vue pattern), pagination via "加载更多", AI summary entry, error display, Home.vue redirect

## Plan Audit

- Status: passed (cold-replay proxy, reviewer availability = none)
- Reviewer / Agent: 独立 subagent cold-replay
- Evidence: Cold-replay audit verified all 6 original baseline claims against live code (6/6 accurate). Found 1 blocker, 4 majors, 3 minors — all resolved in this revision:
  - Blocker (R6): testing document `docs/testing/2026/07-07-link-parsing-frontend-4b-testing.md` did not exist — created with requirement-level testing directions covering all 9 ACs.
  - Major: plan did not enumerate `type=user-videos` list page type (requirement route table line 105) — Phase 4 now explicitly maps all four list page types (`user-videos`, `ugc-season`, `favorites`, `video`) to their API calls.
  - Major: Phase 3 user-space overview did not specify group entry types or navigation targets — now specifies "投稿视频" entry -> `type=user-videos` and season entries -> `type=ugc-season`.
  - Major: baseline did not inventory the exact "已入队" display pattern from VideoDetail.vue (green text `VideoDetail.vue:392` + disabled checkbox `VideoDetail.vue:384`) that requirement 3.3 demands consistency with — baseline and Phase 4 now specify exact pattern.
  - Major: baseline did not inventory `doAddToQueue()` full pattern (directory dialog + `queueStore.addTaskIds()` `VideoDetail.vue:299` + mark enqueued) that requirement 3.4 demands consistency with — baseline and Phase 4 now specify full pattern.
  - Minor: type name `UgcSeasonInfoSimple` renamed to `UgcSeasonSummary` to match 4a backend port type.
  - Minor: baseline did not inventory cover proxy path `/api/video/cover?url=` (`VideoDetail.vue:341`) — added.
  - Minor: Phase 4 "Load more button or scroll loading" was ambiguous — resolved with Decision item committing to "加载更多" button.
  - Dependency direction verified: 4b depends on 4a (correct); 4a plan line 6 confirms "frontend depends on 4a".
  - Anti-Slacking scan: no forbidden words (`optional`, `if time permits`, `consider`, `maybe`, `nice to have`, `as needed`) found.
  - Plan-guide rules: R1 ✅ (baseline 6/6 accurate + 4 gaps filled), R2 ✅, R4 ✅ (one result surface), R5 ✅, R6 ✅ (testing doc created), R8 ✅, R13 ✅ (cold-replay proxy documented), Anti-Slacking ✅.
  - AC coverage: 9/9 (AC1-AC9 all covered by exit criteria).

## Closure Gates

- [x] `pnpm typecheck` zero errors
- [x] `pnpm build` zero errors
- [x] 4a plan (`2026-07-07-link-parsing-backend-4a-plan.md`) is closed — backend APIs available
- [x] `Home.vue` navigates to `/parse-result?input=xxx` on submit (code review)
- [x] `/parse-result` route renders overview page for `type=user-space` (code review + dev server manual check)
- [x] `/parse-result/list` route renders list page for all four types: `user-videos`, `ugc-season`, `favorites`, `video` (code review + dev server manual check)
- [x] `type=video` with UGC season redirects to season list page using `ugcSeason.id` as `seasonId` (code review confirms redirect logic checks `ugcSeason` existence)
- [x] Multi-page videos displayed with visual grouping: same video pages share left color bar + compact spacing (code review of CSS/component structure)
- [x] Per-page items independently selectable via checkbox (code review)
- [x] Already-queued items marked and non-selectable, display matches VideoDetail.vue (green "已入队" text + disabled checkbox) — verified by: start dev server, open list page, confirm items with existing download tasks show "已入队" and checkbox disabled
- [x] Batch add to queue works following VideoDetail.vue pattern (directory dialog + createDownload + queueStore.addTaskIds) — verified by: select items, click "加入待下载", confirm directory dialog, then confirm `POST /api/tasks/check` returns these items as queued
- [x] Pagination loads more items via "加载更多" button — verified by: click "加载更多", confirm new items appear and `hasMore` updates
- [x] AI summary entry visible on list page (code review)
- [x] Parse errors display specific API error message (code review of error handling)
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up without recorded rationale
- [x] plan audit passed before implementation
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent (or cold-replay proxy documented)
- [x] closure evidence exists in files

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

Status Note: Plan closed on 2026-07-14. Overview page, list page, multi-page grouping, selection and batch add behavior, pagination, AI summary entry visibility, and Home navigation integration are implemented and verified.

Closure Audit Evidence:

- Reviewer / Agent: independent closure audit by subagent Explore (2026-07-14)
- Evidence: pnpm typecheck, pnpm build, docs/testing/2026/07-07-link-parsing-frontend-4b-testing.md execution record, docs/logs/2026-07-14-link-parsing-frontend-4b.md, and independent subagent audit PASS.

Follow-up:

- 5b plan will add AI summary switch and one-click button to ParseResultList.vue

