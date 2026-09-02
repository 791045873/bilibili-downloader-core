# Plan Audit — P3 Schema 所有权切换子 plan

- 计划：`docs/plans/2026-09-02-prisma-p3-schema-ownership-plan.md`
- 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
- 审计日期：2026-09-02
- 审计方式：独立 subagent（只读审计）。闭合定级：本阶段移除生产 DDL、改变启动失败行为，属高风险 → 闭合采用独立 subagent 审计（不适用 cold-replay）。

## 结论

VERDICT: needs-changes → 修正后 approved。核心架构（哨兵 + 迁移归档 + 演练门禁）与 live code 逐行核对成立；CLI 运行时不可用→程序化哨兵的判断正确；reconcileStaleAnalysisState 正确排除；播种 SQL 与 Prisma 1:1 映射可行；治理合规（P3 行全项、演练批准点、P4 ask-first 边界）。无 Blocker。

## 发现与吸收

1. **initSchema 测试调用点漏计（Major）**：共 8 处（非计划所列 4 处）；ai-prompt.test.ts:33/58 仅为例行保证内置提示词存在——改为调用 seedBuiltinPromptIfEmpty。已并入 §3.3。
2. **helpers/db.ts 纳入范围（Major）**：DbInternals 的 initSchema 声明需移除；initTestDb 复用 verifySchemaOrThrow。已并入 §3.3。
3. **§6.3 事实错误（Major）+ P2d 遗留暴露**：updateTaskProgress 在 P2d 中计划切换但实现遗漏（仍为 raw SQL）——**本次审计发现后已即时修复为 Prisma 并回归通过**；§6.3 判据相应修正为"两个 claim 守卫（哨兵/播种走 Prisma）"。master plan §8 "raw SQL 仅剩 2 个守卫型 claim" 表述与本修复后现状一致。
4. **哨兵仅查表可被陈旧列 schema 穿透（Major）**：增加 information_schema.columns 校验迁移新增两列；演练步骤 4 探明 db sign 对分歧 schema 的行为。
5. **演练缺口（Moderate）**：补 3 项——陈旧 schema 探针、fresh-install 路径（空库 → db init → onModuleInit）、显式断言"对已签名库 db init 幂等"（globalSetup 依赖）。
6. **§2/§5 自相矛盾（Minor）**：init-on-signed 幂等性改为"待演练实证"。
7. **globalSetup 说明（Minor）**：env 不传播 worker 无影响；幂等性依赖演练证明。
8. **闭合定级（Minor→采纳）**：高风险 → subagent 闭合审计，不适用 cold-replay。
