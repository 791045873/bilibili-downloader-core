# Testing — P0 测试基座与 Prisma schema 基线

- 日期：2026-09-01
- Plan：`docs/plans/2026-09-01-prisma-p0-test-harness-and-baseline-plan.md`
- 结果：**PASS**（40/40 tests，`pnpm typecheck`、`pnpm build` 通过）

## 自动化测试

- 框架：vitest ^2.1.8（沿用 bilibili-api-sdk 模式），`fileParallelism: false` 串行跑文件
- 测试库：一次性 `postgres:17` 容器（端口 55432，db `bdl_test`）；隔离方式为每用例前 TRUNCATE 全部业务表（RESTART IDENTITY CASCADE）
- 命令：`$env:TEST_DATABASE_URL='postgres://postgres:postgres@localhost:55432/bdl_test'; pnpm --filter @bilibili-downloader/server test`
- 结果：`Test Files 7 passed (7) / Tests 40 passed (40)`

| 文件 | 覆盖 |
| --- | --- |
| task.test.ts | 插入默认值、进度/状态更新、FIFO 抢占 + 并发恰一次、状态组分页、JOIN summaryStatus、元组去重、删除契约（保留 summary/summary_segment）、clearTasks |
| analysis-sub-task.test.ts | 子任务 CRUD、partial unique index 活跃唯一/failed 豁免、supersede 迁移幂等 + 索引重建 |
| ai-summary-task.test.ts | claim 守卫（新建/拒绝/re-claim 重置与保留字段，含 summary_output 不重置现状）+ 并发恰一次、upsert 字段保留（含 createdAt；lastCompletedAt 未提供即抹除的现状）、条件删除 boolean 契约、列表过滤（ILIKE 转义/时间窗/分页）、knowledge status、启动对账、summary_status 合并迁移幂等 |
| ai-prompt.test.ts | 播种幂等、排序、update/delete、default 非互斥怪癖（set 不清其他 default）、creator binding |
| settings.test.ts | upsert/空串删除/缺失键 |
| knowledge.test.ts | summary+segments 首写、重复发布全量替换（事务幂等） |
| type-semantics.test.ts | int8→number（id/cid/fileSize/durationMs/mid）、timestamptz→ISO UTC 字符串、历史 "YYYY-MM-DD HH:MM:SS+08" 格式归一化 |

## 测试钉住的行为怪癖（P2 迁移时必须等价保留）

1. `task.summaryStatus` 读取侧来自 JOIN `ai_summary_task`，无对应行时为 null（task 自身 `summary_status='none'` 被镜像覆盖）。
2. re-claim（claimAiSummaryTask 冲突更新）不重置 `summary_output`，只重置 execution_timing/raw_response/model_name，保留 lastCompletedAt。
3. `upsertAiSummaryTask` 未提供 `lastCompletedAt` 时将其抹为 null（与 promptId/executionTiming/rawResponse/modelName/createdAt 的保留语义不同）。
4. `setAiPromptDefault` 不清除其他 is_default=1（默认非互斥）。
5. `deleteTask` 非事务两步删除且不清理 `summary`/`summary_segment`。

## Prisma 基线

见 `packages/server/prisma/baseline/README.md`（infer/emit/sign/verify 全流程实测通过，`db verify` ok:true；逐表核对 7 项注记，含 `updated_at DESC` 排序方向丢失项）。

## 产物清单

- 新增：`packages/server/vitest.config.ts`、`packages/server/tests/`（helper + 7 个测试文件）、`packages/server/prisma/baseline/{contract.prisma,README.md}`
- 修改：`packages/server/package.json`（+`test` 脚本、+vitest devDep）
- 产品源码 `src/`：零改动
