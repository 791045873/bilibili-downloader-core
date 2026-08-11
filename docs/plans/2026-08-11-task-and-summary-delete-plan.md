# Plan: 任务与 AI 总结记录删除操作

日期：2026-08-11
状态：completed（2026-08-11 独立闭核算 PASS-WITH-NOTES，Notes 已处理：日志已补、文件名已统一、删除改为条件 DELETE 关闭 TOCTOU 竞态）

## 背景与动机

用户希望为 AI 总结任务列表页与下载任务列表页提供记录删除能力。删除语义明确为：**仅删除数据库记录，不删除磁盘内容**；两条删除路径相互独立（删下载任务不联动删 AI 总结记录，反之亦然）。数据删除属受保护区（ask-first），已通过用户确认决策后进入实施。

## 已确认的产品决策

1. 下载任务页保留 `downloading` 态的"取消"按钮，其余状态（`created`/`stopped`/`failed`/`success`）新增"删除"按钮。
2. 删除下载任务不联动删除该资源 `ai_summary_task` 记录。
3. 删除按钮不弹确认框。
4. AI 总结记录处于 `pending`/`analyzing` 时禁止删除（返回 409 冲突），避免后台管道结束时以新 id 重新写入该记录。

## Scope（实施项）

### 后端

1. `packages/server/src/database/database.service.ts`：新增 `getAiSummaryTaskById(id: number)`（按 id 读记录，供 controller 区分 404/409）与 `deleteAiSummaryTask(id: number): boolean`（`DELETE FROM ai_summary_task WHERE id = ?`，返回 changes > 0），并 `logger.log` 记录删除。
2. `packages/server/src/analysis/analysis-trigger.service.ts`：新增 `getAiSummaryTaskById` 与 `deleteAiSummaryTask` 包装方法，转发 db。
3. `packages/server/src/analysis/analysis-task.controller.ts`：新增 `@Delete("/summary-tasks/:id")`，非法 id → 400 `无效的任务 ID`（logger.warn）；按 id 查不到 → 404 `AI 总结任务不存在`；`pending`/`analyzing` → 409 `进行中的 AI 总结不可删除`；成功 → `{ message: "已删除" }`。
4. 下载任务删除链路（`DELETE /api/tasks/:id`）不改动，复用现有 `DatabaseService.deleteTask`（先删 `analysis_sub_task` 再删 `task`，不动磁盘、不碰 `ai_summary_task`）。

### 前端

5. `packages/frontend/src/api/index.ts`：新增 `deleteAiSummaryTask(id: number): Promise<void>`（仿 `deleteTask`）。
6. `packages/frontend/src/views/AiSummaryTasks.vue`：表格新增"操作"列，行内"删除"按钮；`pending`/`analyzing` 行按钮禁用（提示"进行中"），其余状态可删；点击后调 `deleteAiSummaryTask`，失败写 `error` ref，成功重拉列表（`loadTasks`）。
7. `packages/frontend/src/views/Downloading.vue`：在卡片操作区新增通用"删除"按钮，`v-if="task.status !== 'downloading'"`，复用现有 `handleDelete`；`downloading` 态保留"取消"。

### 文档

8. `docs/design/app-overview.md`：Integration Points 新增 `DELETE /api/tasks/:id`（现有链路补记）与 `DELETE /api/summary-tasks/:id`，并明确两条删除语义（仅删 DB、不动磁盘、不联动、进行中总结禁删）。
9. `docs/context/codebase-map.md`：视频分析/下载路由行验证日期更新。
10. `docs/context/project-context.md`：active requirement / active plan 更新为本需求与本计划。
11. `docs/logs/2026/08-11.md`：追加实施记录。
12. 新增 `docs/testing/2026/08-11-task-and-summary-delete.md`：记录 API/DB 冒烟证据（含用 DB 直接 UPDATE 构造 pending/analyzing 记录的说明）。

## 明确不做

- 不删除任何磁盘文件（媒体/截图/summary 输出）。
- 不联动删除、不弹确认、不改下载任务现有删除语义。
- 不增加 AI 总结列表分页，不改变 AI 总结触发/状态机/资源唯一性。

## 验证命令

- `pnpm --filter @bilibili-downloader/server typecheck`、`pnpm typecheck`：通过。
- `pnpm build`：通过。
- API + DB 冒烟：
  - 启动 server，向 `ai_summary_task` 插入一条记录并生成一个占位 summary 输出文件，`DELETE /api/summary-tasks/:id` 后确认记录消失、占位文件仍在。
  - `DELETE /api/summary-tasks/:id`（pending/analyzing 记录）→ 409；`DELETE /api/summary-tasks/999999`（不存在）→ 404；`DELETE /api/summary-tasks/abc` → 400。
  - 构造一个含 `analysis_sub_task` 的下载任务，删除任务后确认两条记录都消失、`ai_summary_task` 同资源记录仍在、磁盘文件仍在。
- 前端构建：`pnpm frontend:build`（或 `pnpm --filter @bilibili-downloader/frontend typecheck`）通过。

## 风险与退出标准

- 无单元测试设施（project-context 确认 unit tests = none），验证以 typecheck/build + API/DB 冒烟为准，人工运行级确认留用户。
- 数据删除为受保护区：owner doc（app-overview.md）在本次同步更新，冒烟证据写入日志与 testing 文档。
- 前端 `request()` 对非 2xx 只取 `err.error`；新 DELETE 端点用 NestJS 异常，错误文案显示为异常短名（如 "Not Found"）。可接受，与既有 `triggerTaskAiSummary` 一致，不做额外改动。

## Audit

- 独立 subagent 计划审计（task `ses_00e9a4346ffe...`）：REVISE，必修 2 项（进行中删除语义定案为 409、request() 措辞）＋建议 4 项。
- 复审（task `ses_00e8ff39fffe...`）：APPROVED-WITH-NOTES（getAiSummaryTaskById、前端禁用态、pending 构造说明）。
- 独立闭核算（explore subagent，task `ses_00e8343a7ffe...`）：PASS-WITH-NOTES。Notes 全部处理：日志补写、testing 文件名统一、删除改为条件 `DELETE ... WHERE status NOT IN ('pending','analyzing')` 关闭 TOCTOU 竞态。
