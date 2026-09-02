# Plan Audit — P2a 域迁移子 plan（ai_prompt / ai_prompt_creator / app_settings）

- 计划：`docs/plans/2026-09-01-prisma-p2a-domain-migration-plan.md`
- 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
- 审计日期：2026-09-01
- 审计方式：独立 subagent（只读审计）。P2a 属非保护区数据路径切换且有既有行为测试兜底，closure 可用 cold-replay。

## 结论

VERDICT: needs-changes → 修正后 approved。13 方法清单与 `database.service.ts` 实际实现逐一比对准确（排序、动态 SET、日志点、setSettings 循环、无 ORDER BY LIMIT 1）；§3.1 门面装配方案连贯；§3.2 映射层对本三域无列类型遗漏（BIGINT 的 mid/promptId/id、INTEGER 的 is_system/is_default、TIMESTAMPTZ）；test-first 约束满足；scope 与总 plan P2a 行一致；cold-replay 闭合合规（保护区删除路径 deleteTask/clearTasks/deleteAiSummaryTask 不在本域）。无 Blocker。

## 发现与吸收

1. **不存在 id 的 no-op 语义**：现实现 UPDATE/DELETE 影响 0 行静默 no-op；Prisma `.update()`/`.delete()` 对缺失行可能抛错。已写入 §5 风险（实测并保留 no-op、必要时 catch）+ §7 补测试项。
2. **测试覆盖表述过强**：日志内容、updatedAt 刷新、missing-id 路径未被既有测试钉住。已在 §2 显式声明，missing-id 本轮补测试，其余靠 diff 复核。
3. **prisma.service.ts 属修改文件**（抽 `createPrismaClient()` 工厂、PrismaService 构造复用）：已列入 §3.1 与 §7。
4. **getSettings 空 keys 提前返回**：已写入 §3.3（不发查询）。
5. **app_settings.value 可空性**：§3.2 注明 Prisma 类型 `string | null` 但写入端不产 null，返回契约不变。
6. **治理**：plan 头部更新为审计记录引用。
