# 需求：本地 SQLite 迁移到云数据库 PostgreSQL（全部六张表）

## Goal

将 server 包唯一的持久化存储从本地 SQLite（better-sqlite3）替换为云数据库 PostgreSQL。本地开发与云端部署统一使用 PostgreSQL（单驱动），移除 SQLite 运行路径；提供一次性数据迁移脚本将现有 `tasks.db` 导入 PostgreSQL。该需求对应 `docs/discussions/2026-08-21-summary-cloud-knowledge-base.md` 目标第 1 点。

## 决策变更记录

- 原 discussion 收敛于方案 B（本地 SQLite 不动，仅新增知识发布管道）；本需求按用户明确指示执行方案 A 范围——**六张表全部迁移到 PostgreSQL**，本需求在数据库迁移这一点上**取代方案 B**。
- 云端数据库假设由 discussion 中的"腾讯云托管服务"改为 **阿里云云数据库（RDS PostgreSQL）**（用户确认）。
- 用户确认的五项决策：
  1. 迁移范围：`task` / `analysis_sub_task` / `ai_summary_task` / `app_settings` / `ai_prompt` / `ai_prompt_creator` 六张表全部迁移。
  2. 本地开发也用 PostgreSQL（单驱动，不做双驱动抽象）。
  3. `app_settings.llm.apiKey` 随库上云（安全风险，见 Edge Cases）。
  4. 提供一次性迁移脚本导入现有 `tasks.db` 数据。
  5. 云端目标为阿里云云数据库；**本地开发与验证不另起本地 postgres 实例，直接经 `DATABASE_URL` 连接云端 RDS**（实例：`pgm-bp1zn6syt3qkqy1nfo.pg.rds.aliyuncs.com:5432`），docker-compose 不新增 postgres 服务。

## In Scope

- 依赖：server 包移除 `better-sqlite3` 运行依赖，新增 `pg`（连接池）；一次性迁移脚本保留 better-sqlite3（devDependency 或独立脚本）。
- `DatabaseService` 36 个公开方法全部异步化，对外方法签名（入参/返回记录形状）保持不变，仅返回值改为 Promise。
- PostgreSQL DDL：六张表 + 索引 + 外键 + 部分唯一索引，语义与现有 SQLite schema 等价。
- 消费方异步化连锁改造（约 8 个文件）：
  - `download.service.ts` / `download-scheduler.ts` / `download.controller.ts`
  - `analysis-trigger.service.ts` / `analysis.controller.ts` / `analysis-task.controller.ts` / `analysis-video-resolver.ts` / `prompt.service.ts` / `prompt.controller.ts`
- 一次性迁移脚本：读取 `OUTPUT_DIR/tasks.db`，全量导入 PostgreSQL，幂等可重跑，不删除源 SQLite（回滚=切回 SQLite）。
- 配置：新增 `DATABASE_URL` 环境变量；启动连接重试与失败语义；`OnApplicationShutdown` 关闭连接池。
- 部署：docker-compose 不新增 postgres 服务，server 经 `DATABASE_URL` 直连云端 RDS；`Dockerfile.server` 移除 better-sqlite3 原生编译与 smoke-test；`compose.mjs` 与 `.env.example` 补充 DB 变量。
- 文档对齐：`docs/design/app-overview.md`、`docs/context/codebase-map.md`、`docs/context/source-of-truth-and-precedence.md`、`docs/context/project-context.md`、本需求、plan、testing、logs。

## Out Of Scope

- 前端任何改动（API 契约与响应形状不变）。
- discussion 中的知识发布管道 / COS / 向量化 / RAG 问答（Phase 1-4）。
- 知识问答场景的云端 schema（summary / summary_segment / conversation / message）——属于后续需求，不在本需求引入。
- 双驱动抽象（本地 SQLite + 云端 PostgreSQL 并存）——用户已确认单驱动。
- 新增自动化测试框架/单元测试体系（仓库当前无统一测试；并发关键路径通过测试方向文档做手动/脚本验证）。
- better-sqlite3 原生编译产物清理之外的 Dockerfile 结构优化。

## 技术影响面分析

### 同步 → 异步连锁

`DatabaseService` 全部为同步 API（better-sqlite3 同步驱动）。`pg` 为异步，36 个公开方法转为 Promise 后，约 8 个调用文件中的**同步宿主方法**必须连带改 async：

- `DownloadScheduler.tryScheduleNext()`（同步私有方法，被多个同步上下文调用）——最大连锁点。
- `AnalysisTriggerService.onModuleInit()`、`getLlmConfig`、分页/详情/删除、私有 `upsertAiSummaryTask`、`onLowResFinished` 回调。
- `PromptService` 全部方法。
- `analysis.controller` / `analysis-task.controller` / `download.controller` 的同步 handler。

### SQL 方言转换

| SQLite 专有 | PostgreSQL 对应 |
| --- | --- |
| `?` 位置占位符 / `@named` | `$n` 参数绑定 |
| `lastInsertRowid` | `INSERT ... RETURNING id` |
| `AUTOINCREMENT` | `BIGSERIAL` / `GENERATED ALWAYS AS IDENTITY` |
| `INSERT OR IGNORE` | `ON CONFLICT DO NOTHING` |
| `ON CONFLICT(...) DO UPDATE ... excluded` | 同语义，PostgreSQL 原生支持 `excluded` |
| `ON CONFLICT ... WHERE`（claim 扩展） | `ON CONFLICT ... DO UPDATE ... WHERE`（语义与 rowCount 需验证） |
| 部分唯一索引 `WHERE status != 'failed'` | 部分唯一索引，PostgreSQL 原生支持 |
| `pragma('journal_mode = WAL')` | 移除 |
| `datetime('now')` | `now()` |
| 时间列 TEXT ISO 字符串 | `TIMESTAMPTZ` + pg 类型解析器返回 ISO 字符串（保持代码侧 string 形状） |
| `LIKE ? ESCAPE '\'`（ASCII 大小写不敏感） | `ILIKE`（保留大小写不敏感搜索语义） |

### 并发语义（必须保持）

- `claimAiSummaryTask`：SQLite 依赖"单进程 + 同步事务"原子防并发双跑；PostgreSQL 用 `INSERT ... ON CONFLICT (bvid,cid) DO UPDATE ... WHERE status NOT IN ('pending','analyzing')`，需验证返回 rowCount 语义（`changes > 0` 等价）。
- 调度抢占 `created → downloading`：现为 `findNextCreatedTask` + `updateTaskStatus` 两步；改为 `UPDATE ... WHERE id=? AND status='created' RETURNING id` 守卫式单语句，避免异步间隙双抢。
- 部分唯一索引 `analysis_sub_task(bvid,cid,quality) WHERE status != 'failed'`：PostgreSQL 等价实现。

### 连接失败语义（新增能力）

SQLite 不会连接失败；PostgreSQL 可能（库未起、网络、凭证错误）。启动时需有界重试（若干次 + 退避）后硬失败退出；运行期 DB 错误走 NestJS 错误处理（500）并记录日志。这是现有代码没有的路径。

### 密钥上云风险

`app_settings.llm.apiKey` 进入云端数据库（用户确认）。缓解：`GET /api/analysis/config` 现有掩码行为不变；云端实例启用传输加密（TLS）、网络访问控制（白名单）；密钥不以明文出现在日志（现有安全日志 allowlist 覆盖）。

## Business Rules

- API 契约不变：所有端点响应形状、分页结构、删除语义、状态机（`pending`/`analyzing`/`failed`/`completed`）、409/400/404 语义保持现状。
- 状态单一来源保持：AI 总结状态只写 `ai_summary_task`，`task.summary_status` 镜像由 JOIN 读取覆盖。
- 并发认领与调度抢占的原子性必须与现状等价。
- 启动时 DB 不可达：有界重试后失败退出，不允许以降级模式启动。

## Roles / Permissions

- 单用户工具，无角色/权限系统，不受影响。
- `app_settings` 无迁移额外权限语义；仅 `llm.apiKey` 涉及安全（见 Edge Cases）。

## Edge Cases

- `llm.apiKey` 上云：云端数据库被攻破即泄露密钥；已由用户确认接受，缓解措施见分析章节，不回滚该决策。
- 启动时数据库未就绪/网络抖动：重试策略；迁移后首启依赖 DB 可用；云端 RDS 需保证当前机器 IP 在白名单（已确认 5432 端口可达）。
- 迁移脚本执行中途失败：幂等 upsert + 源 SQLite 不删 → 可重跑；迁移不破坏运行路径。
- 历史数据字段缺失（`summary_output` 为绝对路径等）：按现有记录形状原样搬运，不做语义清洗。
- 搜索大小写：SQLite `LIKE` 对 ASCII 大小写不敏感，PostgreSQL `LIKE` 敏感 → 用 `ILIKE` 保持用户可见行为。
- 时间比较：`updatedFrom`/`updatedTo` 过滤闭区间语义保持。
- Docker smoke-test 曾依赖 better-sqlite3，移除后替换为等价 pg 连通性检查。

## Open Questions（非阻塞）

1. RDS 连接凭据与库名、SSL 模式要求——部署阶段由用户提供并写入本地 `.env`（不入库）；本需求只保证 `DATABASE_URL` 可配置。
2. `ON CONFLICT DO UPDATE WHERE` 的 rowCount 语义若与预期不符，回退方案：认领改走显式事务 + 行锁（`SELECT ... FOR UPDATE SKIP LOCKED`）——Phase 1 实现时验证并记录。

## Acceptance Criteria

- [ ] server 启动后不再创建/读写任何 SQLite 文件；仅连接 PostgreSQL（`DATABASE_URL`）。
- [ ] 六张表全部建于 PostgreSQL，唯一约束、部分唯一索引、外键语义与现状等价。
- [ ] 现有 API 全部端点行为不变（下载、AI 总结、提示词、设置、删除语义）。
- [ ] 并发语义验证通过：总结认领不双跑、调度抢占唯一（见测试方向文档）。
- [ ] 一次性迁移脚本可将 `tasks.db` 全量数据导入 PostgreSQL，幂等可重跑，源 SQLite 不被删除。
- [ ] `llm.apiKey` 随库迁移上云，`GET /api/analysis/config` 掩码行为不变。
- [ ] 标题搜索大小写不敏感行为保持。
- [ ] server 经 `DATABASE_URL` 直连云端 RDS；compose 不新增 postgres 服务；`Dockerfile.server` 移除 better-sqlite3 原生编译；`pnpm docker:build:server` 通过。
- [ ] `pnpm typecheck` 与 `pnpm build` 通过。
