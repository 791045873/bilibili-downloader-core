# Log — 2026-09-01 Prisma P0（测试基座与 schema 基线）

- 完成 P0 plan（经 subagent 审计修订后 approved）并实施：
  - server 接入 vitest ^2.1.8，新增 `tests/`（7 文件 40 用例）钉住 `DatabaseService` 现状行为（含删除路径契约、并发认领恰一次、一次性迁移幂等、类型语义）。
  - 测试暴露并钉住 5 项行为怪癖（见 `docs/testing/2026/09-01-prisma-p0-baseline-testing.md`）。
  - Prisma 8 基线：`pnpm dlx prisma@latest`（8.0.0-rc.12）对 initSchema 建的库 contract infer → emit → sign → verify 全通过；产物在 `packages/server/prisma/baseline/`，逐表核对 7 项注记（注意 `updated_at DESC` 方向丢失项）。
  - 验证：40/40 通过；`pnpm typecheck`、`pnpm build` 通过；产品源码 `src/` 零改动。
  - `project-context.md` 验证命令表已回填 server 数据层测试命令与测试库要求。
- 遗留/移交：
  - progressBuckets 保留义务移交 P2d（P0 plan 已声明对总 plan §3 的偏差，总 plan 已同步）。
  - P1 需决策连接策略（driver adapter 复用现有 pool vs 独立连接）并处理 `pgTypes.setTypeParser` 与 `toIsoTimestamp` 的映射层复刻。
  - P1 接手基线 contract 时需补回 `idx_ai_summary_task_updated_at` 的 DESC。
