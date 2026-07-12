# 多类型链接解析与批量视频入口 — 需求文档（已拆分）

> 本文档已拆分为两个独立子需求：
> - `2026-07-07-multi-link-parsing-4a.md`：后端链接解析
> - `2026-07-07-multi-link-parsing-4b.md`：前端页面
>
> 请使用拆分后的文档。本文档保留作为历史记录。

## Goal

支持用户在前端粘贴四种 B 站链接（视频、用户空间、UGC 合集、收藏夹），后端自动识别链接类型并返回首屏数据，前端在新页面展示解析结果，供用户后续批量分析或下载。

## Background

当前前端只支持粘贴单个视频链接（BV/AV/URL），跳转到 `VideoDetail.vue` 展示单个视频的分 P 和合集信息。无法满足"访问一个用户的 B 站空间，批量解析处理空间下的视频"的需求。

需要新增多类型链接识别能力，支持用户空间、UGC 合集、收藏夹三种批量入口，并在前端新页面展示解析结果。

## 概念约定

- "合集" = UGC 合集（season），UP 主手动组织的视频合集
- "收藏夹" = favorites，用户收藏的视频列表
- "视频分组" = 一个可进入的视频列表入口，在不同解析类型下含义不同（投稿视频、UGC 合集、收藏夹、单个视频及其分P）
- 不混用"合集"和"收藏夹"这两个概念

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

- `type=video`：`data` 为 `VideoInfo`（复用现有 `getVideoInfo` 返回结构）
- `type=user-space`：`data` 为 `UserSpaceResult`
- `type=ugc-season`：`data` 为 `UgcSeasonResult`
- `type=favorites`：`data` 为 `FavoritesResult`

这一层只负责识别链接类型 + 返回首屏数据（第一页）。

`POST /api/parse-link` 替代 `GET /api/video/info` 成为新页面的链接识别入口。`GET /api/video/info` 标记为废弃但保留可用，供 `VideoDetail.vue` 回退使用，直到 `VideoDetail.vue` 被移除。

#### 第二层：分页获取具体内容

针对 `user-space`、`ugc-season`、`favorites` 三种类型，各自有独立的分页 API：

```http
GET /api/user-space/videos?mid={mid}&page={page}&pageSize={pageSize}
GET /api/ugc-season/videos?seasonId={seasonId}&page={page}&pageSize={pageSize}
GET /api/favorites/videos?mediaId={mediaId}&page={page}&pageSize={pageSize}
```

`type=video` 不需要分页 API。

返回结构统一：

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
```

### 3. 数据结构定义

```ts
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

后端扩展方式：按 `favorites-provider.ts` 既有模式新建 Provider 类，注入 `BilibiliWebClient`，调用 `wbiSign` 签名后通过 `requestJson` 发起 GET 请求。`BilibiliWebClient` 已支持 GET 请求和 Cookie 传入，内部已固定设置 `Referer` 和 `User-Agent`，不需要改动底层架构。

### 5. 前端页面交互设计

#### 5.1 页面层级

```text
概览页 /parse-result?input=xxx
  ├── type=user-space → 显示用户信息 + 多个视频分组入口
  ├── type=ugc-season → 直接跳转到列表页（概览页只有一个分组，跳过）
  ├── type=favorites → 直接跳转到列表页（概览页只有一个分组，跳过）
  └── type=video → 进入视频分组列表页

列表页 /parse-result/list?type=xxx&...
  ├── 视频卡片列表（可选、分页、已入队状态）
  └── 批量操作（加入待下载）
```

#### 5.2 概览页（仅 type=user-space 需要完整概览页）

页面结构：

```text
┌──────────────────────────────────────┐
│ 用户信息区                            │
│ [头像]  用户名                         │
├──────────────────────────────────────┤
│ 视频分组：投稿视频                     │
│ [封面] [封面] [封面] [封面]            │  ← 前 4 个视频缩略图预览
│                            [进入 →]  │
├──────────────────────────────────────┤
│ 视频分组：合集A标题                    │
│ [封面] [封面] [封面] [封面]            │  ← 前 4 个视频缩略图预览
│                            [进入 →]  │
├──────────────────────────────────────┤
│ 视频分组：合集B标题                    │
│ [封面] [封面] [封面] [封面]            │
│                            [进入 →]  │
└──────────────────────────────────────┘
```

- 用户信息区显示头像和用户名
- 每个视频分组显示标题 + 前 4 个视频的缩略图预览 + "进入"按钮
- 用户点击"进入"按钮跳转到该分组的列表页
- 概览页不可选择或操作视频

#### 5.3 列表页

页面结构：

```text
┌──────────────────────────────────────┐
│ 分组标题（如"投稿视频"、"合集A标题"）   │
├──────────────────────────────────────┤
│ ☐ [封面] 视频A标题            10:30   │  ← 普通样式
├──────────────────────────────────────┤
│ ☐ [封面] 视频B标题 P1          5:20   │  ← 左侧色条（同一视频分组）
│ ☐ [封面] 视频B标题 P2          8:15   │  ← 左侧色条
│ ☐ [封面] 视频B标题 P3          6:40   │  ← 左侧色条
├──────────────────────────────────────┤
│ ☐ [封面] 视频C标题            12:10   │  ← 普通样式（新分组）
├──────────────────────────────────────┤
│           [加载更多]                   │
├──────────────────────────────────────┤
│ 已选择 3 项    [加入待下载]            │
└──────────────────────────────────────┘
```

#### 5.4 视频分组列表展示规则

**核心设计：逻辑两层、视觉一层**

列表中的条目粒度是"分P"，不是"视频"。每个分P 都是列表中一个独立可选的条目。

| 规则 | 说明 |
|---|---|
| 条目粒度 | 每个分P 是一个独立条目，可单独选择和加入待下载 |
| 无分P 的视频 | 作为单个条目展示，标题为视频标题 |
| 有分P 的视频 | 每个分P 一个条目，标题格式：`{视频标题} P{n}` |
| 封面 | 同一视频的所有分P 复用该视频的封面 |
| 视觉分组 | 同一视频的分P 用左侧色条 + 组内紧凑间距区分；不同视频之间用较大间距断开 |
| 可选择性 | 每个条目独立可选（checkbox） |

#### 5.5 视频链接解析后的展示

| 情况 | 列表页内容 |
|---|---|
| 独立视频，无合集，无分P | 只有一个条目：该视频本身 |
| 独立视频，无合集，有分P | 多个条目：该视频的每个分P |
| 视频属于 UGC 合集 | 多个条目：合集下所有视频，当前视频高亮标记 |
| 视频属于 UGC 合集且有分P | 多个条目：合集下所有视频的所有分P，统一平铺 |

#### 5.6 已入队状态

- 列表页加载时，通过 `POST /api/tasks/check` 批量检查条目的 `bvid + cid` 是否已在下载队列
- 已入队的条目标记为"已入队"状态，不可重复选择
- 已入队状态的展示方式与现有 `VideoDetail.vue` 保持一致

#### 5.7 加入待下载

- 用户在列表页选择条目后，点击"加入待下载"按钮
- 批量加入待下载的交互方式与现有 `VideoDetail.vue` 一致
- 加入后更新条目状态为"已入队"

#### 5.8 AI 总结

- 列表页提供"AI 总结"操作入口
- "AI 总结"指使用多模态大模型对视频内容进行总结，与现有"解析视频"（获取清晰度/编码选项）是不同的操作
- AI 总结的具体交互和实现待后续需求单独讨论

#### 5.9 与现有 VideoDetail.vue 的关系

- 新页面是 `VideoDetail.vue` 的改版
- `VideoDetail.vue` 暂时保留，作为异常情况下的回退
- 后续新页面稳定后再考虑移除 `VideoDetail.vue`

#### 5.10 type=video 且有 UGC 合集时的跳转

- 前端自行处理跳转逻辑，不需要后端在 `parse-link` 响应中给出跳转建议
- 后端需保证 `VideoInfo` 中包含完整的 `ugcSeason` 信息（含 `seasonId`），供前端提取并跳转到合集列表页

#### 5.11 错误处理

- `parse-link` 解析失败时（无效链接、B站API超时、不支持的路径），前端弹出错误提示
- 错误提示中展示接口返回的具体错误信息

#### 5.12 路由结构

| 路由 | 说明 |
|---|---|
| `/parse-result?input=xxx` | 概览页 |
| `/parse-result/list?type=user-videos&mid=xxx` | 用户投稿视频列表页 |
| `/parse-result/list?type=ugc-season&seasonId=xxx` | UGC 合集视频列表页 |
| `/parse-result/list?type=favorites&mediaId=xxx` | 收藏夹视频列表页 |
| `/parse-result/list?type=video&bvid=xxx` | 单个视频列表页 |

#### 5.13 首页输入框

- `Home.vue` 的 placeholder 更新为支持多种链接类型的提示
- 提交后跳转到 `/parse-result?input=xxx`

### 6. 前端 API 调用流程

```text
用户粘贴链接 → 首页跳转 /parse-result?input=xxx
  ↓
POST /api/parse-link → 识别类型 + 首屏数据
  ↓
type=user-space → 概览页渲染用户信息 + 视频分组入口
type=ugc-season / favorites / video → 直接进入列表页
  ↓
列表页加载时 POST /api/tasks/check → 标记已入队状态
  ↓
用户滚动到底部 → GET /api/{type}/videos?page=N → 加载更多
  ↓
用户选择条目 → 加入待下载（复用现有逻辑）
```

## Out of Scope

- 不改变现有 `VideoDetail.vue` 的功能
- 不实现视频分析功能本身（分析功能在独立需求中覆盖）
- 不实现收藏夹内视频的 UGC 合集关联
- 不实现 POST 请求支持（当前所有新增 B 站 API 均为 GET）

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
| `packages/server/src/video/video.controller.ts` | 废弃 `GET /api/video/info` |
| `packages/frontend/src/views/ParseResult.vue` | 新增概览页 |
| `packages/frontend/src/views/ParseResultList.vue` | 新增列表页 |
| `packages/frontend/src/api/index.ts` | 新增 `parseLink` 和分页 API 调用 |
| `packages/frontend/src/router/index.ts` | 新增路由 |
| `packages/frontend/src/types/index.ts` | 新增类型定义 |
| `packages/frontend/src/views/Home.vue` | 更新 placeholder 和跳转目标 |

## Acceptance Criteria

1. 粘贴视频链接时，返回视频信息 + 所属 UGC 合集信息
2. 粘贴用户空间链接时，返回用户信息 + 投稿视频第一页 + UGC 合集列表
3. 粘贴 UGC 合集链接时，返回合集信息 + 合集下视频第一页
4. 粘贴收藏夹链接时，返回收藏夹信息 + 收藏夹内视频第一页
5. 不支持的路径（如 `/audio`）返回明确的错误提示
6. 分页 API 正常工作，`hasMore` 字段正确标识是否还有更多数据
7. 概览页（type=user-space）显示用户信息 + 视频分组入口 + 前 4 个视频预览
8. 列表页根据分组类型展示视频卡片列表，支持分页加载
9. 列表页中同一视频的多个分P 通过左侧色条和间距区分，标题格式为 `{视频标题} P{n}`
10. 列表页中每个条目可独立选择，已入队的条目标记为不可选
11. 选择条目后可加入待下载，交互方式与现有 `VideoDetail.vue` 一致
12. 列表页提供"AI 总结"操作入口（具体交互待后续需求）
13. `POST /api/parse-link` 作为新页面的链接识别入口；`GET /api/video/info` 标记为废弃但保留可用，供 `VideoDetail.vue` 回退使用
14. 解析失败时弹出错误提示，展示接口返回的具体错误信息
15. `VideoInfo` 中包含完整的 `ugcSeason` 信息，供前端提取 seasonId 跳转
16. `pnpm typecheck` 和 `pnpm build` 通过
