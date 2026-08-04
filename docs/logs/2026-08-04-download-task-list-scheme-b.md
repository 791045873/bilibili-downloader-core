# 2026-08-04 下载任务列表方案 B 实现日志

## Summary

- 将下载任务页从本地 `taskId` 队列驱动切换为服务端分页任务列表。
- 服务端 `GET /api/tasks` 新增 `page`、`pageSize`、`statusGroup` 查询参数与分页响应结构。
- 下载任务页移除“清空已完成”，改为状态过滤；轮询范围收敛为当前页非终态任务。
- 任务级 AI 总结触发入口新增基于资源级 AI 总结主记录的“进行中重复触发”冲突拦截。
- `AnalysisTriggerService` 开始在 pending / analyzing / completed / failed 阶段同步写入资源级 `ai_summary_task` 主记录。

## Implemented

- `packages/server/src/database/database.service.ts`
  - 新增 `TaskStatusGroup`、`PaginatedTaskResult`
  - 新增 `listTasksPaginated()`
  - 新增状态组过滤映射：`active -> created + downloading`
- `packages/server/src/download/download.service.ts`
  - 新增 `getTasksPaginated()`
- `packages/server/src/download/download.controller.ts`
  - `GET /api/tasks` 改为分页与过滤查询
  - 新增 `page` / `pageSize` / `statusGroup` 参数校验
- `packages/frontend/src/types/index.ts`
  - 新增 `TaskStatusGroup`、`PaginatedTasks`
- `packages/frontend/src/api/index.ts`
  - `getTasks()` 改为请求分页响应
- `packages/frontend/src/views/Downloading.vue`
  - 改为服务端列表驱动
  - 新增状态过滤与 pageSize 切换
  - 新增分页栏
  - 仅轮询当前页非终态任务
  - 移除本地 `queueStore.taskIds` 驱动和“清空已完成”按钮
- `packages/server/src/analysis/analysis-task.controller.ts`
  - 对资源级 AI 总结进行中的重复触发返回 `409`
- `packages/server/src/analysis/analysis-trigger.service.ts`
  - 在 pending / analyzing / completed / failed 阶段同步写入 `ai_summary_task`

## Verification

- `pnpm typecheck`: 通过
- `pnpm build`: 通过

## Remaining Verification

- 仍需补 focused runtime / UI 级验证：
  - `GET /api/tasks` 的非法分页参数与状态过滤负向契约
  - pageSize 切换后的分页上下文与旧轮询释放
  - 当前页轮询仅覆盖非终态任务的浏览器侧行为
  - 已完成任务 AI 总结成功触发后的按钮文案与状态恢复
  - 同资源重跑仍只保留 1 条资源级 AI 总结任务记录

## Notes

- 当前仅更新实现、owner doc 与执行日志；`project-context` / `backlog` / `plan audit` 的 blocker 仍保持不变，等待后续 focused verification 与独立 closure / re-audit 证据。
