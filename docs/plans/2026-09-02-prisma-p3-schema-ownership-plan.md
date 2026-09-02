# Plan：P3 — Schema 所有权切换（initSchema 退出 → Prisma 管理）

> 日期：2026-09-02
> 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
> 需求：`docs/requirements/2026-09-01-prisma-orm-introduction.md`
> 前置：P0、P1、P2a–P2d 已闭合
> Audit: 已通过独立 subagent 审计并修订，见 `docs/audits/2026-09-02-plan-audit-prisma-p3-schema-ownership-plan.md`

## 1. Goal

把 schema 所有权从 `DatabaseService.initSchema()`（启动时 CREATE IF NOT EXISTS + 一次性迁移 + 播种）切换为 Prisma 8 contract/migration 工作流：存量库以 **`db sign` 零 DDL 采纳**（P0 已实证 marker 机制），新库用 **`db init`**，未来演进用 **`migration plan` + `db migrate`**。启动流程改为"哨兵检查 + 幂等播种"，不再执行任何 DDL。

## 2. 已核实的 Prisma 8 migration 事实（本会话 CLI 探查）

- `db init`：建表至 contract 形态 + 签名（fresh 库一键；**对已签名库的幂等性待 §3.4 步骤 3 实证**，globalSetup 依赖此证明）。
- `db sign` / `db verify`：存量库零 DDL 采纳 + 校验（P0 在 initSchema 建的库上全流程实证，contract hash `85d08401…`）。
- `migration plan`（--name）/ `db migrate`（--show/--to）/ `migration list/status/log/check/graph`：契约变更后的演进路径。
- CLI 为 devDependency：**运行时容器内不可用** → 启动自检必须程序化（哨兵 SQL），不能调 CLI。

## 3. Scope

### 3.1 启动流程改造（`database.service.ts`）

- **删除 `initSchema()`**（全部 DDL + 两段一次性数据迁移 + 播种调用）。
- 新增 `verifySchemaOrThrow()`：哨兵查询 `information_schema.tables`（8 张预期表）**+ `information_schema.columns` 校验一次性迁移新增的两列**（`ai_summary_task.knowledge_status`/`knowledge_error`——防"旧版建表库表全在但列缺失"穿透哨兵）；缺失即 fail-loud，错误信息给出处置指引（fresh → `prisma db init`；存量 → `prisma db sign`；演进 → `db migrate`）。`onModuleInit` 顺序：connectWithRetry → verify → seed。`verifySchemaOrThrow` 供测试 helper 复用（public 或导出）。
- **播种抽出**：`seedBuiltinPromptIfEmpty()`（Prisma 实现：count=0 才 create，幂等），仍由 onModuleInit 自动调用（保证现有部署行为零变更），同时新增 `prisma:seed` script 手动可跑。
- `reconcileStaleAnalysisState`（analysis-trigger 启动调用）不属于 initSchema，不动。

### 3.2 一次性迁移归档

- initSchema 内两段幂等迁移 SQL（task.summary_status → ai_summary_task 合并、analysis_sub_task supersede + partial index 重建）归档为 `packages/server/scripts/one-off-migrations/`（.sql + README：作用、适用库、已随 0.0.x 在所有存量库执行过、勿重复执行）。
- `migrate-sqlite-to-postgres.mjs`：**保留不动**（历史工具；P4 依赖清理时再评估 pg/better-sqlite3 依赖归属），README 注明。

### 3.3 测试基座适配（vitest globalSetup）

- 新增 `tests/global-setup.ts`：设 `DATABASE_URL=TEST_DATABASE_URL` → `pnpm exec prisma db init`（每次测试运行执行一次，依赖演练实证的幂等性；建表+签名，测试库 schema 从此由 contract 管理）→ 失败 fail-loud。globalSetup 环境变量不传播到 worker 无影响（CLI 子进程继承 setup env；worker 经 createTestDb 取 URL）。
- `tests/helpers/db.ts` 纳入修改范围：`DbInternals` 移除 `initSchema` 声明；`initTestDb` 改为连接 + 复用 `verifySchemaOrThrow` 哨兵（不再调用 initSchema）。
- **直接 `initSchema()` 测试调用共 8 处**，逐一处置：
  - `ai-summary-task.test.ts:275,283`（合并迁移）→ **用例删除**（迁移归档）
  - `analysis-sub-task.test.ts:97,105`（supersede）→ **用例删除**（迁移归档）
  - `ai-prompt.test.ts:21,28`（播种幂等）→ 改测 `seedBuiltinPromptIfEmpty`
  - `ai-prompt.test.ts:33,58`（仅保证内置提示词存在）→ 改调 `seedBuiltinPromptIfEmpty`
- partial unique index 用例不依赖 initSchema（索引由 contract/`db init` 提供），保留。
- 隔离策略不变（TRUNCATE RESTART IDENTITY CASCADE；truncate 不动 marker 表）。

### 3.4 演练（drill，实施前执行，结果向用户展示——总 plan §7 批准点）

一次性容器 `bdl-drill`（postgres:17，端口 55433）：

1. **存量库模拟**：用 P2d 现有代码 `onModuleInit()`（initSchema 建表+迁移+播种）→ 模拟任意已部署实例。
2. **零 DDL 采纳**：`prisma db sign` → `db verify` → 断言 ok 且无 DDL 操作。
3. **幂等**：对已签名库再次 `db init`（exit 0、零 DDL——globalSetup 依赖该证明）+ 再次 `db sign`/`db verify` → 零操作。
4. **陈旧 schema 探针**：drill 库 `ALTER TABLE ai_summary_task DROP COLUMN knowledge_status` → `db sign`/`db verify` → 记录是拒绝还是静默采纳（决定哨兵列校验的必要性等级与 §5 风险表述）。
5. **fresh-install 路径**：全新空库 → `db init` → 新代码 `onModuleInit` → 哨兵通过 + 播种执行。
6. **演进路径 PoC**：临时改 contract（加一个哑索引）→ emit → `migration plan` → `db migrate` → `db verify` → 演示前向迁移闭环 → 还原 contract/emit（drill 库废弃不清理）。
7. 演练全程记录 → `docs/testing/` → **向用户展示并获确认后，才进行 §3.1–§3.3 代码实施**。

## 4. Out Of Scope

- Dockerfile/compose/启动命令接线（`db init/sign/migrate` 进容器流程 = P4，ask-first）。
- 云端 RDS 版本核实（≥15，部署前人工动作，P4 前置）。
- Phase 2 向量化的真实 schema 演进（其时走本 plan PoC 验证过的 migration 流程）。
- 数据访问方法（P2 已全量 Prisma）。

## 5. 风险

| 风险 | 对策 |
| --- | --- |
| 存量库升级路径断裂（新镜像无 initSchema，若 P4 未接线 migrate/sign） | 哨兵 fail-loud 给出明确指引；P4 必须接线；演练证明 sign 零 DDL 安全 |
| 陈旧列 schema 穿透哨兵（表全在、列缺失） | 哨兵增加迁移新增列校验；演练步骤 4 探明 `db sign` 对分歧 schema 的行为 |
| fresh install 漏播种 → 内置提示词缺失 | 播种保留在启动流程（幂等）+ seed script 双通道 |
| 哨兵误报/漏报（表在非 public schema、大小写） | 本项目固定 public + 小写；哨兵按精确名单比对 |
| `db init` 对已签名库的行为未知（应幂等） | 演练步骤 3 实证；vitest globalSetup 依赖此幂等性 |
| 两段一次性迁移归档后，某库未执行过（理论上无：随 0.0.x 发布已在全部存量库跑过） | 归档 README 说明适用判断方法；哨兵+人工流程兜底 |
| 测试删除两段迁移用例降低覆盖 | 归档代码+README 承载历史；迁移逻辑已不在产品路径 |

## 6. 验证与闭合判据

1. 演练（§3.4）全部通过且用户确认。
2. 全量测试（两段迁移用例移除、新增 seed/哨兵相关用例后）绿；typecheck、build 通过。
3. `git grep initSchema` 无残留；`pool.query` 仅剩两个 claim 守卫 + 哨兵/播种（若用 SQL——按 plan 走 Prisma 则无）。
4. dist 冒烟：无 schema 时启动 fail-loud 信息正确。
5. `docs/testing/` P3 记录、`docs/logs/` 日志、总 plan checklist、`project-context.md`、codebase-map（Server 行启动流程描述）、baseline README 追加 migration 工作流。
6. 闭合审计采用 **独立 subagent**（本阶段移除生产 DDL、改变启动失败行为，按总 plan §6.4 风险定级为高风险，不适用 cold-replay）+ 用户对演练的确认留痕。

## 7. Checklist

- [x] 演练（6 步）+ 结果展示 + 用户确认（`docs/testing/2026/09-02-prisma-p3-schema-ownership-drill.md`，2026-09-02 用户确认）
- [x] 启动流程改造（initSchema 删除、哨兵、seed 抽出）
- [x] 一次性迁移归档 + sqlite 脚本 README 注记
- [x] 测试基座适配（globalSetup + 用例调整：8 处 initSchema 调用点处置）
- [x] 全量回归（48/48）+ grep/diff 复核 + dist 冒烟（空库 fail-loud）
- [x] 文档同步 + 独立 subagent 闭合审计（高风险定级）

## 8. Closure 记录

- §6 判据 1–6 全部满足。
- 实施期实测补充：`db sign`/`db verify` 对分歧 schema 双重拒绝（演练步骤 4）；`db init` 对已签名库 0 操作幂等（步骤 3）；`db update` 可修复分歧（1 个 additive 操作）。
- P4 前置遗留：云端 RDS ≥15 人工核实；Docker/启动流程接线 `db init`/`db migrate`（ask-first，需用户批准 P4 plan）；`prisma:seed` 依赖先 build（seed.mjs 引 dist）。
- 名称偏差（闭合审计记录）：plan 写 `verifySchemaOrThrow()`，实现为导出函数 `verifySchemaTables()`（供测试 helper 复用），语义一致。
