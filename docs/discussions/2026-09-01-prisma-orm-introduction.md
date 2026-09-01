# Discussion：引入 Prisma ORM 改造数据访问层

> 状态：`resolved`（开放问题已全部由用户决策，结论见 §7；后续推进见 requirements / master plan）
> 日期：2026-09-01
> 触发：用户提出希望引入 Prisma 8 替换现有手写 SQL 数据访问层
> 关联：`docs/plans/2026-08-24-sqlite-to-postgresql-migration-plan.md`（该计划中曾以 churn 过大为理由否决 Prisma，见"与既有决策的关系"）

## 1. 现状盘点（基于 live repo，2026-09-01 验证）

数据访问层是单一 `DatabaseService`（`packages/server/src/database/database.service.ts`，约 1590 行）：

- 底层：`pg` 连接池（`DATABASE_URL`，max 10），NestJS `OnModuleInit` 时启动。
- Schema 管理：`initSchema()` 启动时执行 `CREATE TABLE IF NOT EXISTS` + 幂等 `ALTER TABLE ADD COLUMN` + 两段一次性数据迁移 SQL（summary 状态合并、analysis_sub_task 活跃唯一索引回填）+ 内置提示词播种。
- 表（8 张）：`task`、`analysis_sub_task`、`ai_summary_task`、`app_settings`、`ai_prompt`、`ai_prompt_creator`、`summary`、`summary_segment`。
- 查询方式：手写参数化 SQL，动态拼 SET/WHERE 子句，分页为 COUNT + LIMIT/OFFSET 两连查。
- 消费方（10 个文件直接注入 `DatabaseService`）：download（service/controller/scheduler）、analysis（controller/task-controller/trigger/video-resolver/prompt.service）、knowledge-publisher.service。
- 已有定制类型解析：int8→Number、timestamptz/date→ISO 字符串（`pgTypes.setTypeParser`）。
- 部署：server 容器连外部云端 PostgreSQL（阿里云 RDS），无 DB 容器；本地开发同样用 PG。仓库内另有一次性的 sqlite→pg 迁移脚本。
- 自动化测试：无（`project-context.md` 明确 none）。

## 2. Prisma 版本事实（2026-09-01 web 核实）

- Prisma 8 已于 2026-08-28 成为 `prisma@latest`（此前为 RC，代号 Prisma Next）；Prisma 7 继续以 `prisma@prev` 完全支持。
- Prisma 8 关键特征：TypeScript 运行时（无 Rust 引擎）、contract-based 数据模型（可从既有库 introspect 出 contract）、新查询 API、graph-based migrations、`prisma.config.ts`、分页改名 `.limit()/.offset()`、raw SQL 走 `db.raw.sql`。
- PostgreSQL 是 Prisma 8 一等目标（SQLite/MySQL 支持在后）；支持 driver adapter（可复用调用方传入的 `pg` 实例）；支持 expression/partial/unique index 与原生 PG enum 的建模。
- 官方支持 Prisma 7 与 8 对同一库并存、按模块渐进迁移。

## 3. 方案选项

### 方案 A：全量重写（一次把 DatabaseService 全部改为 Prisma）

- 优点：无长期双栈；结束即干净。
- 缺点：约 40 个方法、10 个消费文件、8 张表一次切换；无自动化测试兜底；`claimAiSummaryTask` 等并发语义（`ON CONFLICT ... WHERE` 守卫）需要逐一等价验证；与在途需求（回填、Phase 2 向量化）互相踩脚。
- 判断：churn 过大，正是 2026-08-24 决策否决它的理由，不推荐。

### 方案 B：渐进共存（推荐）

Prisma 与现有 `pg` 并存同一 `DATABASE_URL`，按表/模块逐个切换，最后才切换 schema 所有权：

1. **Phase 0 基线**：用 Prisma introspect/`contract infer` 从现有库生成基线 contract；同时用 `initSchema()` 现状核对（两处 schema 必须一致，否则先修齐）。产出 `docs/requirements/` 需求稿 + plan。
2. **Phase 1 基础设施**：server 包接入 Prisma 8（`prisma.config.ts`、contract/schema、client 生成接入 build 脚本、NestJS `PrismaService` 模块化注册）。此阶段不改变任何行为。
3. **Phase 2 按域迁移读路径**（每步可独立验证、独立关闭）：
   - 建议顺序：`ai_prompt` / `ai_prompt_creator`（最小、只读为主）→ `app_settings` → `summary` / `summary_segment` → `ai_summary_task` → `task` / `analysis_sub_task`（最复杂：JOIN 镜像 summary 状态、动态 SET、调度抢占）。
   - 每域迁移时保留 `DatabaseService` 的方法签名作门面（内部换成 Prisma），消费方零改动或最小改动；日志行为（`createLogMessage` 各持久化日志点）必须原样保留。
4. **Phase 3 schema 所有权切换**：`initSchema()` 的 DDL 改由 Prisma Migrate 管理（对存量库做 baseline migration）；两段一次性数据迁移与播种逻辑移出建表流程（迁移归档、播种用 seed 脚本）。这是唯一真正改"数据库/model shape 管理"的阶段。
5. **Phase 4 收尾**：移除直连 `pg` 用法与 `@types/pg`、更新 `codebase-map.md` / 架构文档、Docker 构建加入 `prisma generate`（与 migrate 执行方式）。

- 优点：风险切片化；与在途需求可穿插；每步有独立验证点。
- 缺点：过渡期双栈（`pg` + Prisma client）共存数周；需要纪律防止"顺手全改"。

### 方案 C：不引入，维持 `pg` 手写 SQL

- 保留 2026-08-24 的决策。若引入动机只是"想要类型安全"，替代成本更低的方案是给现有 `DatabaseService` 补手写类型映射与查询封装（但长期仍要人肉维护 SQL）。
- 仅当用户确认 Prisma 收益（模型即文档、迁移工具链、类型安全查询）不值过渡成本时选择此项。

## 4. 关键技术风险（plan 必须逐项覆盖）

1. **类型语义漂移（最高风险）**：现有代码通过 `pg` type parser 把 int8 读成 `Number`、timestamptz 读成 ISO 字符串；Prisma 会给出 `BigInt`/`Date` 对象。所有消费方对时间戳的字符串假设（比较、序列化到前端 API）需要逐一审计；`TaskRecord` 等接口的对外 JSON 形状不能变。
2. **命名混用**：`task` 表列是带引号 camelCase（`"fileNameTemplate"`、`"createdAt"`），其余表是 snake_case。contract 需要 `@map` 映射，`task` 的列名策略要决策（保持现状 vs 迁移列名——推荐保持现状，避免 DDL 风暴）。
3. **无法 1:1 表达的 SQL**：
   - `claimAiSummaryTask`：`INSERT ... ON CONFLICT (bvid,cid) DO UPDATE ... WHERE status NOT IN ('pending','analyzing')` 的条件守卫是并发互斥核心（防双跑）。Prisma upsert 无此守卫，需保留 raw SQL（`db.raw.sql`）或改造为事务 + 读条件 + 写（需证明等价）。
   - `claimNextCreatedTask` 的单语句子查询抢占，同理需保原子性。
   - `findTasksByBvidsAndCids` 的 tuple `IN`、`ILIKE ESCAPE` 搜索、`LEFT JOIN ai_summary_task` 镜像读取，部分需要 raw SQL 或查询重组。
   - partial unique index `idx_analysis_sub_task_active ... WHERE status != 'failed'`：Prisma 8 支持建模，但需验证 migrate 输出与现有索引一致。
4. **seed 与一次性迁移的归宿**：内置提示词播种、历史状态合并这两段幂等逻辑，在 Phase 3 后必须仍有等价物，且对"已执行过的老库"不再重复执行。
5. **无测试兜底**：项目无单元/E2E 测试，而改动触达数据删除路径（`deleteTask`、`clearTasks`、`deleteAiSummaryTask`）。按 `project-context.md` AI Block Conditions，触达数据删除路径且无测试覆盖、无 owner doc 时 AI 必须停下等待人类输入。因此该改造至少需要：owner doc + 手工验证清单（`docs/testing/`）或补最小仓储层测试。
6. **部署面（受保护区）**：Dockerfile/compose/启动流程要加入 prisma generate 与 migrate 执行；`ai-autonomy-policy.md` 中 deployment 为 ask-first，需人类批准该部分。
7. **事务语义**：`upsertSummaryKnowledge` 的显式 BEGIN/COMMIT 多步事务需映射为 Prisma `interactive transaction`，行为等价验证。

## 5. 与在途需求的顺序冲突（必须先决策）

当前活跃需求是 `knowledge-backfill`（一次性手动触发）与 `knowledge-vector-search` Phase 2（待出 plan）。Phase 2 会改 `summary_segment`（加 `embedding vector(1024)`、`embedding_model`）并在启动建表流程中加 `CREATE EXTENSION vector`，检索用 pgvector 原生 SQL。

两个顺序可选：

- **先 Prisma 后 Phase 2**：Phase 2 的 schema 变更直接在 Prisma contract 上做；pgvector 相似度检索继续走 raw SQL。代价：Phase 2 被 Prisma 改造推后。
- **先 Phase 2 后 Prisma**：Prisma 基线 introspect 会把 embedding 列一并纳入（反而更省一次基线）；代价：Phase 2 实施期间仍用 `initSchema()` 旧流程，且 Prisma 接入时要处理 vector 列类型（Prisma 对 vector 支持有限，大概率落 `Unsupported` 类型 + raw SQL，可接受）。
- 回填需求是一次性脚本性质，与两方案均不冲突，但不应与 Prisma 切换并行改同一文件。

## 6. 开放问题（需用户确认）

1. **版本**：确认用 Prisma 8（`latest`，新查询 API + contract 流）还是保守用 Prisma 7（`prev`，GA 生态更久）。鉴于本项目是全新接入且 PG 为一等目标，初步倾向 Prisma 8，但 Prisma 8 的迁移工作流（graph-based/contract）较新，需要 plan 阶段做一次 PoC 验证。
2. **方案选择**：A / B / C（本文档推荐 B）。
3. **顺序**：Prisma 改造与 Phase 2 向量化谁先（见 §5）。
4. **schema 命名**：`task` 表 camelCase 列是否保持原样（推荐保持）。
5. **验证策略**：是否接受"手工验证清单（docs/testing/）+ 关键仓储方法最小测试"作为证据；还是要求先补自动化测试再动手。
6. **是否推翻 2026-08-24 计划中的否决决策**：当时理由是"全量改写 churn 过大"；方案 B 的渐进路径不与其事实依据冲突，但需用户确认推翻该倾向。

## 7. 决策记录

2026-09-01 用户确认：

1. **方案 B**（渐进共存）：确认。
2. **版本**：确认使用 Prisma 8（`latest`）。
3. **顺序**：先完成 Prisma 改造，再做 Phase 2 向量化（pgvector 后续在 Prisma schema 上建模，检索走 raw SQL）。
4. **Schema 命名**：保持原样（`task` 表 camelCase 列不动，其余表 snake_case 不动，仅用 `@map` 映射）。
5. **验证策略**：使用自动化测试验证（当前 server 包无测试设施，需先建立测试基座；见 requirement 的"测试先行"约束）。
6. **推翻 2026-08-24 否决倾向**：确认推翻——当时否决依据是"全量改写 churn 过大"，方案 B 的渐进路径不与之冲突。

## 8. 后续文档

- 需求稿：`docs/requirements/2026-09-01-prisma-orm-introduction.md`
- 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`（各阶段独立 plan 文档由总 plan 派生、逐阶段在启动前编写并审计）
