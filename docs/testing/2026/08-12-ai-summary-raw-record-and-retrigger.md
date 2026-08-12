# Testing - AI 总结原始返回记录与列表重新总结（2026-08-12）

需求：`docs/requirements/2026-08-12-ai-summary-raw-record-and-retrigger.md`
计划：`docs/plans/2026-08-12-ai-summary-raw-record-and-retrigger-plan.md`

## 验证方式

项目无单元测试设施，采用 typecheck/build + API/DB 冒烟验证。冒烟脚本为一次性脚本（`$TEMP/opencode/raw-retrigger-smoke/smoke.cjs`，未入库）：临时 OUTPUT_DIR 启动 server → 直接向 SQLite 种子数据 → fetch 断言 → 同 DB 重启验证迁移幂等。

## 自动化验证结果

- `pnpm typecheck`：通过（全部 6 个 workspace 包）。
- `pnpm build`：通过（全部 6 个 workspace 包）。

## API/DB 冒烟（临时 OUTPUT_DIR，隔离真实数据）

环境：`node dist/main.js`（PORT=3121，OUTPUT_DIR=临时目录），23 项检查全部 PASS（含"查看原始返回"与"错误作为返回记录"检查）：

| 检查 | 结果 |
| --- | --- |
| server ready（GET /api/summary-tasks 200） | PASS |
| 列表含种子记录，且暴露 `modelName` | PASS |
| 列表记录不含 `rawResponse` 字段 | PASS |
| GET /api/summary-tasks/:id/raw-response（completed 含 raw）→ 200 且返回原文 | PASS |
| GET /api/summary-tasks/:id/raw-response（pending，raw 为 null）→ 200 且返回 `null` | PASS |
| GET /api/summary-tasks/:id/raw-response（failed，raw=错误文本）→ 200 且返回错误文本 | PASS |
| GET /api/summary-tasks/abc/raw-response（非法 id）→ 400 | PASS |
| GET /api/summary-tasks/999999/raw-response（不存在）→ 404 | PASS |
| POST /api/summary-tasks/abc/retrigger（非法 id）→ 400 | PASS |
| POST /api/summary-tasks/999999/retrigger（不存在）→ 404 | PASS |
| POST /api/summary-tasks/:id/retrigger（pending）→ 409 | PASS |
| POST /api/summary-tasks/:id/retrigger（completed 但无下载任务）→ 409 | PASS |
| POST /api/summary-tasks/:id/retrigger（completed + success 任务）→ 200 `{message:"AI 总结触发中"}` | PASS |
| retrigger 后该记录离开 completed（认领置进行中/后续按管线落 failed/completed） | PASS |
| retrigger 后旧 `raw_response` 被移除（离线管线可能已把新错误写入 `raw_response`） | PASS |
| retrigger 后 `model_name` 被清空（认领即清） | PASS |
| retrigger 后下载任务 `auto_summary` 置 1 | PASS |
| retrigger 后 GET 列表仍不含 `rawResponse` | PASS |
| 同 DB 重启 server（迁移幂等）正常 | PASS |

说明：retrigger 触发的后台管线在无真实 B 站网络环境中会快速失败并落 `failed`，属预期；"认领即清 raw/model、置 auto_summary、离开 completed"等同步可断言行为已覆盖。真实管线（analyzing → completed 并写入 raw_response/model_name）需运行级验证。

## 人工运行级确认（留给用户）

- 配置 QWEN 相关环境变量并启动视觉代理，对真实资源触发 AI 总结，确认成功后 `ai_summary_task.raw_response` / `model_name` 写入本次模型返回与模型名。
- 再次触发同一资源总结，确认旧 `raw_response` / `model_name` 被清空后写入新结果。
- 在真实前端 AI 总结任务列表页确认"模型"列展示；对 `completed`/`failed` 记录点击"重新总结"，列表刷新并进入进行中；进行中行按钮禁用。
- 对无对应下载任务（下载任务已删除）的总结记录点击"重新总结"，确认前端展示 409 错误提示。
- 对 `completed` 记录点击"查看原始"，确认 Dialog 展示本次模型原始返回内容；对进行中/失败记录点击确认展示"无原始返回"。
- 制造模型调用报错（如停掉视觉代理）触发总结，确认记录落 `failed` 且 `raw_response` 保存错误信息；点击"查看原始"弹窗展示该错误信息。
