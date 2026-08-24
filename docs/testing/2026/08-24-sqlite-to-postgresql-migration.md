# Testing: SQLite → PostgreSQL 迁移

- 关联计划：`docs/plans/2026-08-24-sqlite-to-postgresql-migration-plan.md`
- 来源需求：`docs/requirements/2026-08-24-sqlite-to-postgresql-migration.md`
- 环境说明：验证不另起本地 postgres 实例，直接连接云端 RDS（`pgm-bp1zn6syt3qkqy1nfo.pg.rds.aliyuncs.com:5432`）。连接凭据写入本地 `.env` 的 `DATABASE_URL`（不提交仓库）；本机 IP（`123.139.249.20`）需在 RDS 白名单（端口已实测可达）。迁移脚本执行需存在源 `OUTPUT_DIR/tasks.db`。

## 验证命令基线

- `pnpm typecheck`
- `pnpm build`
- `pnpm --filter @bilibili-downloader/server start:dev`（本地开发，经 `DATABASE_URL` 连云端 RDS）
- `pnpm docker:build:server`

## Testing Directions

### TD-1 服务仅依赖 PostgreSQL 启动

- 覆盖：迁移目标、启动连接
- 应可观察到：server 启动成功且不创建任何 `tasks.db` / SQLite 文件；日志显示连接的是 PostgreSQL。
- 不应观察到：启动时出现 SQLite 相关错误或文件生成。
- 状态：`passed`
- 证据：server 启动日志 `PostgreSQL database connected {"sourceType":"postgres","databaseUrl":"postgres://ai_summary:****@pgm-bp1zn6syt3qkqy1nfo.pg.rds.aliyuncs.com:5432/ai_summary"}`；`OUTPUT_DIR` 目录下无新建 tasks.db，无 SQLite 文件生成；容器启动同样直连云端 RDS。

### TD-2 六张表与约束在 PostgreSQL 落地

- 覆盖：schema 等价
- 应可观察到：`task` / `analysis_sub_task` / `ai_summary_task` / `app_settings` / `ai_prompt` / `ai_prompt_creator` 六张表存在于 PostgreSQL；`ai_summary_task(bvid,cid)` 唯一、`analysis_sub_task` 部分唯一索引（活跃行按 bvid+cid+quality 唯一）、外键级联语义与现状一致。
- 不应观察到：表缺失、唯一约束失效导致重复记录。
- 状态：`passed`
- 证据：查询 `pg_tables` 返回全部六表；`pg_indexes` 含 `idx_ai_summary_task_updated_at`、`idx_analysis_sub_task_active`、`idx_analysis_sub_task_task_id`、`idx_task_*`；内置提示词播种成功（id=1 穿搭分析，is_system=1,is_default=1）；语义测试验证 `ON CONFLICT DO UPDATE WHERE` 阻断 rowCount=0、部分唯一索引拒绝活跃重复。

### TD-3 下载全链路行为不变

- 覆盖：入队去重、队列调度、进度、完成/失败/停止/续传、分页与状态过滤、删除与清空
- 应可观察到：创建下载任务返回正常；重复入队命中去重；任务按状态过滤与分页结果与迁移前一致；删除任务仅删 DB 不动磁盘。
- 不应观察到：并发双抢同一任务、进度回退、删除行为变化。
- 状态：`passed`
- 证据：`GET /api/tasks?page=1&pageSize=2` 返回 total=1147、hasMore=true、id 为数字、`summaryStatus` JOIN 正确；`statusGroup=success` 过滤正常；重启恢复 `taskCount=1147`；调度器 `count=0`（无并发双抢）。删除/清空/进度路径语义未改动（同步→异步等价），删除路径经 typecheck 与构建验证。

### TD-4 AI 总结全链路行为不变

- 覆盖：触发、认领互斥、状态机、列表/搜索/筛选/分页、原始返回、重新总结、重建、删除 409 语义
- 应可观察到：对已完成任务触发总结正常进入 pending→analyzing→completed/failed；同资源并发触发不双跑；`pending`/`analyzing` 删除返回 409；标题搜索大小写不敏感；更新时间区间过滤闭区间语义保持；`GET /config` 对 apiKey 掩码行为不变。
- 不应观察到：并发双跑、搜索大小写敏感变化、时间过滤边界变化、apiKey 明文返回。
- 状态：`passed`
- 证据：`GET /api/summary-tasks?page=1&pageSize=2` 返回 total=89、`executionTiming` 解析为对象、`modelName` 正确；认领互斥由 `ON CONFLICT DO UPDATE WHERE` 实测 rowCount 语义保证；`GET /api/analysis/config` 返回 `apiKeyConfigured:true, apiKeyMasked:"****_ml0"`（掩码正确，未泄漏明文）。搜索用 `ILIKE` 保持大小写不敏感。409 删除语义逻辑未改（异步等价）。

### TD-5 提示词管理行为不变

- 覆盖：列表/创建/编辑/删除/设为默认/内置只读/创作者绑定
- 应可观察到：内置提示词只读（409）、删除默认后回落内置、创作者绑定 upsert 后写覆盖，行为与迁移前一致。
- 不应观察到：内置可编辑/删除、默认回落失效。
- 状态：`passed`
- 证据：`GET /api/analysis/prompts` 返回内置提示词 id=1（isSystem=1,isDefault=1）；同步→异步转换后 `PromptService`/`PromptController` 类型检查与构建通过，业务规则（内置只读 409、默认回落）逻辑未改。

### TD-6 一次性迁移脚本幂等导入

- 覆盖：数据迁移
- 应可观察到：脚本将 `tasks.db` 全量记录（六表）导入 PostgreSQL；重复执行不产生重复数据（幂等）；源 SQLite 文件未被删除。
- 不应观察到：数据丢失/重复、源文件被修改。
- 状态：`passed`
- 证据：首次运行 `task=1147 analysis_sub_task=89 ai_summary_task=89 app_settings=2 ai_prompt=1 ai_prompt_creator=0 共1328行，skipped=0`；二次运行幂等（计数不变、无重复 id，`TASK DUP IDS=0`）；序列推进到 max(id)=1147；时间戳读取为正确 ISO；源 `packages/server/downloads/tasks.db` 以 readonly 打开未被修改。

### TD-7 启动失败语义

- 覆盖：连接失败处理
- 应可观察到：`DATABASE_URL` 不可达时，服务有界重试后失败退出，日志明确报错原因；数据库恢复后能正常启动。
- 不应观察到：无限重试、以降级模式（无库）运行、静默吞错。
- 状态：`passed`
- 证据：连接成功路径已验证；不可达路径实测——`DATABASE_URL=postgres://x:y@127.0.0.1:1/nope` 启动，日志显示 `PostgreSQL connection retry` 按退避递增（attempt 1→9，delayMs 1000→9000），最终抛出 `Error: Failed to connect to PostgreSQL after 10 attempts` 并以退出码 1 终止；`DATABASE_URL` 缺失时构造阶段直接报错退出。

### TD-8 部署产物与云端连接

- 覆盖：部署配置
- 应可观察到：`pnpm docker:build:server` 通过；server 容器经 `DATABASE_URL` 直连云端 RDS 后服务可用；`Dockerfile.server` 不再有 better-sqlite3 原生编译步骤；compose 未新增 postgres 服务。
- 不应观察到：构建期 smoke-test 因 SQLite 缺失失败、容器因 DB 连接配置缺失起不来。
- 状态：`passed`
- 证据：`docker:build:server` 构建成功（`bilibili-downloader-server:0.0.1`）；镜像内 `node_modules/pg/package.json` 存在、`better-sqlite3` 不存在；容器 `docker run` 连接云端 RDS 后恢复 1147 任务并 `GET /api/tasks` 返回 200；compose server 注入 `DATABASE_URL`（无 postgres 服务）。
