# 多类型链接解析前端页面 — 需求文档（4b）

> 拆分自 `2026-07-07-multi-link-parsing.md`
> 依赖 `2026-07-07-multi-link-parsing-4a.md`（后端 API）

## Goal

实现前端新页面，展示后端解析的多类型链接结果。包含概览页和列表页，支持视频分组展示、分页加载、已入队状态、批量加入待下载。

## Background

后端链接解析 API 已在 `2026-07-07-multi-link-parsing-4a.md` 中定义。当前前端首页只能粘贴单个视频链接跳转到 `VideoDetail.vue`，无法支持用户空间、UGC 合集等批量入口。

## 概念约定

- "视频分组" = 一个可进入的视频列表入口，在不同解析类型下含义不同（投稿视频、UGC 合集、收藏夹、单个视频及其分P）

## In Scope

### 1. 页面层级

```text
概览页 /parse-result?input=xxx
  ├── type=user-space → 显示用户信息 + 多个视频分组入口
  ├── type=ugc-season → 直接跳转到列表页
  ├── type=favorites → 直接跳转到列表页
  └── type=video → 进入视频分组列表页

列表页 /parse-result/list?type=xxx&...
  ├── 视频卡片列表（可选、分页、已入队状态）
  └── 批量操作（加入待下载）
```

### 2. 概览页（仅 type=user-space）

- 用户信息区显示头像和用户名
- 每个视频分组显示标题 + 前 4 个视频的缩略图预览 + "进入"按钮
- 用户点击"进入"按钮跳转到该分组的列表页
- 概览页不可选择或操作视频

### 3. 列表页

#### 3.1 视频分组列表展示规则

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

#### 3.2 视频链接解析后的展示

| 情况 | 列表页内容 |
|---|---|
| 独立视频，无合集，无分P | 只有一个条目：该视频本身 |
| 独立视频，无合集，有分P | 多个条目：该视频的每个分P |
| 视频属于 UGC 合集 | 多个条目：合集下所有视频，当前视频高亮标记 |
| 视频属于 UGC 合集且有分P | 多个条目：合集下所有视频的所有分P，统一平铺 |

#### 3.3 已入队状态

- 列表页加载时，通过 `POST /api/tasks/check` 批量检查条目的 `bvid + cid` 是否已在下载队列
- 已入队的条目标记为"已入队"状态，不可重复选择
- 已入队状态的展示方式与现有 `VideoDetail.vue` 保持一致

#### 3.4 加入待下载

- 用户在列表页选择条目后，点击"加入待下载"按钮
- 批量加入待下载的交互方式与现有 `VideoDetail.vue` 一致
- 加入后更新条目状态为"已入队"

#### 3.5 AI 总结入口

- 列表页提供"AI 总结"操作入口
- "AI 总结"指使用多模态大模型对视频内容进行总结，与现有"解析视频"（获取清晰度/编码选项）是不同的操作
- AI 总结的具体交互和实现见 `2026-07-07-ai-summary-interaction.md`

#### 3.6 分页加载

- 列表页底部有"加载更多"按钮或滚动加载
- 调用 `GET /api/{type}/videos?page=N` 获取更多

### 4. type=video 且有 UGC 合集时的跳转

- 前端自行处理跳转逻辑，不需要后端在 `parse-link` 响应中给出跳转建议
- 后端需保证 `VideoInfo` 中包含完整的 `ugcSeason` 信息（含 `seasonId`），供前端提取并跳转到合集列表页

### 5. 错误处理

- `parse-link` 解析失败时（无效链接、B站API超时、不支持的路径），前端弹出错误提示
- 错误提示中展示接口返回的具体错误信息

### 6. 路由结构

| 路由 | 说明 |
|---|---|
| `/parse-result?input=xxx` | 概览页 |
| `/parse-result/list?type=user-videos&mid=xxx` | 用户投稿视频列表页 |
| `/parse-result/list?type=ugc-season&seasonId=xxx` | UGC 合集视频列表页 |
| `/parse-result/list?type=favorites&mediaId=xxx` | 收藏夹视频列表页 |
| `/parse-result/list?type=video&bvid=xxx` | 单个视频列表页 |

### 7. 首页输入框

- `Home.vue` 的 placeholder 更新为支持多种链接类型的提示
- 提交后跳转到 `/parse-result?input=xxx`

### 8. 与现有 VideoDetail.vue 的关系

- 新页面是 `VideoDetail.vue` 的改版
- `VideoDetail.vue` 暂时保留，作为异常情况下的回退
- 后续新页面稳定后再考虑移除 `VideoDetail.vue`

## Out of Scope

- 不实现后端 API（在 `2026-07-07-multi-link-parsing-4a.md` 中）
- 不实现 AI 总结功能本身
- 不改变现有 `VideoDetail.vue` 的功能

## Affected Files

| 文件 | 改动 |
|---|---|
| `packages/frontend/src/views/ParseResult.vue` | 新增概览页 |
| `packages/frontend/src/views/ParseResultList.vue` | 新增列表页 |
| `packages/frontend/src/api/index.ts` | 新增 `parseLink` 和分页 API 调用 |
| `packages/frontend/src/router/index.ts` | 新增路由 |
| `packages/frontend/src/types/index.ts` | 新增类型定义 |
| `packages/frontend/src/views/Home.vue` | 更新 placeholder 和跳转目标 |

## Acceptance Criteria

1. 概览页（type=user-space）显示用户信息 + 视频分组入口 + 前 4 个视频预览
2. 列表页根据分组类型展示视频卡片列表，支持分页加载
3. 列表页中同一视频的多个分P 通过左侧色条和间距区分，标题格式为 `{视频标题} P{n}`
4. 列表页中每个条目可独立选择，已入队的条目标记为不可选
5. 选择条目后可加入待下载，交互方式与现有 `VideoDetail.vue` 一致
6. 列表页提供"AI 总结"操作入口
7. 解析失败时弹出错误提示，展示接口返回的具体错误信息
8. `Home.vue` 提交后跳转到 `/parse-result?input=xxx`
9. `pnpm typecheck` 和 `pnpm build` 通过
