# Plan Audit — P2c 域迁移子 plan（ai_summary_task）

- 计划：`docs/plans/2026-09-01-prisma-p2c-domain-migration-plan.md`
- 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
- 审计日期：2026-09-01
- 审计方式：独立 subagent（只读审计）。deleteAiSummaryTask 属数据删除路径，但其契约测试已于 P0 建立且 master plan §7 授权覆盖，cold-replay 闭合时以该测试为安全网。

## 结论

VERDICT: needs-changes → 修正后 approved。8 方法清单与 `database.service.ts` 实现逐条核对准确（claim 守卫 SQL、字段保留语义、过滤组合、对账两段、状态更新）；raw SQL 保留约束合规；合并迁移（raw SQL）与 Prisma 读写无交互问题；消费方调用模式与零改动声明核实一致。无 Blocker。

## 发现与吸收

1. **search 表达式缺 % 包裹（语义性，已修）**：`ilike` 需 `'%' + escapeLikePattern(search) + '%'`，否则退化为精确匹配。
2. **upsert 冲突分支部分更新语义（语义性，已修）**：Prisma 部分更新保留旧值，而现 SQL `EXCLUDED` 全量覆盖——update 载荷必须显式置 `title/sourceTaskId/status/summaryOutput/errorMessage ?? null`、`lastTriggeredAt/lastCompletedAt` 未提供时显式 null、不含 createdAt（测试已钉住这些语义）。
3. **deleteAiSummaryTask 返回检查（语义性，已修）**：notIn 排除时可能返回空数组而非 null——实现按"返回内容非空"判定 boolean；既有测试（pending 拒绝返回 false）兜底。
4. **updateSummaryKnowledgeStatus（语义性，已修）**：`knowledgeError: error ?? null` 显式 null（测试钉住"清空错误"）。
5. **事实修正（已修）**：测试数 11（非 9）；timestamptz 4 列（非 8）；方法计数口径统一（8 方法：7 切换 + 1 raw SQL）；§4 补 knowledge-publisher 为 updateSummaryKnowledgeStatus 消费方。
6. **建议项（采纳）**：P2c testing 记录补一条大 cid 的 BIGINT→number 断言（域测试现有 cid 均小）；闭合以删除契约测试为显式安全网说明。
7. **核对确认**：合并迁移 raw SQL 先于 Prisma 读执行、无并发争用；and 组合器经 `@prisma/orm-postgres/orm-client` 导出可用（实施期实证）。
