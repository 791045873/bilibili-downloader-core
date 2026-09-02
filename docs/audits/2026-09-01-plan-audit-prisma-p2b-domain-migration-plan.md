# Plan Audit — P2b 域迁移子 plan（summary / summary_segment）

- 计划：`docs/plans/2026-09-01-prisma-p2b-domain-migration-plan.md`
- 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
- 审计日期：2026-09-01
- 审计方式：独立 subagent（只读审计）。本域不含保护区删除路径，有既有行为测试兜底，closure 可用 cold-replay。

## 结论

VERDICT: needs-changes → 修正后 approved。§3.1 与现 SQL 逐条核对准确（createdAt 仅 INSERT 写、ON CONFLICT 仅更新 updated_at、可选字段 ?? null、日志点）；P2c 延后 `updateSummaryKnowledgeStatus` 的约束与消费方调用（pending/synced/failed）核实一致；task.test.ts 删除契约测试与本切换兼容（rawResponse "{}"、seq 0 平凡安全）。无 Blocker。

## 发现与吸收

1. **回滚用例欠具体（Major）**：改为确定性 DB 级注入——segments 内重复 `seq`（违反 `summary_segment_summary_id_seq_key`），保证失败发生在事务中段；断言首写场景 summary 无残留、重复发布场景旧数据存活。非法字段路径（客户端校验）不作为 DB 回滚证明。已并入 §5。
2. **可选字段处理未钉（Moderate）**：§3.1 显式声明 `?? null` 合并，不传 undefined。
3. **upsert 返回值未经验证（Moderate）**：P2a 未消费过 upsert 返回；§3.1 增验证点与回退（tx 内按 conflictOn 复查）。
4. **事务回滚归因（Minor）**：§2 标注为 P2b 探查/待用例实证，非 P2a 证据；deleteAll 0 行 no-op 说明并入 §5。
5. **核对确认项**：now() 写入位置与现 SQL 完全对应；既有 knowledge.test.ts 的 jsonb 相等断言（`toEqual({tips:[]})`）恰好钉住 JSON.parse 等价、可选 null 断言钉住 `?? null` 语义。
