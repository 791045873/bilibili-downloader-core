# 多类型链接解析后端 — 需求文档（4a）

> 拆分自 `2026-07-07-multi-link-parsing.md`
> 前端页面在 `2026-07-07-multi-link-parsing-4b.md` 中

## Goal

后端实现四种 B 站链接的识别和数据获取：视频链接、用户空间链接、UGC 合集链接、收藏夹链接。提供统一的链接识别 API 和分页获取 API。

## Background

当前后端只支持单个视频链接解析（`GET /api/video/info`），无法识别用户空间、UGC 合集等链接类型。需要新增 matcher 和 API，供前端新页面调用。

## 概念约定

- "合集" = UGC 合集（season），UP 主手动组织的视频合集
- "收藏夹" = favorites，用户收藏的视频列表
- 不混用这两个概念

## In Scope

### 1. 支持的链接类型

| 输入类型 | 示例 | 解析结果 |
|---|---|---|
| 视频链接 | `BV1z9jq6UEX3`、`https://www.bilibili.com/video/BV1z9jq6UEX3` | 该视频信息 + 该视频所属 UGC 合集信息（如果有） |
| 用户空间链接 | `https://space.bilibili.com/{mid}`、`https://space.bilibili.com/{mid}/video` | 用户信息 + 投稿视频列表（第一页）+ UGC 合集列表 |
| UGC 合集链接 | `https://space.bilibili.com/{mid}/channel/collectiondetail?sid={season_id}` | 合集信息 + 合集下视频列表（第一页） |
| 收藏夹链接 | `https://space.bilibili.com/{mid}/favlist?fid={id}`、`ml1329019876` | 收藏夹信息 + 收藏夹内视频列表（第一页） |

不支持的路径（如 `/audio`、`/article`）返回错误提示。

### 2. API 设计

#### 第一层：链接识别 + 首屏数据

```http
POST /api/parse-link
```

入参：

```ts
interface ParseLinkRequest {
  input: string;
}
```

返回：

```ts
interface ParseLinkResult {
  type: "video" | "user-space" | "ugc-season" | "favorites";
  data: VideoInfo | UserSpaceResult | UgcSeasonResult | FavoritesResult;
}
```

`POST /api/parse-link` 替代 `GET /api/video/info` 成为新页面的链接识别入口。`GET /api/video/info` 标记为废弃但保留可用，供 `VideoDetail.vue` 回退使用。

#### 第二层：分页获取具体内容

```http
GET /api/user-space/videos?mid={mid}&page={page}&pageSize={pageSize}
GET /api/ugc-season/videos?seasonId={seasonId}&page={page}&pageSize={pageSize}
GET /api/favorites/videos?mediaId={mediaId}&page={page}&pageSize={pageSize}
```

`type=video` 不需要分页 API。

### 3. 数据结构定义

```ts
interface PaginatedVideos {
  items: VideoSummary[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

interface VideoSummary {
  bvid: string;
  cid: number;
  title: string;
  cover?: string;
  duration: number;
}

interface UserSpaceResult {
  mid: number;
  name: string;
  face?: string;
  videos: PaginatedVideos;
  seasons: UgcSeasonInfo[];
}

interface UgcSeasonResult {
  seasonId: number;
  title: string;
  cover?: string;
  upperName?: string;
  videos: PaginatedVideos;
}

interface FavoritesResult {
  mediaId: number;
  title: string;
  cover?: string;
  upperName?: string;
  videos: PaginatedVideos;
}

interface UgcSeasonInfo {
  seasonId: number;
  title: string;
  cover?: string;
  videoCount: number;
}
```

### 4. 需要新增的后端能力

| 能力 | 现状 | 说明 |
|---|---|---|
| 用户空间 matcher | 无 | 识别 `space.bilibili.com/{mid}` 和 `space.bilibili.com/{mid}/video` |
| UGC 合集 matcher | 无 | 识别 `space.bilibili.com/{mid}/channel/collectiondetail?sid={season_id}` |
| 收藏夹 matcher | 已有 | `favorites-matcher` 已实现 |
| 收藏夹视频列表 API | 已有 | `BilibiliFavoritesProvider.getFavoritesVideos()` 已实现分页 |
| 用户视频列表 API | 无 | 调用 B 站 `x/space/wbi/arc/search`，分页获取用户投稿视频 |
| 用户合集列表 API | 无 | 调用 B 站 `x/polymer/web-space/seasons_series_list`，获取用户 UGC 合集列表 |
| UGC 合集视频列表 API | 无 | 调用 B 站 `x/polymer/web-space/seasons_archives_list`，分页获取合集下视频 |
| 用户空间信息 API | 无 | 调用 B 站 `x/space/acc/info`，获取用户基本信息 |

后端扩展方式：按 `favorites-provider.ts` 既有模式新建 Provider 类，注入 `BilibiliWebClient`，调用 `wbiSign` 签名后通过 `requestJson` 发起 GET 请求。

### 5. 错误处理

- 不支持的链接类型返回 400 + 具体错误信息
- B 站 API 调用失败返回 502 + 具体错误信息
- 分页参数无效返回 400

## Out of Scope

- 不实现前端页面（在 `2026-07-07-multi-link-parsing-4b.md` 中）
- 不实现视频分析功能
- 不实现 POST 请求支持（当前所有新增 B 站 API 均为 GET）
- 不实现收藏夹内视频的 UGC 合集关联

## Affected Files

| 文件 | 改动 |
|---|---|
| `packages/adapters/src/bilibili/matcher/space-matcher.ts` | 新增用户空间 matcher |
| `packages/adapters/src/bilibili/matcher/ugc-season-matcher.ts` | 新增 UGC 合集 matcher |
| `packages/adapters/src/bilibili/resource-parser.ts` | MATCHERS 数组新增 matcher |
| `packages/adapters/src/bilibili/space-provider.ts` | 新增用户视频列表、合集列表、合集视频列表、用户信息 API |
| `packages/server/src/parse/parse.controller.ts` | 新增 `POST /api/parse-link` 和分页 API |
| `packages/server/src/parse/parse.service.ts` | 新增解析服务 |
| `packages/server/src/parse/parse.module.ts` | 新增模块 |
| `packages/server/src/app.module.ts` | 注册新模块 |
| `packages/server/src/video/video.controller.ts` | 标记 `GET /api/video/info` 废弃 |

## Acceptance Criteria

1. 粘贴视频链接时，返回视频信息 + 所属 UGC 合集信息
2. 粘贴用户空间链接时，返回用户信息 + 投稿视频第一页 + UGC 合集列表
3. 粘贴 UGC 合集链接时，返回合集信息 + 合集下视频第一页
4. 粘贴收藏夹链接时，返回收藏夹信息 + 收藏夹内视频第一页
5. 不支持的路径（如 `/audio`）返回明确的错误提示
6. 分页 API 正常工作，`hasMore` 字段正确标识是否还有更多数据
7. `POST /api/parse-link` 作为新页面的链接识别入口
8. `GET /api/video/info` 标记为废弃但保留可用
9. `VideoInfo` 中包含完整的 `ugcSeason` 信息（含 `seasonId`）
10. `VideoSummary` 包含 `bvid` 和 `cid` 字段
11. `pnpm typecheck` 和 `pnpm build` 通过
