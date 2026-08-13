# 2026-08-13 解析结果列表与 AI 总结任务分页及筛选

## Source

- Owner Doc: `docs/design/app-overview.md`
- 用户直接需求（已澄清分页每页条数与更新时间筛选形式）
- Live Baseline: `packages/frontend/src/views/ParseResultList.vue`、`packages/frontend/src/views/AiSummaryTasks.vue`、`packages/frontend/src/api/index.ts`、`packages/frontend/src/types/index.ts`、`packages/server/src/database/database.service.ts`、`packages/server/src/analysis/analysis-trigger.service.ts`、`packages/server/src/analysis/analysis-task.controller.ts`、`packages/server/src/parse/parse.controller.ts`、`packages/server/src/parse/parse.service.ts`

## Problem

1. `/parse-result/list` 路由的视频列表（投稿视频 / UGC 合集 / 收藏夹）当前用"加载更多"按钮追加下一页，缺少明确的页码、总条数与"上一页/下一页"导航，无法直观跳页。
2. AI 总结任务列表 `GET /api/summary-tasks` 返回全量数组，前端无分页；任务数量多时列表过长，且无法按状态筛选、按视频标题搜索、按更新时间筛选，定位单条记录困难。

## 已确认的产品决策（用户确认）

1. "按更新时间筛选"采用**起止日期范围**：提供起始日期与结束日期两个输入，筛选 `updated_at` 落在闭区间内的记录；两个输入均可留空表示不限。
2. 分页"每页条数"跟随下载任务列表既有模式：默认 20 条/页，可选 10 / 20 / 50。

## Goal

- `/parse-result/list` 视频列表由"加载更多"改为服务端分页（页码 + 上一页/下一页 + 每页条数选择器）。
- AI 总结任务列表改为服务端分页，并支持按状态筛选、按视频标题搜索、按更新时间（起止日期范围）筛选。

## In Scope

- `ParseResultList.vue`：移除"加载更多"追加逻辑，改为服务端分页（复用后端已返回的 `PaginatedVideos.total/hasMore`）；单视频类型（`type=video`）无分页，不显示分页控件。
- `GET /api/summary-tasks` 增加查询参数 `page`、`pageSize`、`status`、`search`、`updatedFrom`、`updatedTo`；响应由数组改为分页对象 `{ items, page, pageSize, total, hasMore }`（`items` 仍为 `AiSummaryTaskView`，不含 `rawResponse`）。
- `DatabaseService` 新增按条件分页查询 AI 总结任务（状态精确匹配、标题模糊匹配、`updated_at` 闭区间比较）。
- `AnalysisTriggerService` 新增分页视图方法，把记录映射为视图（剔除 `rawResponse`、解析 `executionTiming`）。
- `AiSummaryTasks.vue`：新增状态筛选下拉、标题搜索框、起止日期输入、每页条数选择器与上一页/下一页导航；筛选条件变化时重置到第 1 页。
- `api/index.ts`、`types/index.ts`：新增分页类型与带参数的 `getAiSummaryTasks`。

## Out Of Scope

- 不新增 AI 总结任务列表的自动刷新（保持"点击按钮刷新"）。
- 不改动下载任务列表（`GET /api/tasks` 已有服务端分页与状态过滤）。
- 不改动 `/parse-result` 概览页与后端 `parse.service.ts` / `parse.controller.ts`（已返回 `total`，无需改）。
- 不改动删除、重新总结、查看原始、重新构建等既有 AI 总结操作语义。
- 不对历史任务回溯补写任何字段。

## User Flows

### Flow 1: 解析结果列表分页

1. 用户进入 `/parse-result/list?type=user-videos&mid=xxx`（或 ugc-season / favorites）。
2. 页面默认加载第 1 页（每页 20 条），底部显示"第 1 / N 页"、上一页/下一页、每页条数选择器与总条数。
3. 用户点击"下一页"或切换每页条数（重置到第 1 页）后，页面重新请求对应页数据并整体替换列表，而非追加。
4. `type=video`（单视频分 P / 归属合集）不显示分页控件。

### Flow 2: AI 总结任务分页与筛选

1. 用户进入 AI 总结任务页，默认加载第 1 页（每页 20 条）全量记录。
2. 用户选择状态（全部 / 待处理 / 处理中 / 完成 / 失败）→ 列表按状态过滤并回到第 1 页。
3. 用户在搜索框输入标题关键字并提交 → 列表按标题模糊匹配过滤并回到第 1 页。
4. 用户选择起始/结束日期（可只填其一）→ 列表按 `updated_at` 闭区间过滤并回到第 1 页。
5. 多条件叠加时按 AND 语义共同生效。
6. 翻页、切换每页条数、筛选、搜索均重新请求服务端；刷新按钮仍只刷新当前页。

## API Contract

### 修改：`GET /api/summary-tasks`

查询参数：

- `page`（正整数，默认 1）
- `pageSize`（正整数，默认 20）
- `status`：`all` | `pending` | `analyzing` | `failed` | `completed`（默认 `all`；非法值返回 HTTP 400）
- `search`（可选字符串，非空时对标题做模糊匹配 `%search%`；标题为空按不匹配处理）
- `updatedFrom`（可选，ISO 8601 时间字符串；非法返回 HTTP 400）
- `updatedTo`（可选，ISO 8601 时间字符串；非法返回 HTTP 400）

响应（分页对象）：

```json
{
  "items": [ { ...AiSummaryTaskView, 不含 rawResponse } ],
  "page": 1,
  "pageSize": 20,
  "total": 42,
  "hasMore": true
}
```

- `updatedFrom` / `updatedTo` 共同生效时为闭区间 `updatedFrom <= updated_at <= updatedTo`。
- 非法 `page` / `pageSize`（非正整数）返回 HTTP 400（复用下载列表的 `parsePagination` 语义）。
- 排序维持 `updated_at DESC`。

## Acceptance Criteria

- [ ] `/parse-result/list` 的投稿视频 / UGC 合集 / 收藏夹列表使用服务端分页（页码 + 上一页/下一页 + 每页条数 10/20/50，默认 20），不再有"加载更多"追加；单视频类型不显示分页控件。
- [ ] `GET /api/summary-tasks` 支持 `page`/`pageSize`/`status`/`search`/`updatedFrom`/`updatedTo`，返回分页对象；`items` 不含 `rawResponse`。
- [ ] 状态筛选、标题搜索、更新时间区间筛选均正确过滤；多条件按 AND 叠加；筛选变化回到第 1 页。
- [ ] 非法 `page`/`pageSize`/`status`/`updatedFrom`/`updatedTo` 返回 HTTP 400。
- [ ] AI 总结任务页渲染分页控件、状态下拉、搜索框、起止日期输入；删除最后一条时页码正确回退；刷新/删除/重新总结后列表按当前条件重新加载。
- [ ] 既有"查看原始 / 重新总结 / 删除 / 重新构建"操作语义不变。
- [ ] `pnpm typecheck`、`pnpm build` 通过。

## Open Questions

- 无（更新时间筛选形式与每页条数已由用户确认）。
