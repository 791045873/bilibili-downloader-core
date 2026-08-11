# Testing - 任务与 AI 总结记录删除操作（2026-08-11）

需求：`docs/requirements/2026-08-11-task-and-summary-delete.md`
计划：`docs/plans/2026-08-11-task-and-summary-delete-plan.md`

## 验证方式

项目无单元测试设施，采用 typecheck/build + API/DB 冒烟验证。冒烟脚本为一次性脚本（`$TEMP/opencode/delete-smoke/smoke.py`，未入库）。

## 自动化验证结果

- `pnpm --filter @bilibili-downloader/server typecheck`：通过。
- `pnpm --filter @bilibili-downloader/frontend typecheck`：通过。
- `pnpm build`：通过（全部 6 个 workspace 包）。

## API/DB 冒烟（临时 OUTPUT_DIR，隔离真实数据）

环境：`node dist/main.js`（PORT=3110，OUTPUT_DIR=临时目录），13 项检查全部 PASS：

| 检查 | 结果 |
| --- | --- |
| GET /api/summary-tasks 200 | PASS |
| 种子数据在列表中可见 | PASS |
| DELETE /api/summary-tasks/:id（completed）→ 200 | PASS |
| 该 ai_summary_task 行已删除 | PASS |
| summary 占位输出文件仍在磁盘 | PASS |
| DELETE /api/summary-tasks/:id（pending）→ 409 | PASS |
| pending 行保留（未被误删） | PASS |
| DELETE /api/summary-tasks/999999（不存在）→ 404 | PASS |
| DELETE /api/summary-tasks/abc（非法）→ 400 | PASS |
| DELETE /api/tasks/:id → 200 | PASS |
| task 行已删除 | PASS |
| analysis_sub_task 行已删除 | PASS |
| 同资源 ai_summary_task 保留（不联动） | PASS |

pending/analyzing 记录构造：直接在 SQLite 中 `INSERT` 一条 `status='pending'` 的 `ai_summary_task`（服务器启动后的对账已跑完，不会覆盖）。若要测 `analyzing` 同理构造 `status='analyzing'`。

## 人工运行级确认（留给用户）

- 在真实前端页面上对 AI 总结列表行点击"删除"，确认列表刷新、记录消失、summary 输出文件仍在。
- 在真实下载任务列表页对 created/stopped/failed/success 任务点击"删除"，确认任务消失、磁盘文件仍在。
- downloading 任务仍显示"取消"，点击后中止并删除记录。
- 进行中 AI 总结记录按钮显示"进行中"禁用态，不可删除。
