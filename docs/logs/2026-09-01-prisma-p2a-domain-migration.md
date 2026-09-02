# Log — 2026-09-01 Prisma P2a（ai_prompt / ai_prompt_creator / app_settings 切换 Prisma）

- 完成 P2a plan（经 subagent 审计修订后 approved）并实施：
  - 13 个方法在 `DatabaseService` 门面内切换为 Prisma 查询；签名、返回类型、日志行为零变更；消费方零改动。
  - 门面装配：`DatabaseService` 可选注入 `PrismaService`（生产 DI 共享单例 / 测试自建经 `createPrismaClient()` 工厂 + owns 关闭）；`prisma.service.ts` 抽出工厂。
  - 映射层落地：`bigintToNumber`、`toIsoString`（Instant→ISO 3 位毫秒，与 toIsoTimestamp 输出一致）；输入侧 BigInt / Temporal.Instant。
- Prisma 8 新查询 API 实测语义（P2b–P2d 复用，详见 `docs/testing/2026/09-01-prisma-p2a-domain-migration-testing.md`）：
  - Timestamptz 写入只收 Temporal.Instant；upsert 冲突键走 `conflictOn`；orderBy 为回调（多项=回调数组）；IN 过滤必须回调式 `m.key.in(...)`；updateAll 类型强制前置 where；缺失行 update/delete 返回 null 不抛错。
- 验证：46/46（含新增 no-op 用例）、typecheck、build 通过；diff 复核仅 3 个 database 层文件变更。
- 下一步：P2b（summary / summary_segment + 显式事务等价验证）。
