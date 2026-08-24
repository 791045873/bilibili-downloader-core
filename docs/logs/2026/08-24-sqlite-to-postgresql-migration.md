# 2026-08-24 SQLite → PostgreSQL 迁移日志

> 关联计划：`docs/plans/2026-08-24-sqlite-to-postgresql-migration-plan.md`
> 需求：`docs/requirements/2026-08-24-sqlite-to-postgresql-migration.md`
> 测试文档：`docs/testing/2026/08-24-sqlite-to-postgresql-migration.md`

## 范围与决策

- 六张表（task / analysis_sub_task / ai_summary_task / app_settings / ai_prompt / ai_prompt_creator）全部从 SQLite 迁移到 PostgreSQL，本地与云端统一使用（单驱动）。
- 云端目标为阿里云云数据库（`pgm-bp1zn6syt3qkqy1nfo.pg.rds.aliyuncs.com:5432/ai_summary`），经 `DATABASE_URL` 连接；本需求在"数据库迁移"一点上取代 discussion 的方案 B。
- `app_settings.llm.apiKey` 随库上云（用户确认），`GET /api/analysis/config` 掩码行为保持。

## 实施

- `packages/server/src/database/database.service.ts`：better-sqlite3 同步驱动 → `pg` 连接池异步驱动；36 个公开方法转 async（入参/记录形状不变）；PostgreSQL DDL（六表 + 索引 + 部分唯一索引 + 外键）；时间列 `TIMESTAMPTZ` + 类型解析器转 ISO；`ON CONFLICT DO UPDATE WHERE` 原子认领、守卫式 `claimNextCreatedTask` 抢占、`ILIKE` 搜索；`OnModuleInit` 有界连接重试 + `OnApplicationShutdown` 关池。
- 消费方异步化连锁改造（9 个文件）：download.service / download-scheduler / download.controller / analysis-trigger.service / analysis.controller / analysis-task.controller / analysis-video-resolver / prompt.service / prompt.controller。
- 依赖：`better-sqlite3` 移入 devDependencies，新增 `pg` + `@types/pg`。
- 一次性迁移脚本 `packages/server/scripts/migrate-sqlite-to-postgres.mjs`（npm script `migrate:sqlite-to-pg`）：读 `OUTPUT_DIR/tasks.db` 六表按依赖序 upsert，幂等可重跑，源 SQLite 只读不删。
- 部署：`Dockerfile.server` 移除 better-sqlite3 原生编译与 smoke-test（仅保留 esbuild 重建）；`docker-compose.yml` server 注入必填 `DATABASE_URL`（不新增 postgres 服务）；`.env.example` 补充连接串说明。

## 验证

- 云端连接成功（PostgreSQL 17.6，库 ai_summary）；schema 六表 + 索引建出，内置提示词播种成功。
- 并发语义实测：`ON CONFLICT DO UPDATE WHERE` 阻断 rowCount=0 / 放行=1；守卫式抢占二次=0；部分唯一索引拒绝活跃重复。
- 迁移：首次 `task=1147 analysis_sub_task=89 ai_summary_task=89 app_settings=2 ai_prompt=1 ai_prompt_creator=0 共1328行 skipped=0`；二次幂等（无重复 id），序列推进到 max(id)，时间戳 ISO 正确，源 tasks.db 未改。
- HTTP 读路径（本地 + Docker 容器连云端 RDS）：`/api/tasks` total=1147、`/api/summary-tasks` total=89（executionTiming 解析、modelName 正确）、`/api/analysis/prompts` 内置提示词、`/api/analysis/config` apiKey 掩码 `****_ml0`、statusGroup 过滤正常。
- 启动失败语义实测：不可达 `DATABASE_URL` 有界重试后 `Failed to connect to PostgreSQL after 10 attempts` 并以退出码 1 终止。
- 验证命令：`pnpm typecheck`、`pnpm build`、`pnpm docker:build:server` 通过；镜像内 `pg` 存在、`better-sqlite3` 不存在。
- 测试方向 TD-1~8 全部 passed，证据见测试文档。

## 未决事项

- TD-7 成功路径与失败路径均已实测；阿里云 RDS 实例级安全加固（TDE / 白名单收紧 / 规格）属运维配置，由用户在控制台处理，见计划 Deferred。
- 本计划属保护区域，关闭由用户最终确认（无独立 subagent，未用 cold-replay）。
