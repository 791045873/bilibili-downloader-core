# Multi-Link Parsing Frontend (4b) Testing

> Plan: `docs/plans/2026-07-07-link-parsing-frontend-4b-plan.md`
> Requirement: `docs/requirements/2026-07-07-multi-link-parsing-4b.md`
> Created: 2026-07-12 (at plan authoring time per R6)

## Testing Directions

These are requirement-level observable states to verify. Each direction describes what should be true and what should NOT be true after implementation.

### 1. Overview page -- user-space display (AC1)

**Should be true:**
- Navigating to `/parse-result?input=https://space.bilibili.com/{mid}` renders the overview page with user avatar and name
- The overview page shows video group entries, each with a title, first 4 video thumbnails, and an "进入" button
- A "投稿视频" group entry is present and navigates to `/parse-result/list?type=user-videos&mid={mid}`
- Each UGC season group entry navigates to `/parse-result/list?type=ugc-season&seasonId={seasonId}`
- The overview page does not allow selecting or operating on individual videos

**Should NOT be true:**
- The overview page should NOT display video checkboxes or an "加入待下载" button
- The overview page should NOT navigate directly to a list page for `type=user-space` (it stays on the overview)

### 2. Overview page -- non-user-space redirect (AC1, AC7)

**Should be true:**
- `type=ugc-season` input redirects to `/parse-result/list?type=ugc-season&seasonId=xxx`
- `type=favorites` input redirects to `/parse-result/list?type=favorites&mediaId=xxx`
- `type=video` without UGC season redirects to `/parse-result/list?type=video&bvid=xxx`
- `type=video` with UGC season redirects to `/parse-result/list?type=ugc-season&seasonId={ugcSeason.id}` (season list, not video list)

**Should NOT be true:**
- `type=video` with UGC season should NOT redirect to `type=video` list page
- The redirect should NOT lose the original input context (seasonId/bvid/mediaId must be preserved in the query)

### 3. List page -- correct items per type (AC2)

**Should be true:**
- `/parse-result/list?type=user-videos&mid=xxx` displays the user's uploaded videos as cards
- `/parse-result/list?type=ugc-season&seasonId=xxx` displays all videos in the UGC season
- `/parse-result/list?type=favorites&mediaId=xxx` displays videos in the favorites folder
- `/parse-result/list?type=video&bvid=xxx` displays the single video (or its UGC season videos if it belongs to one)
- For `type=video` with UGC season, the current video is visually highlighted in the list

**Should NOT be true:**
- The list page should NOT show items from a different type than the route query specifies
- `type=video` should NOT show a "加载更多" button (single video, no pagination)

### 4. Multi-page video grouping (AC3)

**Should be true:**
- A video with multiple pages (fen P) produces multiple list items, each titled `{video title} P{n}`
- Same-video pages share a left color bar and compact spacing
- Different videos have a larger visual gap between them
- A video with no pages (single page) appears as one item titled with the video title

**Should NOT be true:**
- Multi-page video items should NOT be titled without the `P{n}` suffix
- Same-video items should NOT be separated by the larger gap used between different videos

### 5. Per-item selection and queued status (AC4)

**Should be true:**
- Each list item (per-page granularity) has an independent checkbox
- Items already in the download queue show a green "已入队" text label and have their checkbox disabled
- The "已入队" display matches VideoDetail.vue (green text + disabled checkbox)

**Should NOT be true:**
- Already-queued items should NOT be selectable
- The queued-status display should NOT differ from VideoDetail.vue's pattern

### 6. Batch add to queue (AC5)

**Should be true:**
- Selecting 2+ items and clicking "加入待下载" opens a directory confirmation dialog (same as VideoDetail.vue)
- After confirming the directory, each selected item is submitted via the download creation API
- Successfully added items are marked as "已入队" and deselected
- The created task IDs are persisted via `useDownloadQueueStore`

**Should NOT be true:**
- Batch add should NOT skip the directory confirmation dialog
- Already-queued items should NOT be re-submitted

### 7. Pagination (AC2)

**Should be true:**
- List pages for `user-videos`, `ugc-season`, and `favorites` show a "加载更多" button when more pages exist
- Clicking "加载更多" appends new items to the list
- When no more pages exist, the "加载更多" button is hidden or disabled

**Should NOT be true:**
- `type=video` list page should NOT show "加载更多" (no pagination for single video)
- "加载更多" should NOT replace existing items (it must append)

### 8. AI summary entry (AC6)

**Should be true:**
- The list page has a visible "AI 总结" operation entry (button)
- The entry is present but does not trigger full AI summary functionality (owned by 5b plan)

**Should NOT be true:**
- The AI summary entry should NOT be absent from the list page
- The entry should NOT trigger backend AI processing (that is 5b scope)

### 9. Error handling (AC7)

**Should be true:**
- When `parseLink` fails (invalid link, B-station API timeout, unsupported path), the overview page displays an error message
- The error message shown matches the specific error returned by the API

**Should NOT be true:**
- The error display should NOT show a generic "something went wrong" message when the API returns a specific error
- Parse errors should NOT cause a blank page or unhandled crash

### 10. Home.vue navigation (AC8)

**Should be true:**
- `Home.vue` input placeholder mentions multiple link types (BV, video link, user space, UGC season, favorites)
- Submitting the input navigates to `/parse-result?input=xxx`

**Should NOT be true:**
- Home.vue should NOT navigate to `/video` (old VideoDetail.vue route) on submit
- The placeholder should NOT still say only "BV号 / AV号 / B站视频链接..."

### 11. Build verification (AC9)

**Should be true:**
- `pnpm typecheck` passes with zero errors
- `pnpm build` passes with zero errors

**Should NOT be true:**
- No new TypeScript errors from new types or API functions

## Verification Commands

```bash
pnpm typecheck
pnpm build
# Start dev server (pnpm dev) and 4a backend server, then manually verify:
# 1. Open http://localhost:5173/, paste a user-space link, confirm overview page
# 2. Click "投稿视频" entry, confirm list page at type=user-videos
# 3. Paste a BV link with UGC season, confirm redirect to type=ugc-season list
# 4. Paste a BV link without UGC season, confirm redirect to type=video list
# 5. Paste an invalid link, confirm error message
# 6. On list page, select 2+ items, click "加入待下载", confirm directory dialog
# 7. Confirm already-queued items show green "已入队" and disabled checkbox
# 8. Click "加载更多" on a paginated list, confirm new items
# 9. Confirm "AI 总结" button visible on list page
```
