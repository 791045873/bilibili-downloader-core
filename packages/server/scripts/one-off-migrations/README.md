# One-off Migrations（已归档）

本目录存放曾内嵌于 `DatabaseService.initSchema()` 启动流程的一次性数据迁移 SQL（P3 起启动流程不再执行任何 DDL/迁移，schema 由 Prisma contract/migration 管理，见 `docs/plans/2026-09-02-prisma-p3-schema-ownership-plan.md`）。

| 文件 | 作用 | 状态 |
| --- | --- | --- |
| `001-summary-status-merge.sql` | 历史 task.summary_status 合并进 ai_summary_task | 已随 0.0.x 在全部存量库执行过 |
| `002-analysis-sub-task-supersede.sql` | 旧活跃子任务标 failed + partial unique index 重建 | 已随 0.0.x 在全部存量库执行过 |

**勿在任何库重复执行。** 若存在未执行过它们的异常库（理论上不存在），人工核对后单独执行。

## 对应测试去向

- 001 的幂等用例：原 `tests/database/ai-summary-task.test.ts` "一次性状态合并迁移"——随归档删除（迁移逻辑不在产品路径）。
- 002 的幂等用例：原 `tests/database/analysis-sub-task.test.ts` "一次性 supersede 迁移"——随归档删除。
- partial unique index 行为用例保留（索引由 contract/`db init` 提供）。

## 相关脚本

- `migrate-sqlite-to-postgres.mjs`（本目录）：2026-08 的一次性 SQLite→PG 搬迁工具（依赖 `better-sqlite3` + `pg`，两者已于 P4 从依赖移除；如需再用临时 `pnpm add -D better-sqlite3`），与 Prisma 迁移无关，保留作历史工具。
