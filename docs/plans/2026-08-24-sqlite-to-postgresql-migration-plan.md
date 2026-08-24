# 2026-08-24-sqlite-to-postgresql-migration-plan SQLite → PostgreSQL 迁移

> Plan Status: completed
> Last Reviewed: 2026-08-24
> Source: `docs/requirements/2026-08-24-sqlite-to-postgresql-migration.md`
> Related: `docs/discussions/2026-08-21-summary-cloud-knowledge-base.md`
> Audit: required
> Testing: `docs/testing/2026/08-24-sqlite-to-postgresql-migration.md`

## Current Baseline

- 持久化唯一来源：`packages/server/src/database/database.service.ts`（1405 行，better-sqlite3 同步驱动），六张表 `task / analysis_sub_task / ai_summary_task / app_settings / ai_prompt / ai_prompt_creator`，36 个公开方法全部同步。
- 全部 SQL 与 better-sqlite3 专有语法（`?`/`@named` 占位符、`lastInsertRowid`、`INSERT OR IGNORE`、`ON CONFLICT ... excluded`、`ON CONFLICT ... WHERE`、部分唯一索引、`pragma`、`datetime('now')`）均封装在该文件内，仓库内无外溢 SQL（唯一例外：`Dockerfile.server` 的 smoke-test SQL）。
- 8 个文件注入 `DatabaseService`，其中多个宿主方法为同步（`DownloadScheduler.tryScheduleNext`、`AnalysisTriggerService.onModuleInit`/`onLowResFinished` 回调、`PromptService` 全部方法、`download.service.getTasksPaginated/getTaskById`、`download.controller.setAutoSummary/checkTasks`、`analysis.controller.updateLlmConfig` 等）。
- 并发语义依赖 SQLite 单进程同步原子性：`claimAiSummaryTask` 原子认领防双跑、调度 `created→downloading` 抢占。
- `db.close()` 无调用方，未接入 NestJS 生命周期。
- 无 `DATABASE_URL` 或任何 DB 连接配置；DB 路径由 `OUTPUT_DIR/tasks.db` 硬编码。
- 依赖：server `better-sqlite3 ^12.10.0` + `@types/better-sqlite3`；Dockerfile.server 含 better-sqlite3 原生编译（`pnpm rebuild better-sqlite3 esbuild` + 预编译产物 + smoke-test）；docker-compose 两服务（server / vision-proxy），无 DB 服务。
- 无自动化测试框架（bilibili-api-sdk 包除外）；验证靠 `pnpm typecheck` / `pnpm build` + 手动测试文档。
- 时间列以 TEXT ISO 字符串存储；标题搜索用 `LIKE ... ESCAPE '\'`（ASCII 大小写不敏感）。

## Goals

- 六张表全部迁移到 PostgreSQL，server 仅通过 `pg` 连接池访问，移除 better-sqlite3 运行路径。
- `DatabaseService` 36 个公开方法保持入参/记录形状，返回值异步化；消费方连锁改为 async。
- 保持 API 契约、状态机、并发原子语义、搜索与时间过滤行为、删除语义。
- 提供一次性迁移脚本，幂等导入 `tasks.db`，不删源库（回滚=切回 SQLite）。
- 本地开发（compose postgres）+ 云端（阿里云 RDS 连接串）双形态经 `DATABASE_URL` 驱动。

## Non-Goals

- 不改前端、不改 API 响应形状。
- 不引入知识发布管道 / COS / RAG / 问答 schema。
- 不做双驱动抽象。
- 不新增自动化测试框架（仓库无统一测试体系；并发路径用测试方向文档手动/脚本验证）。
- 不重构业务层逻辑，仅做驱动替换与必要连锁改动。

## Infrastructure And Config Prereqs

- 新增 env：`DATABASE_URL`（`postgres://user:pass@pgm-bp1zn6syt3qkqy1nfo.pg.rds.aliyuncs.com:5432/dbname`），server 与部署两处透传。
- 本地开发与验证**不另起本地 postgres 实例**，直接连接云端 RDS（用户确认）；5432 端口已实测可达，需保证本机 IP（`123.139.249.20`）在 RDS 白名单。
- 连接凭据（用户名/密码/库名/SSL 模式）由用户提供，写入本地 `.env`（不提交仓库）；`.env.example` 用占位符。
- 回滚策略：源 `tasks.db` 全程不被脚本修改/删除；应用回滚 = 代码回退 + `DATABASE_URL` 移除，SQLite 数据仍在。

## Execution Plan

### Phase 1 - 连接层 + DatabaseService 重写（依赖、DDL、异步化、并发语义）

Status: completed
Targets: `packages/server/package.json`, `packages/server/src/database/database.service.ts`, `packages/server/src/database/database.module.ts`, `packages/server/src/main.ts` / `app.module.ts`

- Item Types: `Decision` 为主（4/6 项 Decision）
- Prereqs: 无（先行 Phase）

- [x] `Add`：server 新增 `pg` + `@types/pg` 依赖；移除 `better-sqlite3` 运行依赖（迁移脚本阶段会以 devDependency 形式带回，见 Phase 3）。
- [x] `Decision`：连接管理用 `pg` 的 `Pool`（替代方案：postgres.js——API 更现代但生态证据少；Prisma/TypeORM——需全量改写 SQL 与映射，churn 过大）。理由：存量 SQL 手写，`Pool` 侵入最小、类型映射可控。残余风险：需自行处理类型解析与连接重试。
- [x] `Decision`：时间列用 `TIMESTAMPTZ`，配置 pg 类型解析器将时间戳返回为 ISO 字符串（替代方案：列仍存 TEXT——非云库惯用且失去时间语义；返回 Date 对象——所有消费方比较/格式化需改动）。理由：保持记录接口 `string` 形状零消费者改动。残余风险：解析器配置遗漏会导致 Date 混入。
- [x] `Decision`：`claimAiSummaryTask` 用 `INSERT ... ON CONFLICT (bvid,cid) DO UPDATE ... WHERE status NOT IN ('pending','analyzing')`，并以 `rowCount > 0` 映射 `claimed`（替代方案：显式事务 + `SELECT ... FOR UPDATE SKIP LOCKED`）。理由：单语句原子性最接近现状。残余风险：PostgreSQL 对 DO UPDATE WHERE 未命中的 rowCount 语义需实测；若不符，Phase 1 内回退到事务 + 行锁方案并记录。
- [x] `Decision`：调度抢占 `created→downloading` 改为 `UPDATE task SET ... WHERE id=@id AND status='created' RETURNING id` 守卫式单语句（替代方案：保留两步查询再更新——异步间隙可能双抢）。理由：消除异步化引入的竞态。
- [x] `Decision`：标题搜索 `LIKE ... ESCAPE '\'` 改为 `ILIKE ... ESCAPE '\'`（替代方案：保持 `LIKE`——PostgreSQL 对 ASCII 区分大小写，改变用户可见行为）。理由：保留现状大小写不敏感搜索语义。
- [x] `Fix`：重写 `initSchema` 为 PostgreSQL DDL（六表 + 索引 + 部分唯一索引 + 外键级联 + `ON CONFLICT`/`RETURNING` 转换 + `now()`），幂等建表；内置提示词播种逻辑保留。
- [x] `Add`：连接池创建 + 有界启动重试（如 10 次、指数退避）后硬失败退出；`DatabaseService` 实现 `OnApplicationShutdown` 关闭 Pool；连接成功日志沿用 `createLogMessage`。
- [x] `Add`：`DATABASE_URL` 读取与校验（缺失时明确报错退出），保留 `OUTPUT_DIR` 仅用于下载目录（不再用于 DB 文件）。

Exit Criteria:

- [x] 36 个公开方法全部转为 async，方法名与记录形状不变；`database.module.ts` 保持全局导出。
- [x] 六张表 + 约束在云端 PostgreSQL 可幂等建出；`claimAiSummaryTask` 并发语义经实测确认（rowCount 方案或已回退方案均有记录）。
- [x] `pnpm --filter @bilibili-downloader/server typecheck` 通过（消费方若先不改则阶段内以编译隔离方式保证——见 Phase 2 前提）。
- [x] 相关决策已在计划/需求中记录理由与残余风险。

### Phase 2 - 消费方异步化连锁改造

Status: completed
Targets: `packages/server/src/download/*`, `packages/server/src/analysis/*`, `packages/server/src/database/*`（调用点）

- Item Types: `Fix` 为主（改造为修复性连锁变更）
- Prereqs: Phase 1

- [x] `Fix`：`download-scheduler.ts` —— `tryScheduleNext()` 改 async，`onModuleInit` 及全部同步调用点补 `await`；抢占走守卫式更新。
- [x] `Fix`：`download.service.ts` —— `getTasksPaginated` / `getTaskById` 改 async，其余 async 方法内 DB 调用补 `await`。
- [x] `Fix`：`download.controller.ts` —— `setAutoSummary` / `checkTasks` 改 async。
- [x] `Fix`：`analysis-trigger.service.ts` —— `onModuleInit` / `getLlmConfig` / 分页 / 详情 / 删除 / 私有 `upsertAiSummaryTask` / `onLowResFinished` 回调改 async 并补 `await`。
- [x] `Fix`：`analysis.controller.ts` —— `resolveLlmSettings` / `updateLlmConfig` / `scheduleInitialLowResDownload` 改 async。
- [x] `Fix`：`analysis-task.controller.ts` —— 同步 handler（raw-response / retrigger / rebuild / 相关读取）改 async。
- [x] `Fix`：`analysis-video-resolver.ts` —— DB 调用点补 `await`。
- [x] `Fix`：`prompt.service.ts` + `prompt.controller.ts` —— 全部方法改 async。
- [x] `Fix`：清理遗留——`db.close()` 迁移到 shutdown 钩子；移除 `OUTPUT_DIR` 用于 DB 路径的残留引用；无 `better-sqlite3` 残留 import。

Exit Criteria:

- [x] 全仓无 `better-sqlite3` import（迁移脚本除外，见 Phase 3）。
- [x] `pnpm typecheck` 全仓通过。
- [x] 所有 API 端点经本地 PostgreSQL 手动冒烟可用（对应测试方向 TD-3/4/5 的证据采集入口就绪）。

### Phase 3 - 一次性迁移脚本

Status: completed
Targets: `packages/server/scripts/migrate-sqlite-to-postgres.*`（新文件）, `packages/server/package.json`（devDependency + script）, `docs/`（使用说明）

- Item Types: `Add` 为主（3/5 项 Add）
- Prereqs: Phase 1（脚本写 PostgreSQL 需建表完成）

- [x] `Add`：将 `better-sqlite3` 移入 server devDependencies（仅迁移脚本使用，不进生产镜像）。
- [x] `Add`：迁移脚本——读 `OUTPUT_DIR/tasks.db` 六张表，按依赖序（task → analysis_sub_task / ai_prompt / ai_prompt_creator → ai_summary_task / app_settings）逐表 upsert 到 `DATABASE_URL`，幂等可重跑；时间字段统一转 ISO；`ai_summary_task` 用 `ON CONFLICT (bvid,cid)`，`task`/`ai_prompt` 用资源键或 id 冲突策略并记录。
- [x] `Add`：迁移脚本执行前后打印各表行数对账；完成后不删除/修改源 SQLite。
- [x] `Add`：`pnpm --filter @bilibili-downloader/server migrate:sqlite-to-pg` script。
- [x] `Proof`：用真实 `tasks.db` 执行迁移并记录两库行数对账结果到 `docs/testing/2026/08-24-sqlite-to-postgresql-migration.md`（TD-6）。

Exit Criteria:

- [x] 脚本幂等（二次执行不产生重复行）；源 SQLite 校验未变。
- [x] 迁移后 server 连 PostgreSQL 可读到全部历史任务/总结/提示词/设置。
- [x] 迁移脚本在生产镜像构建中不可达（devDependency + 不 COPY scripts 或仅本地执行路径），`pnpm build` 不受影响。

### Phase 4 - 部署（Docker / 配置）

Status: completed
Targets: `packages/docker/docker-compose.yml`, `packages/docker/Dockerfile.server`, `packages/docker/compose.mjs`, `packages/docker/.env.example`

- Item Types: `Add` + `Fix`
- Prereqs: Phase 1（镜像不再需要 better-sqlite3）

- [x] `Add`：server 容器注入 `DATABASE_URL`（不新增 postgres 服务，直连云端 RDS；compose 增加 `depends_on` 之外的连接可用性说明）。
- [x] `Fix`：`Dockerfile.server` 移除 better-sqlite3 原生编译段与 SQLite smoke-test，替换为 pg 连通性等价检查。
- [x] `Add`：`compose.mjs` 与 `.env.example` 补充 `DATABASE_URL` 相关变量文档（占位符，不含真实凭据）。
- [x] `Proof`：`pnpm docker:build:server` 通过；compose 起服务后 server 连云端 RDS 可用（TD-8）。

Exit Criteria:

- [x] 本地 `docker compose up` 后 server 自动连接云端 RDS 并可用；`DATABASE_URL` 一处配置即可切换环境（文档注明）。
- [x] 镜像内无 better-sqlite3 依赖残留。

### Phase 5 - 验证与文档对齐

Status: completed
Targets: `docs/design/app-overview.md`, `docs/context/codebase-map.md`, `docs/context/source-of-truth-and-precedence.md`, `docs/context/project-context.md`, `docs/testing/2026/08-24-sqlite-to-postgresql-migration.md`, `docs/logs/`

- Item Types: `Proof` + `Fix`（文档对齐）
- Prereqs: Phase 2-4

- [x] `Proof`：运行 `pnpm typecheck`、`pnpm build`，结果记录。
- [x] `Proof`：按测试方向文档逐项验证 TD-1 至 TD-8 并回填状态与证据。
- [x] `Fix`：`docs/design/app-overview.md` 集成表 SQLite 行改为 PostgreSQL。
- [x] `Fix`：`docs/context/codebase-map.md` 更新 server 条目（DB 驱动、依赖）与"修改部署配置"验证行。
- [x] `Fix`：`docs/context/source-of-truth-and-precedence.md` 数据库真相条目改为 PostgreSQL schema 文件。
- [x] `Fix`：`docs/context/project-context.md` 更新技术基线（DB）、当前基线、验证命令（如涉及）、Active plan。
- [x] `Add`：`docs/logs/` 记录迁移实施日志（日期、范围、验证结果、未决事项）。

Exit Criteria:

- [x] 全部测试方向 `passed` 或显式 adjudicated out of scope。
- [x] 受影响的 owner doc / 上下文文档已对齐且互相一致。
- [x] `docs/logs/` 有实施日志。

## Plan Audit

- Status: passed
- Reviewer / Agent: 人工（用户 2026-08-24 明确"审核通过，开始执行"）
- Evidence: 用户人工审核通过；计划中数据库/model 形状、部署保护区域与密钥上云风险已由用户确认（见 `docs/requirements/2026-08-24-sqlite-to-postgresql-migration.md` 决策记录与 Edge Cases）。

## Closure Gates

- [x] in-scope behavior is complete（六表上 PostgreSQL、消费方异步化、迁移脚本、部署）
- [x] relevant docs are aligned（app-overview / codebase-map / source-of-truth / project-context / requirement / plan / testing / logs）
- [x] verification has run：`pnpm typecheck`、`pnpm build`、`pnpm docker:build:server`
- [x] corresponding `docs/testing/2026/08-24-sqlite-to-postgresql-migration.md` exists and every testing direction confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed（或已记录不能以 cold-replay 替代的原因）before implementation
- [x] micro-plan actual diff stayed within exception limits, or plan was reclassified and audited —— 不适用（full plan）
- [x] text consistency verified：status、phases、gates、testing document、log 一致
- [x] closure audit was independent（人工/子代理审核；不允许 cold-replay）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 并发认领回退方案（事务 + 行锁）

- Classification: `watch-only residual`
- Why Not Blocking Closure: 仅当 Phase 1 实测 `ON CONFLICT DO UPDATE WHERE` rowCount 语义不符时启用，作为已记录的备选路径，不改变范围。
- Successor Required: `no`（Phase 1 内自闭环）

### 自动化测试框架

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 仓库无统一测试体系，迁移验证依赖类型检查 + 构建 + 测试方向文档（项目既有传统）；引入框架属独立决策。
- Successor Required: `yes`（若后续并发/数据逻辑风险上升，另行立项）

### 阿里云 RDS 实例配置（TDE / 白名单 / 规格）

- Classification: `optimization candidate`
- Why Not Blocking Closure: 属于部署运维配置，本计划只保证 `DATABASE_URL` 可配置与文档说明；实例安全加固由用户控制台操作。
- Successor Required: `no`

## Closure

Status Note: 全部五个阶段实施与验证完成。六表已上 PostgreSQL（云端 RDS），消费方完成异步化，一次性迁移脚本幂等导入 1328 行，Docker 镜像去除 better-sqlite3 并直连云端 RDS 验证通过，owner doc 与上下文文档已对齐，测试方向 TD-1~8 全部 passed，`docs/logs/2026-08-24-sqlite-to-postgresql-migration.md` 已记录。因本计划属保护区域（数据库/部署）且 Reviewer availability 为 `none`，未使用 cold-replay 替代独立审计；最终关闭由用户（本会话审核人，已批准计划并全程参与执行）确认。

Closure Audit Evidence:

- Reviewer / Agent: 用户人工（本会话审核人，已批准计划启动并确认执行）；独立 subagent 不可用（`ai-autonomy-policy` Reviewer availability: none），cold-replay 不适用于保护区域。
- Evidence: `docs/testing/2026/08-24-sqlite-to-postgresql-migration.md`（TD-1~8 全部 passed，含云端 schema/端点/迁移/容器实测与失败路径日志）；验证命令 `pnpm typecheck`、`pnpm build`、`pnpm docker:build:server` 通过；容器连云端 RDS 后 `GET /api/tasks` 返回 200；`docs/logs/2026-08-24-sqlite-to-postgresql-migration.md`。

Follow-up:

- <无；非阻塞 follow-up 一律进 Deferred But Adjudicated>
