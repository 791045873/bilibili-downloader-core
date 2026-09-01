# Testing: 历史 AI 总结知识回填（一次性手动触发）

- 关联计划：`docs/plans/2026-09-01-knowledge-backfill-plan.md`
- 来源需求：`docs/requirements/2026-09-01-knowledge-backfill.md`
- 环境说明：需 `TENCENT_COS_*` 与 `DATABASE_URL`（已在 `packages/server/.env`）；当前库内 `ai_summary_task` 89 条 completed、`summary`/`summary_segment` 0 行。

## 验证命令基线

- `pnpm typecheck`
- `pnpm build`
- `pnpm --filter @bilibili-downloader/server start:dev`
- `pnpm docker:build:server`

## Testing Directions

### TD-1 触发与立即返回

- 覆盖：`POST /api/knowledge/backfill`
- 应可观察到：有可回填任务时触发返回成功（含 total=89），后台批次开始执行（进度接口可见 running + 计数增长）；请求不阻塞等待批次完成。
- 不应观察到：请求挂起直到批次跑完；触发后无任何后台活动。
- 状态：`pending`

### TD-2 批量发布正确入库

- 覆盖：发布管道复用
- 应可观察到：批次推进中，成功任务的 `knowledge_status` 变为 synced，云端 `summary`/`summary_segment` 行数增长，COS 出现对应截图对象。
- 不应观察到：同一 (bvid,cid) 出现重复 summary 行；批次完成时有任务停留在 pending。
- 状态：`pending`

### TD-3 进度与失败明细

- 覆盖：`GET /api/knowledge/backfill`
- 应可观察到：返回 running/idle 状态与 total/synced/skipped/failed 计数；失败任务在 failures 中有 summaryTaskId 与错误摘要（如截图/md 文件缺失）。
- 不应观察到：计数与库内实际 synced 数长期不一致（批次完成后）；失败明细缺失错误信息。
- 状态：`pending`

### TD-4 幂等与重复触发

- 覆盖：幂等语义
- 应可观察到：批次运行中再次 POST 返回 409/已在运行；批次完成后重新触发只处理非 synced 任务（已 synced 跳过，skipped 计数正确）；不产生重复数据。
- 不应观察到：重复触发产生重复发布或重复 COS 上传（已发布总结沿用既有 COS URL）。
- 状态：`pending`

### TD-5 单条失败不中断批次

- 覆盖：失败隔离
- 应可观察到：某条任务发布失败（如本地 md/截图缺失）时该条置 failed + knowledge_error，批次继续处理其余任务。
- 不应观察到：一条失败导致批次停止或后续任务未处理；失败影响其他任务的知识状态。
- 状态：`pending`

### TD-6 边界：无可回填任务

- 覆盖：空集行为
- 应可观察到：全部任务已 synced（或库内无 completed 任务）时触发返回 0 条可回填，不启动批次。
- 不应观察到：空集触发报错或启动空批次。
- 状态：`pending`

## 说明

- 真实 89 条的完整批量回填由用户部署镜像后触发，属需求交付物；本测试文档关闭时允许 TD-2 中"全量 89 条"部分以用户实际触发结果为准（标注 user-confirmed），开发期以抽样/小批量验证为主。
- TD-4/TD-5 可用单条 `POST /api/summary-tasks/:id/publish` 与手动制造文件缺失场景辅助验证。
