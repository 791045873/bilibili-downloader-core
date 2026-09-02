# Plan Audit — P2d 域迁移子 plan（task / analysis_sub_task）

- 计划：`docs/plans/2026-09-02-prisma-p2d-domain-migration-plan.md`
- 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
- 审计日期：2026-09-02
- 审计方式：独立 subagent（只读审计）。deleteTask/clearTasks 删除契约测试自 P0 存在，master plan §7 授权覆盖，cold-replay 闭合以其为安全网。

## 结论

VERDICT: needs-changes → 修正后 approved。§3.1/§3.2 全部方法行与 `database.service.ts` 实现逐行核对准确（默认值链、动态 SET、completedAt 条件、shouldLog 分支、镜像仅两列、count 无 JOIN、tuple IN+去重、两步删除、死代码确认）；LEFT JOIN 改两段查询等价（UNIQUE(bvid,cid) 保证 Map 合并安全、NULL 对跳过）；or 导出核实；治理合规。

## 发现与吸收

1. **计数修正（Major）**：task.test.ts 13 用例（非 12）；§3.1 13 方法（非 12）；§6.2 合计 16 方法（非 14）。已统一。
2. **task 行映射缺失（Major）**：补 `mapTaskRow`（BIGINT→number 含 null 直通、timestamptz→ISO、镜像注入、写入侧 BigInt）。
3. **§3.2 映射不全（Major）**：补 cid BigInt→number、createdAt→ISO、insert 的 status ?? "created" 与可选字段 `?? null`。
4. **findTasksByBvidsAndCids 镜像遗漏（Moderate）**：返回契约含 JOIN summaryStatus 且无测试钉住——plan 补明确合并 + 补测试断言。
5. **空 pairs 提前返回（Moderate）**：写入 §3.1 方法行 + 补测试（or() 空行为未实证）。
6. **日志计数（Minor）**：8 处（task 6 + analysis_sub_task 2）。
7. **or 证据（Minor）**：标注"类型导出核实、P2d 首次运行时验证"。
8. **无测试钉住项显式化（Minor）**：§6.4 列出 4 项，以 diff 复核为证（progressBuckets 先例）。
