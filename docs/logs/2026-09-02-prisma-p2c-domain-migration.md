# Log — 2026-09-02 Prisma P2c（ai_summary_task 切换 Prisma）

- 完成 P2c plan（经 subagent 审计修订后 approved）并实施：
  - 8 方法：7 切换（upsert/delete/list/get×2/reconcile 半段/updateSummaryKnowledgeStatus 移交）+ claimAiSummaryTask 保留 raw SQL 守卫。
  - upsert 冲突分支按审计要求显式全量覆盖（null 抹除语义与现 SQL EXCLUDED 一致）。
  - list 过滤用 `and(...)` 组合（orm-client 导出）；count 用 aggregate 对象选择器；条件删除用 notIn 表达式。
- 关键发现：
  - **null 语义必须保留**：pg 行的 nullable 字段为 null，映射层 `?? undefined` 会破坏 P0 钉住的行为（3 用例失败后修正）；`toIsoString` 改为 null→null。
  - `and`/`notIn`/`aggregate` 对象选择器为 P2d 可复用 API 事实。
- 验证：49/49（含新增大 cid 用例）、typecheck、build 通过；diff 仅 database.service.ts。
- 下一步：P2d（task + analysis_sub_task：progressBuckets 保留、调度抢占、reconcile sub-task 半段切换）。
