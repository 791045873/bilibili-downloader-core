# Plan：Prisma ORM 渐进式改造总 plan（Master Plan）

> 日期：2026-09-01
> 状态：`in progress`（分阶段执行；各阶段独立 plan 见 §5）
> 需求：`docs/requirements/2026-09-01-prisma-orm-introduction.md`
> 讨论与决策记录：`docs/discussions/2026-09-01-prisma-orm-introduction.md`
> Audit: 本 plan 经独立 subagent 审计并修订通过，见 `docs/audits/2026-09-01-plan-audit-prisma-introduction-master-plan.md`；各阶段子 plan 启动前需另行独立审计（本 plan 属高风险，不可用 cold-replay 替代）

## 1. Goal 与非目标

**Goal**：把 server 数据访问层从 `DatabaseService`（手写 SQL + 启动建表）渐进迁移到 Prisma 8，最终 schema 由 Prisma Migrate 管理、`pg` 直连移除，且对外行为零变更。

**非目标**：API 契约/JSON 形状变更、列名规范化、Phase 2 向量化、前端改动、数据库更换。详见需求 Out Of Scope。

## 2. 已确认决策（约束所有阶段）

1. 方案 B 渐进共存：Prisma 与 `pg` 同库并存，按域切换，最后切换 schema 所有权。
2. Prisma 8（`prisma@latest`）。
3. Prisma 先行；Phase 2 向量化在本总 plan 闭合后实施。
4. Schema 命名保持原样，仅 `@map` 映射。
5. 自动化测试验证；**test-first per domain**（未建行为测试的域不得切换）。

## 3. 全局风险与对策（细节见讨论 §4）

| 风险 | 对策 |
| --- | --- |
| 类型语义漂移（int8→BigInt、timestamptz→Date） | P1 建立集中映射/序列化层；每域测试断言 JSON 输出格式不变 |
| `claimAiSummaryTask` / `claimNextCreatedTask` 并发守卫 | 保留 raw SQL，不重写语义；测试含并发用例 |
| 一次性迁移 SQL 与播种的归宿 | P3 显式处理：迁移归档、播种改 seed，幂等性测试 |
| 存量库（NAS/云端）升级安全 | P3 baseline migration 前，在"旧 initSchema 建的库"副本上演练 |
| 无测试兜底 | P0 先建测试基座；每域 test-first |
| 启动对账路径漂移 | `reconcileStaleAnalysisState()`（每次启动改写 analysis_sub_task / ai_summary_task）纳入 P0 行为测试与 P2c/P2d 等价验证 |
| 进程内状态丢失 | `progressBuckets` 日志去重语义保留在门面层，由 P2d 闭合判据钉住（P0 无 DB 可观察效应、不做断言，偏差已记录于 P0 plan） |
| 连接与全局类型解析器相互影响 | P1 决策连接策略（复用现有 `pg` pool 的 driver adapter vs 独立连接池）并记录 `pgTypes.setTypeParser`（int8→Number 等）的影响范围；映射层精确复刻 `toIsoTimestamp` 归一化 |
| 一次性脚本依赖残留 | `scripts/migrate-sqlite-to-postgres.mjs` 依赖 `pg`/`better-sqlite3`：P3 决定归宿，P4 依赖移除一并处理 |
| 与在途回填需求冲突 | knowledge-backfill（一次性手动触发）不得与 Prisma 阶段并行修改 `database.service.ts`；两者串行 |
| 部署属 ask-first 保护区 | P4 plan 需用户批准后才实施；Dockerfile `--ignore-scripts` 意味着 postinstall 的 `prisma generate` 不会运行，P4 需显式 COPY 生成产物与 schema/`prisma.config.ts` |

## 4. 验证命令

| Purpose | Command |
| --- | --- |
| Install | `pnpm install` |
| Typecheck | `pnpm typecheck` |
| Build | `pnpm build` |
| Server 数据层测试 | 由 P0 plan 落定后回填（如 `pnpm --filter @bilibili-downloader/server test`）；**P0 闭合项包含回填 `docs/context/project-context.md` 验证命令表** |
| 手动冒烟 | `pnpm dev:server` + 前端走查下载/分析/总结/设置 |

## 5. 阶段分解与子 plan

各阶段独立成 plan 文档，**在上一阶段闭合后、本阶段启动前编写并审计**。子 plan 必须包含：范围、行为测试清单、等价性验证点、回滚方式、闭合证据。

| 阶段 | 内容 | 子 plan 文档 | 状态 |
| --- | --- | --- | --- |
| P0 测试基座 + schema 基线 | server 引入 vitest + 测试 PostgreSQL；对现有 `DatabaseService` 关键路径建行为测试（含删除路径契约与启动对账 `reconcileStaleAnalysisState`；按现状钉住既有怪癖，如 `deleteTask` 非事务两步删除且不清理 `summary`/`summary_segment`）；Prisma 工具经 `pnpm dlx prisma@8` 独立供给（依赖在 P1 才安装），introspect/contract infer 生成基线 schema 并与 `initSchema()` 逐表核对 | `docs/plans/2026-09-01-prisma-p0-test-harness-and-baseline-plan.md` | pending |
| P1 基础设施 | Prisma 8 依赖、`prisma.config.ts`、schema/contract、client 生成接入 build、NestJS `PrismaService` 注册（保留 `connectWithRetry` 语义或显式替代）；决策并记录连接策略与 pg 类型解析器影响；零行为变更 | `docs/plans/<date>-prisma-p1-infrastructure-plan.md` | pending |
| P2 按域迁移 | 每域一档：a) ai_prompt + ai_prompt_creator + app_settings；b) summary + summary_segment（`updateSummaryKnowledgeStatus` 写 ai_summary_task 的路径保持旧栈直至 P2c；携带 `upsertSummaryKnowledge` 显式事务等价验证）；c) ai_summary_task（含启动对账路径）；d) task + analysis_sub_task（最大，最后；含 progressBuckets 与调度抢占语义）。方法签名作门面，raw SQL 仅用于不可表达项 | 每子域独立 plan（P2a–P2d） | pending |
| P3 schema 所有权切换 | baseline migration、`initSchema()` DDL 退出、迁移 SQL 归档、播种改 seed、存量库演练；核对 partial unique index `idx_analysis_sub_task_active` 的 migrate 输出；决定 `migrate-sqlite-to-postgres.mjs` 归宿 | `docs/plans/<date>-prisma-p3-schema-ownership-plan.md` | pending |
| P4 收尾与部署（ask-first） | 移除 `pg`/`@types/pg`（及 sqlite 脚本依赖 `better-sqlite3`/`@types/better-sqlite3` 的处置）、Dockerfile/compose 适配（显式处理 `--ignore-scripts` 与 prisma 产物 COPY）、文档更新（codebase-map、架构、app-overview） | `docs/plans/<date>-prisma-p4-cleanup-deployment-plan.md` | pending |

## 6. 阶段闭合判据（每阶段）

1. 该阶段子 plan 的 checklist 全部完成，证据（diff、测试输出、验证命令结果）已记录。
2. 新增/变更行为测试通过，且既有测试不回归。
3. 对外 API JSON 与改造前一致（抽查断言）。
4. 独立闭合审计（subagent 或 cold-replay 视阶段风险定级）通过。
5. `docs/logs/` 追加一条日期日志；受影响 context 文档同步。

## 7. 人为批准点

- **数据删除路径（ask-first）**：`deleteTask`/`clearTasks`/`deleteAiSummaryTask` 属保护区。用户已于 2026-09-01 明确提出本改造并确认决策 1–6（含自动化测试验证策略，见讨论 §7），构成规划授权；实施仍受 test-first 约束——删除路径行为契约测试先于任何该路径的栈切换存在。
- P3 实施前：存量库演练结果需向用户展示。
- P4 实施前：deployment 属 ask-first 保护区，P4 plan 需用户批准。

## 8. Checklist

- [x] P0 子 plan 编写并审计（`docs/audits/2026-09-01-plan-audit-prisma-p0-test-harness-and-baseline-plan.md`）
- [x] P0 完成（2026-09-01，闭合证据见 `docs/testing/2026/09-01-prisma-p0-baseline-testing.md`；cold-replay 闭合）
- [x] P1 子 plan 编写并审计（`docs/audits/2026-09-01-plan-audit-prisma-p1-infrastructure-plan.md`）
- [x] P1 完成（2026-09-01，闭合证据见 `docs/testing/2026/09-01-prisma-p1-infrastructure-testing.md`；关键输入：int8→BigInt、timestamptz→Temporal.Instant、Temporal polyfill 必需）
- [x] P2a–P2d 子 plan 各自编写并审计（`docs/audits/2026-09-01-plan-audit-prisma-p2{a,b,c}-domain-migration-plan.md`、`docs/audits/2026-09-02-plan-audit-prisma-p2d-domain-migration-plan.md`）
- [x] P2a–P2d 完成（P2a/P2b/P2c/P2d 全部闭合：`docs/testing/2026/09-0{1,2}-prisma-p2{a,b,c,d}-domain-migration-testing.md`；数据访问全量走 Prisma，raw SQL 仅剩 2 个守卫型 claim）
- [x] P3 子 plan 编写并审计（`docs/audits/2026-09-02-plan-audit-prisma-p3-schema-ownership-plan.md`）+ 用户批准演练结果（2026-09-02）
- [x] P3 完成（`docs/testing/2026/09-02-prisma-p3-schema-ownership-testing.md`；subagent 闭合审计——高风险定级）
- [ ] P4 子 plan 编写并审计 + 用户批准（ask-first）
- [ ] P4 完成
- [ ] 总 plan 闭合审计
