# Testing — P3 演练（存量库采纳 / fresh-install / 演进迁移闭环）

- 日期：2026-09-02
- Plan：`docs/plans/2026-09-02-prisma-p3-schema-ownership-plan.md` §3.4
- 环境：一次性 `postgres:17` 容器 `bdl-drill`（端口 55433，库 `bdl_drill`；fresh 路径用同容器新建库 `bdl_fresh`）
- 结果：**6 步全部通过**，contract hash 全程 `85d08401…`（基线）

## 步骤与结果

| # | 步骤 | 结果 |
| --- | --- | --- |
| 1 | **存量库模拟**：P2d 现有代码 `onModuleInit()`（initSchema 建表 + 两段迁移 + 播种）对空库执行 | OK（legacy-init OK）——等价于任意已部署实例的库状态 |
| 2 | **零 DDL 采纳**：`db sign` → marker created、零 DDL 操作；`db verify` → ok（"Database marker and schema match contract"） | ✅ |
| 3 | **幂等**：对已签名库 `db init` → exit 0，`operationsPlanned:0, operationsExecuted:0`（"Applied 0 operation(s)"）；再 `db sign` 零操作 | ✅（globalSetup 与重复部署依赖此证明） |
| 4 | **陈旧 schema 探针**：`DROP COLUMN ai_summary_task.knowledge_status` → `db verify` **拒绝**（exit 4，"missing: …/column:knowledge_status"）；`db sign` 同样**拒绝**（self-guarding，不静默采纳）；`db update` 修复（1 个 additive 操作）→ verify ok | ✅ |
| 5 | **fresh-install**：全新空库 `db init` → 20 个 additive 操作（8 表 + 3 unique + 6 index 含 partial index `idx_analysis_sub_task_active` + 2 FK）+ 签名；`db verify` ok | ✅ |
| 6 | **演进 PoC**：contract 加哑索引 `idx_p3_poc` → emit（hash `449bae15…`）→ `migration plan --name p3-poc`（planned 1 operation）→ `db migrate`（applied 1）→ `db verify` ok | ✅ 前向迁移闭环打通；演练后已还原 contract 与 hash |

## 结论

1. 存量库（任意已部署实例）用 `db sign` **零 DDL 采纳**，安全。
2. 新库用 `db init` 一键建表（含 initSchema 的全部对象，含 partial unique index）。
3. schema 分歧（含旧版缺列）会被 `sign`/`verify` **双重拒绝**，不会静默采纳。
4. 未来 schema 演进（Phase 2 向量化的 embedding 列等）走 `contract 修改 → emit → migration plan → db migrate`，已闭环验证。
5. 运行时哨兵（P3 §3.1）仍保留：CLI 不可用于容器运行时，哨兵做表+关键列存在性快检，工具链做权威校验。

## 待办（实施 §3.1–§3.3 的前置已满足）

- 用户确认本演练结果（总 plan §7 批准点）。
- 部署前人工核实云端 RDS PG ≥ 15（P4 前置）。
