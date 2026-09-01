# 需求：引入 Prisma ORM 渐进式改造数据访问层

> 来源：`docs/discussions/2026-09-01-prisma-orm-introduction.md`（开放问题已于 2026-09-01 由用户全部决策）
> 前置影响：本需求完成后，`docs/requirements/2026-09-01-knowledge-vector-search.md`（Phase 2 向量化）在其之上实施

## Goal

把 server 的数据访问层从单一 `DatabaseService` 手写 SQL（`pg` 连接池 + `initSchema()` 启动建表）渐进式迁移到 Prisma 8，最终由 Prisma 管理 schema 与迁移，`pg` 直连完全移除。全程不改变任何 API 对外行为与数据库表/列命名。

## 已确认决策

1. 采用**方案 B 渐进共存**：Prisma 与现有 `pg` 同库并存，按域逐个切换，最后切换 schema 所有权。
2. 版本：**Prisma 8**（`prisma@latest`，TypeScript 运行时 + contract 数据模型；PostgreSQL 一等目标）。
3. 顺序：先 Prisma 改造，后 Phase 2 向量化。
4. Schema 命名保持原样：`task` 表 camelCase 列、其余表 snake_case 列不动，仅用 `@map` 映射。
5. 验证策略：**自动化测试**（test-first per domain，见下）。

## In Scope

- server 包接入 Prisma 8：`prisma.config.ts`、schema/contract（8 张表：task、analysis_sub_task、ai_summary_task、app_settings、ai_prompt、ai_prompt_creator、summary、summary_segment）、client 生成、NestJS 注册（`PrismaService`）。
- 逐域切换读/写路径：每个域的 `DatabaseService` 方法签名保持为门面（内部换 Prisma 实现），消费方零改动或最小改动；持久化日志点（`createLogMessage` 各处）原样保留。
- 测试基座：为 server 引入 vitest + 可控测试 PostgreSQL，先为每个待迁移域编写针对**现有实现**的行为测试（含数据删除路径 `deleteTask`/`clearTasks`/`deleteAiSummaryTask` 的预期行为契约），再切换到 Prisma 后复用同一套测试验证等价。
- Schema 所有权切换：以当前库结构做 baseline migration，`initSchema()` 的 DDL 退出；两段一次性数据迁移 SQL 归档（不再每次启动执行），内置提示词播种迁到 seed 脚本（幂等）。
- 无法用 Prisma 查询 API 等价表达的部分（条件守卫 upsert、单语句子查询抢占、tuple IN、ILIKE ESCAPE 等）使用 Prisma raw SQL（`db.raw.sql`）保留现有 SQL，不改变并发语义。
- Docker 构建与启动流程适配（`prisma generate`、migrate 执行方式）。

## Out Of Scope

- 任何 API 对外契约、JSON 字段形状、时间戳序列化格式的变更。
- 列名/表名规范化（camelCase→snake_case 等）。
- Phase 2 向量化（pgvector、embedding 列、检索 API）——本需求完成后再做。
- 前端改动。
- 数据库更换（仍为 PostgreSQL，`DATABASE_URL` 不变）。

## Acceptance Criteria

1. `pnpm typecheck`、`pnpm build` 通过；server 正常启动并完成既有全部功能（下载、分析、总结、知识发布、设置、提示词管理）。
2. 全部数据访问经 Prisma client（raw SQL 例外仅限 §In Scope 列出的不可表达项），`pg` 直连与 `@types/pg` 从 server 依赖移除。
3. schema 变更由 Prisma Migrate 管理；对一个"已按旧 `initSchema()` 建库"的存量库执行新启动流程，不产生破坏性 DDL、不丢数据、幂等。
4. 每个迁移域的行为测试在切换前后均通过（同一套测试）；数据删除路径的测试覆盖存在并随需求提交。
5. 对外 API 响应 JSON 与改造前逐字段一致（含时间戳字符串格式）。
6. 各阶段独立 plan 闭合审计通过（见 master plan）。

## 约束（Test-First Per Domain）

任何域（如 ai_prompt、task 等）在切换到 Prisma 之前，必须先存在针对该域当前行为的行为测试。此约束同时满足 `docs/context/project-context.md` 中"触达数据删除路径需 owner doc + 测试"的 AI Block Condition：本需求与其下的阶段 plan 即数据删除路径行为契约的 owner 文档。

## 阶段划分

见总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`。每阶段有独立 plan 文档，启动前需独立审计。

## Open Questions

- 测试 PostgreSQL 的供给方式（本地 Docker 容器 vs 复用开发库的独立 schema/database）——由 P0 阶段 plan 定。
- Docker/部署细节（migrate 在容器启动时执行 vs 独立命令）——属 ask-first 保护区，由用户批准 P4 plan 后实施。
