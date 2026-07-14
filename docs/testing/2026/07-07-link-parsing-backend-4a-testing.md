# Multi-Link Parsing Backend (4a) Testing

> Plan: `docs/plans/2026-07-07-link-parsing-backend-4a-plan.md`
> Requirement: `docs/requirements/2026-07-07-multi-link-parsing-4a.md`
> Created: 2026-07-12 (at plan authoring time per R6)

## Testing Directions

These are requirement-level observable states to verify. Each direction describes what should be true and what should NOT be true after implementation.

### 1. Video link parsing (AC1, AC9, AC10)

**Should be true:**
- `POST /api/parse-link` with a BV link (e.g. `BV1z9jq6UEX3` or full URL `https://www.bilibili.com/video/BV1z9jq6UEX3`) returns `{ type: "video", data: VideoInfo }`
- `VideoInfo` includes title, upperName, pages, and `ugcSeason` if the video belongs to a UGC season
- `ugcSeason` in the response includes `seasonId` (mapped from the domain `UgcSeasonInfo.id`)
- `VideoSummary` items in any paginated response include `bvid` and `cid` fields

**Should NOT be true:**
- The response should NOT omit `ugcSeason` when the video has one
- `VideoSummary` should NOT be missing `bvid` or `cid`

### 2. User space link parsing (AC2)

**Should be true:**
- `POST /api/parse-link` with `https://space.bilibili.com/{mid}` returns `{ type: "user-space", data: UserSpaceResult }`
- `UserSpaceResult` includes `mid`, `name`, `face`, `videos` (first page), and `seasons` (UGC season list)
- `seasons` items have `seasonId`, `title`, `cover`, `videoCount` — NOT `sections` (that's the full-detail type)

**Should NOT be true:**
- `https://space.bilibili.com/{mid}/favlist?fid=...` should NOT be parsed as user-space (must be caught by favorites-matcher first)
- `https://space.bilibili.com/{mid}/channel/collectiondetail?sid=...` should NOT be parsed as user-space (must be caught by ugc-season-matcher first)

### 3. UGC season link parsing (AC3)

**Should be true:**
- `POST /api/parse-link` with `https://space.bilibili.com/{mid}/channel/collectiondetail?sid={season_id}` returns `{ type: "ugc-season", data: UgcSeasonResult }`
- `UgcSeasonResult` includes `seasonId`, `title`, `cover`, `upperName`, and `videos` (first page)

**Should NOT be true:**
- The response should NOT return an empty videos list if the season has videos

### 4. Favorites link parsing (AC4)

**Should be true:**
- `POST /api/parse-link` with `https://space.bilibili.com/{mid}/favlist?fid={id}` returns `{ type: "favorites", data: FavoritesResult }`
- `FavoritesResult` includes `mediaId`, `title`, `cover`, and `videos` (first page)
- `PaginatedVideos.total` for favorites comes from `FavoritesInfo.mediaCount`

**Should NOT be true:**
- `total` should NOT be 0 if the favorites folder has videos

### 5. Unsupported path error (AC5)

**Should be true:**
- `POST /api/parse-link` with `https://space.bilibili.com/12345678/audio` returns HTTP 400 with a specific error message
- `POST /api/parse-link` with `https://space.bilibili.com/12345678/article` returns HTTP 400

**Should NOT be true:**
- Unsupported paths should NOT return 200 or be misidentified as user-space

### 6. Pagination endpoints (AC6)

**Should be true:**
- `GET /api/user-space/videos?mid={mid}&page=1&pageSize=10` returns `PaginatedVideos` with `items`, `page`, `pageSize`, `total`, `hasMore`
- `GET /api/ugc-season/videos?seasonId={seasonId}&page=1&pageSize=10` returns `PaginatedVideos`
- `GET /api/favorites/videos?mediaId={mediaId}&page=1&pageSize=10` returns `PaginatedVideos`
- `hasMore` is `true` when more pages exist, `false` on the last page
- Invalid pagination params (e.g. `page=0`, `pageSize=-1`) return 400

**Should NOT be true:**
- `hasMore` should NOT be `true` on the last page
- `type=video` does NOT have a pagination endpoint

### 7. Deprecated endpoint (AC7, AC8)

**Should be true:**
- `GET /api/video/info?input={bv}` still returns video info (functional, not removed)
- `GET /api/video/info` has a deprecation comment in source code
- `POST /api/parse-link` serves as the new link recognition entry point

**Should NOT be true:**
- `GET /api/video/info` should NOT be removed or return 404

### 8. Build verification (AC11)

**Should be true:**
- `pnpm typecheck` passes with zero errors across all packages
- `pnpm build` passes with zero errors across all packages

**Should NOT be true:**
- No new TypeScript errors from `ResourceType` enum extension or new `ParseLinkPort.ts` types

## Verification Commands

```bash
pnpm typecheck
pnpm build
# Start server then:
curl -X POST http://localhost:3000/api/parse-link -H "Content-Type: application/json" -d '{"input":"BV1SoTx6yEYc"}'
curl -X POST http://localhost:3000/api/parse-link -H "Content-Type: application/json" -d '{"input":"https://space.bilibili.com/12345678"}'
curl -X POST http://localhost:3000/api/parse-link -H "Content-Type: application/json" -d '{"input":"https://space.bilibili.com/12345678/channel/collectiondetail?sid=123"}'
curl -X POST http://localhost:3000/api/parse-link -H "Content-Type: application/json" -d '{"input":"https://space.bilibili.com/12345678/favlist?fid=1329019876"}'
curl -X POST http://localhost:3000/api/parse-link -H "Content-Type: application/json" -d '{"input":"https://space.bilibili.com/12345678/audio"}'
curl "http://localhost:3000/api/user-space/videos?mid=12345678&page=1&pageSize=10"
curl "http://localhost:3000/api/ugc-season/videos?seasonId=123&page=1&pageSize=10"
curl "http://localhost:3000/api/favorites/videos?mediaId=1329019876&page=1&pageSize=10"
curl "http://localhost:3000/api/video/info?input=BV1SoTx6yEYc"
```

## 2026-07-14 Verification Record

- `pnpm typecheck` passed (zero errors)
- `pnpm build` passed (zero errors)
- `POST /api/parse-link` with video input `BV1SoTx6yEYc` returned `type: "video"`
- `POST /api/parse-link` with UGC season link `https://space.bilibili.com/670241541/channel/collectiondetail?sid=1272286` returned `type: "ugc-season"` and first-page videos
- `POST /api/parse-link` with favorites link `https://space.bilibili.com/670241541/favlist?fid=1329019876` returned `type: "favorites"` and `videos.total=18`
- `POST /api/parse-link` with unsupported link `https://space.bilibili.com/12345678/audio` returned HTTP 400
- `GET /api/ugc-season/videos?seasonId=1272286&page=1&pageSize=10` returned `hasMore=true`
- `GET /api/favorites/videos?mediaId=1329019876&page=1&pageSize=10` returned `hasMore=true`
- `GET /api/user-space/videos?mid=670241541&page=0&pageSize=10` returned HTTP 400 for invalid pagination
- `GET /api/video/info?input=BV1SoTx6yEYc` still works (deprecated endpoint remains functional)

Risk note:
- `POST /api/parse-link` / `GET /api/user-space/videos` for some `mid` values may return B-station risk control errors (`code=-352`) or request errors (`code=-400`) and be mapped to HTTP 502. This is external API/cookie sensitivity, not local contract logic regression.
