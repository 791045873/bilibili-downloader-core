# Plan: 投稿视频列表项状态徽标与状态筛选

## Objective

在投稿视频列表页（`ParseResultList.tsx`，`type=user-videos`）为每个视频项展示两类状态，并提供表单筛选（两类状态可分别筛选）。

- 下载队列：`已下载`（下载成功）、`下载中`（正在下载）
- AI 分析队列：`正在分析`、`分析完成`

视频项若无相关状态则不显示徽标。筛选器对当前页项做客户端过滤。

## State Mapping

| 状态 | 判定条件 |
| --- | --- |
| 下载中 | 任务 `status === "downloading"` |
| 已下载 | 任务 `status === "success"` |
| 正在分析 | 分析任务 `summaryStatus` 为 `pending` 或 `analyzing` |
| 分析完成 | 分析任务 `summaryStatus === "completed"` |

`created` / `stopped` / `failed`（下载）及 `failed` / `none`（分析）不显示徽标。

## Data Source

`checkTasks`（`POST /api/tasks/check`）当前只返回下载任务信息，缺分析状态。扩展该端点：

- `DatabaseService.findTasksByBvidsAndCids`：SQL 增加 `LEFT JOIN ai_summary_task` 并选择 `ast.status AS summaryStatus`（与既有 `taskSelectSql` 一致）。
- 响应为**新增字段**，不改动既有字段，非破坏性变更；`VideoDetail.tsx` 仅消费 `id/bvid/cid`，不受影响。

## Changed Files

1. `packages/server/src/database/database.service.ts` — `findTasksByBvidsAndCids` 增加 summaryStatus 查询
2. `packages/frontend/src/api/index.ts` — `checkTasks` 返回类型增加 `summaryStatus?: string`
3. `packages/frontend/src/pages/ParseResultList.tsx` — `ListItem` 增加 `summaryStatus`；渲染两类徽标；新增下载/分析状态筛选表单（`Select`，全部/已下载/下载中、全部/正在分析/分析完成）

## Verification

- `pnpm --filter @bilibili-downloader/server typecheck`
- `pnpm --filter @bilibili-downloader/frontend typecheck`
- `pnpm typecheck`

## Audit

`Audit: cold-replay`。本计划为 UI 功能 + 新增 API 字段，非 protected 区域、非高风险；reviewer availability 为 `none`，采用冷回放自检并记录该限制。

## Closure

2026-08-15 关闭。

- 冷回放自检发现并修复：下载筛选原实现用 `downloadFilter("downloaded") !== item.taskStatus("success")` 判定，导致「已下载」筛选恒空；已改为按 `"downloading"`/`"success"` 分别判定。
- 验证：server / frontend / 全仓 `pnpm typecheck` 全部通过。
- 记录：`docs/logs/2026/08-15.md`。

