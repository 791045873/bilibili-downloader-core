# Log — 2026-09-02 Prisma P3（schema 所有权切换）

- P3 plan（经 subagent 审计修订后 approved）实施完成，含演练门禁：
  - 演练 6 步全过（`docs/testing/2026/09-02-prisma-p3-schema-ownership-drill.md`）：sign 零 DDL 采纳、init 幂等、陈旧 schema 双重拒绝、fresh-install、演进迁移闭环（plan→migrate→verify）。用户确认后实施。
  - `initSchema()` 删除（DDL + 两段一次性迁移 + 播种）；启动改为 connectWithRetry → `verifySchemaTables` 哨兵（表 + knowledge_status/knowledge_error 列）→ `seedBuiltinPromptIfEmpty`（Prisma 幂等）。
  - 归档：`scripts/one-off-migrations/`（001/002 + README）；`migrate-sqlite-to-postgres.mjs` 保留注记。
  - 测试基座：vitest globalSetup 跑 `prisma db init`（幂等已实证）；8 处 initSchema 调用点处置（2 迁移用例删除、播种改 seed 函数）。
- P2d 遗留修正（P3 审计发现）：`updateTaskProgress` 由 raw SQL 补切换为 Prisma（回归 50/50 通过）。
- 验证：48/48、typecheck、build、dist 空库哨兵冒烟、prisma:seed 幂等全部通过；`pool.query` 仅剩 3 处（哨兵 + 2 claim 守卫）。
- 闭合：独立 subagent 闭合审计（高风险定级，见审计记录）。
- 遗留：RDS ≥15 人工核实（P4 前置）；P4 Docker 接线 `db init/sign/migrate`（ask-first）。
