# Plan Audit — P0 测试基座与 schema 基线子 plan

- 计划：`docs/plans/2026-09-01-prisma-p0-test-harness-and-baseline-plan.md`
- 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
- 审计日期：2026-09-01
- 审计方式：独立 subagent（只读审计）。P0 属非保护区、无产品行为变更，closure 可用 cold-replay（`ai-autonomy-policy.md` 允许）；删除路径测试授权依据总 plan §7（用户 2026-09-01 决策）。

## 结论

VERDICT: needs-changes → 修正后 approved。测试矩阵逐项与 `database.service.ts` 实际行为核对一致；测试基座方案与 SDK 先例兼容（ESM、vitest ^2.1、tsconfig include 不冲突）；TRUNCATE 隔离方案可行（CASCADE 覆盖 FK、partial index 不受影响、RESTART IDENTITY 确定性 id）；cold-replay 闭合合规。无 Blocker。

## 发现与吸收

1. **命令错误（Major，已核实）**：npm dist-tags 当前 `latest`=8.0.0-rc.12、无 stable 8.x，`pnpm dlx prisma@8` 因 semver 不匹配 prerelease 而失败。已改为 `prisma@latest` + README 记录确切版本，并补 Prisma 8 实际 CLI 流程（contract infer → emit → sign → verify）。
2. **进度桶偏差未声明（Major）**：总 plan §3 要求 P0 钉住 progressBuckets，但 progressBuckets 为进程内存态、无 DB 可观察效应。已在 P0 plan 显式声明偏差并将保留义务移交 P2d；总 plan §3 措辞同步更新。
3. **并发用例缺失（Major）**：总 plan §3 要求 claim 并发测试。矩阵已补：并行 claimNextCreatedTask 恰一次成功；pending 期间并行 claimAiSummaryTask 恰一次 claimed:true。
4. **播种/迁移可测性未指明（Major）**：播种与一次性迁移仅在 initSchema 运行、TRUNCATE 后不自动重跑。已指明 test-only 重调 `initSchema()`；并补测 summary_status 合并迁移与 supersede 迁移。
5. **矩阵精度（Minor，均已补）**：deleteAiSummaryTask 的 boolean 返回契约；re-claim 覆盖 title/sourceTaskId/promptId + lastTriggeredAt、保留 lastCompletedAt；upsert 保留 createdAt；int8 范围补全 cid 与 mid；insertTask 默认值与 updatedAt 忽略传入值。
6. **Skip 语义歧义（Minor）**：明确 fail-loud 不允许静默跳过；注明 DB 不可达时 connectWithRetry 约 55s 退避。
7. **Nit（已注明）**：tests/ 不在 tsconfig include，类型错误仅 vitest 运行时暴露，与 SDK 先例一致。

## 核查要点

- 矩阵行为与源码逐条比对：claim 守卫、字段保留语义、条件删除、对账、partial index 条件、播种条件、事务、类型解析器——均准确。
- 治理：审计门、ask-first 授权引用、闭合判据与总 plan §6 一致。
