# 2026-08-11 任务与 AI 总结记录删除操作

## Source

- Related Requirement: `docs/requirements/2026-08-03-download-task-list-ai-summary.md`
- Owner Doc: `docs/design/app-overview.md`
- Live Baseline: `packages/frontend/src/views/Downloading.vue`, `packages/frontend/src/views/AiSummaryTasks.vue`, `packages/server/src/analysis/analysis-task.controller.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`, `packages/server/src/database/database.service.ts`, `packages/server/src/download/download.controller.ts`

## Problem

下载任务列表页与 AI 总结任务列表页目前都只有"进入"没有"清理"：任务记录与 AI 总结记录只能不断累积，用户无法删除不再需要的数据库记录。用户希望提供删除能力，且删除**仅作用于数据库记录，不删除任何磁盘内容**（媒体文件、summary 输出文件都保留）。

## Goal

- AI 总结任务列表页为每条记录提供"删除"操作：删除 `ai_summary_task` 中的这条记录，不删除磁盘上的 summary 输出文件。
- 下载任务列表页为每个任务提供"删除"操作：删除该下载任务及其下载子任务记录，不删除磁盘内容。
- 两条删除路径相互独立：删除下载任务不联动删除该资源的 AI 总结记录，反之亦然。

## In Scope

- AI 总结任务列表页（`AiSummaryTasks.vue`）新增"操作"列与"删除"按钮。
- 服务端新增 AI 总结任务记录删除接口 `DELETE /api/summary-tasks/:id`。
- 下载任务列表页为 `created` / `stopped` / `failed` / `success` 状态任务新增"删除"按钮；`downloading` 状态沿用现有"取消"按钮（行为同为删除记录）。
- 复用现有下载任务删除链路（`DELETE /api/tasks/:id` → `DownloadScheduler.deleteTask` → `DatabaseService.deleteTask`），不改后端删除语义。
- 明确并固化"删除仅删数据库记录、不动磁盘"的语义到 owner doc。

## Out Of Scope

- 不删除磁盘上的媒体文件、截图、summary 输出文件。
- 不联动：删除下载任务时不删除该资源 `ai_summary_task` 记录；删除 AI 总结记录时不删除下载任务记录。
- 不增加删除确认弹窗（用户明确不需要）。
- 不改变 AI 总结触发、状态机与资源唯一性语义。
- 不为 AI 总结任务列表增加分页。

## User Flows

### Flow 1: 删除 AI 总结记录

1. 用户进入 AI 总结任务列表页，某条记录所在行"操作"列显示"删除"按钮。
2. 用户点击"删除"。
3. 前端调用 `DELETE /api/summary-tasks/:id`。
4. 服务端删除 `ai_summary_task` 中对应记录。
5. 前端重新加载列表；该记录消失，磁盘上的 summary 输出文件保留。
6. 若该视频资源在下载任务列表页存在对应下载任务，其 AI 总结按钮文案因记录已删而从"重新 AI 总结"恢复为"立刻 AI 总结"。

### Flow 2: 删除下载任务记录

1. 用户进入下载任务列表页，某任务（`created`/`stopped`/`failed`/`success`）行显示"删除"按钮（`downloading` 状态仍显示"取消"）。
2. 用户点击"删除"（或"取消"）。
3. 前端调用 `DELETE /api/tasks/:id`；若任务正在下载，服务端先中止下载再删除。
4. 服务端删除该任务的 `analysis_sub_task` 与 `task` 记录。
5. 前端重新加载当前页；任务记录消失，磁盘上的已下载/部分下载内容保留。
6. 若该资源存在 `ai_summary_task` 记录，该记录不受影响，仍在 AI 总结任务列表页可见。

## API Contract

### 新增：`DELETE /api/summary-tasks/:id`

- `id` 必须为正整数；非法 id 返回 HTTP 400（`无效的任务 ID`）。
- 记录不存在返回 HTTP 404（`AI 总结任务不存在`）。
- 记录处于 `pending` / `analyzing` 时返回 HTTP 409（`进行中的 AI 总结不可删除`），避免后台管道结束时以新 id 重新写入同资源记录。
- 成功返回 HTTP 200：`{ "message": "已删除" }`。
- 仅删除 `ai_summary_task` 记录，不删除磁盘文件、不影响下载任务。

### 复用：`DELETE /api/tasks/:id`

- 现有删除链路不变，语义保持"删数据库记录、不动磁盘、不联动删 AI 总结记录"。

## Acceptance Criteria

- [ ] AI 总结任务列表页每条记录有"删除"按钮。
- [ ] 点击删除后调用 `DELETE /api/summary-tasks/:id`，成功后列表刷新、该记录消失。
- [ ] 删除 AI 总结记录后，summary 输出文件仍存在于磁盘。
- [ ] `DELETE /api/summary-tasks/:id` 对非法 id 返回 400、对不存在记录返回 404、对 `pending`/`analyzing` 记录返回 409。
- [ ] 下载任务列表页 `created`/`stopped`/`failed`/`success` 状态任务有"删除"按钮；`downloading` 状态保留"取消"。
- [ ] 点击删除后复用现有 `DELETE /api/tasks/:id` 链路，成功后列表刷新、该任务消失。
- [ ] 删除下载任务后，磁盘内容（已完成/部分下载文件）不被删除。
- [ ] 删除下载任务不删除该资源的 `ai_summary_task` 记录。
- [ ] `pnpm typecheck`、`pnpm build` 通过。

## Open Questions

- 无（删除语义、按钮分布、是否联动、是否确认已由用户确认）。
