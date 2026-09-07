# 2026-09-07 下载队列页改为表格展示

## Scope

- 用户直接请求的单文件 UI 调整（no-plan 路径）：`packages/frontend/src/pages/Downloading.tsx` 卡片列表 → antd Table。
- 沿用 `AiSummaryTasks.tsx` 的表格模式（size small、columns 数组、外层 Pagination）。

## Changes

- 列：任务（标题 + 输出文件）、状态（Tag + 失败错误信息）、进度、大小、AI 总结、操作（暂停/恢复/取消/AI 总结/删除，条件与原卡片一致）。
- 轮询由逐任务详情查询（`getTaskById` 每 3s）改为列表级 `refetchInterval`：页内存在非终态任务时每 3s 刷新列表，全部终态自动停止。
- 停止/恢复/触发总结后的刷新统一走列表 refetch，移除 `["task", id]` 详情查询。

## Verification

- `pnpm --filter @bilibili-downloader/frontend typecheck` 通过。

## Follow-up: 表格列宽可调（同日第二次改动）

- 用户请求：下载任务表格与 AI 总结任务表格除操作列外列宽可调。
- 新增 `packages/frontend/src/components/useResizableColumns.tsx`：无新增依赖，通过 antd `components.header.cell` 自定义 th + `onHeaderCell` 透传 `onResize`，mousedown 后 window mousemove 更新列宽 state（最小 80px，默认 200px）。
- `Downloading.tsx` / `AiSummaryTasks.tsx`：操作列标记 `key: "actions"` 并在 hook 中排除，其余列均可拖拽调宽。
- Verification：`pnpm --filter @bilibili-downloader/frontend typecheck` 通过。
