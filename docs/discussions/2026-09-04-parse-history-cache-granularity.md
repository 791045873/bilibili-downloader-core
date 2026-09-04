# 2026-09-04 解析历史卡片：缓存粒度与再次展示方式讨论

> Status: resolved（用户已确认，见文末决策）
> Related: `docs/requirements/2026-09-04-parse-history-cards.md`

## 背景

用户提问：第一次粘贴链接解析后，解析结果已经知晓，再次进入是否可以不重新解析、直接展示缓存结果？要求梳理解析结果类型及各自的缓存/展示方式。

## 事实核对（live 代码，2026-09-04）

`POST /api/parse-link` 返回 4 种类型，再次进入内容页的取数路径：

| 类型 | 解析结果数据 | 再次进入路径 | 是否重复 parseLink |
| --- | --- | --- | --- |
| `video`（非合集） | `VideoParseResult`（bvid/title/coverUrl/pages/ugcSeason?） | `/parse-result/list?type=video&bvid=` → 列表页**重新调用 `parseLink(bvid)`**（`ParseResultList.tsx:273`）再 `checkTasks` | **是** |
| `video`∈合集 | 同上（带 seasonId） | redirect 到 `type=ugc-season&seasonId=&currentBvid=` → 列表页只调 `getUgcSeasonVideos` | 否 |
| `ugc-season` | seasonId + `PaginatedVideos` | 列表页调 `getUgcSeasonVideos(seasonId, page, pageSize)` | 否 |
| `favorites` | mediaId + `PaginatedVideos` | 列表页调 `getFavoritesVideos(mediaId, page, pageSize)` | 否 |
| `user-space` | mid/名/头像 + videos + seasons | 停留 `ParseResult.tsx` 分组视图（**依赖 parseLink 渲染**）；分组后调 `getUserSpaceVideos` / `getUgcSeasonVideos` | 分组视图本身是 |

关键约束：任何路径进入列表页后都会调用 `checkTasks` 拉实时下载/AI 总结状态——该调用不可缓存替代。

## 分析

1. 卡片展示所需信息（标题/封面/类型/时间 + 跳转参数）在解析成功瞬间即可获得，必须缓存，量小。
2. 完整解析结果缓存仅对 `video`（非合集）路径有"跳过重复 parseLink"价值，但列表页仍需 `checkTasks` 实时状态，收益有限；且需给 `ParseResultList` 增加"预置数据"分支、承担 pages 过期风险（分P 变更罕见但存在）。
3. `user-space` 分组视图依赖完整 `UserSpaceResult`：直接渲染缓存会展示过期合集列表；重新解析则回到原点。

## 已确认决策（用户，2026-09-04）

1. **缓存粒度：仅缓存"入口信息"**（key/type/title/coverUrl/跳转参数/parsedAt），不缓存完整解析结果。理由：3/4 类型本就无需重复解析；video 类型的 1 次 parseLink 收益有限，不值得增加列表页预置数据分支与数据过期风险。
2. **`video` 类型点击卡片**：保持现状跳列表页并 parseLink（接受这一次重复解析，换取 pages 数据与状态实时可靠）。
3. **`user-space` 卡片**：卡片直接进入"投稿视频"列表（`type=user-videos&mid=`），不经过分组视图（零解析、不缓存易过期的合集列表；UP 主合集可由用户后续单独解析并各自成卡）。
4. 卡片展示信息（标题/封面/类型/时间）全部来自首次解析结果，点击后页面数据实时拉取。

## 影响的需求修订

- `docs/requirements/2026-09-04-parse-history-cards.md`：Business Rules 中 user-space 卡片目标由"分组视图"改为"投稿视频列表"；删除"点击后重新解析"相关的歧义表述，明确仅 video（非合集）路径存在 1 次 parseLink。
