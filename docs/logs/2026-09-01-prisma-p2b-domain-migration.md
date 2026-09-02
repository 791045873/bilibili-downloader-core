# Log — 2026-09-01 Prisma P2b（summary / summary_segment 切换 Prisma）

- 完成 P2b plan（经 subagent 审计修订后 approved）并实施：
  - `upsertSummaryKnowledge` 由显式 BEGIN/COMMIT/ROLLBACK 切换为 `db.transaction`：Summary upsert（conflictOn bvid+cid）→ 旧 segments deleteAll → 逐条重插；可选字段 `?? null`；rawResponse JSON.parse 写 JSONB；日志点原样。
  - 事务等价以确定性 DB 级注入验证：重复 seq 触发 `summary_segment_summary_id_seq_key` 冲突 → 首写无残留、重复发布旧数据存活（2 个新用例）。
  - `updateSummaryKnowledgeStatus` 保持旧栈（ai_summary_task 属 P2c）。
- 验证：48/48、typecheck、build 通过；diff 仅 database.service.ts。
- Prisma 8 事务 API 实证：`db.transaction(async (tx) => ...)` 回调抛错即回滚；`tx.orm` 与主连接同构；upsert 返回行可直接使用。
- 下一步：P2c（ai_summary_task：claim 守卫 raw SQL 保留 + upsert 字段保留语义 + 启动对账 + updateSummaryKnowledgeStatus 随域切换）。
