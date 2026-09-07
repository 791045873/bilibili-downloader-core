# Plan: summary_output 相对路径化

- Date: 2026-09-04
- Requirement: `docs/requirements/2026-09-04-summary-output-relative-path.md`
- Status: closed（2026-09-04 v2 修订已实施：存量修正改为一次性 SQL 手动执行，见第 8 节）
- Autonomy: plan-first
- Audit: passed-with-notes（2026-09-04 独立 subagent 审计，M1-M4/m1-m5 已修订入文；修订不触及结构决策，无需二次审计）

## 1. 现状触点（已核实）

写侧（存 `result.summaryPath` 绝对路径）：

| 位置 | 说明 |
| --- | --- |
| `analysis-trigger.service.ts` runAnalysis 成功 upsert（~:480） | 新总结 |
| `analysis-trigger.service.ts` runRebuild 成功 upsert（~:834） | 重建总结 |
| `analysis-trigger.service.ts` claim 阶段 upsert `summaryOutput: ""` | 空串=清空语义，非路径 |

全部 5 个写入点（`:148-154` 低清失败 / `:370-375` analyzing / `:473-482` completed / `:521-528` failed / `:827-834` rebuild）均经 `AnalysisTriggerService.upsertAiSummaryTask`（`:904-935`）→ `DatabaseService.upsertAiSummaryTask`（`database.service.ts:1040-1123`，写点 `:1077`/`:1092`）。

读侧（消费路径）：

| 位置 | 用途 |
| --- | --- |
| `analysis-task.controller.ts:157` | `readFile` markdown 查看端点 |
| `analysis-task.controller.ts:168` | `rewriteMarkdownImageUrls(body, mdAbsPath)` 需绝对路径算相对 base |
| `analysis-task.controller.ts:347` | publish 传 `summaryPath` 给 KnowledgePublisher |
| `knowledge-backfill.service.ts:114` | 回填传 `summaryPath` 给 KnowledgePublisher |
| `knowledge-publisher.service.ts:123,133,186` | readFile / `resolve(dirname, url)` 读截图 / writeFile 回写 |

已核实**不涉及**的旁路：显示透传（`database.service.ts:455-464` 镜像注入、`analysis-trigger.service.ts:700-739` 列表视图、前端类型 `types/index.ts:168,198`——相对值仅展示，无路径逻辑消费）；`server-log.util.ts:29` SAFE_LOG_KEYS 白名单；`notification.service.ts:89` 收的是内存 `result.summaryPath` 非 DB 值；`/summary-files` 静态挂载基于 `SUMMARY_BASE_DIR` 与 DB 值无关；`packages/server/scripts/one-off-migrations/`（`migrate-sqlite-to-postgres.mjs:66,72`、`001-summary-status-merge.sql:8,12`）为历史一次性脚本，原样搬运不改动。

存储：`ai_summary_task.summary_output`（Prisma text 列）；`task.summary_output` 为死镜像列（读取侧 JOIN 覆盖，不外显，不迁移）。

## 2. 方案

### 2.1 两个纯助手（放 `summary-dir.ts`，该文件已拥有 summary 路径语义）

```ts
// 写侧：绝对 → 相对（仅当位于 downloadRoot 之下；POSIX 分隔符；否则返回 null=不改写）
toRelativeSummaryOutputPath(value: string, downloadRoot: string): string | null

// 读侧：相对值按 join(downloadRoot, value) 解析为绝对路径；绝对值原样透传（旧数据容错）
resolveSummaryOutputPath(value: string, downloadRoot: string): string
```

细节：

- `toRelative`：先 `resolve(value)`，与 `resolve(downloadRoot)` 判定归属——**大小写策略**：归属判定用小写比较（依赖 Node `path.win32.relative` 内建行为亦可），`relative()` 必须用**原始大小写**字符串计算，产出的相对段不得丢原 case（云端 Linux 大小写敏感）；结果为 `""`（value==root）或以 `..`/`..\` 开头或为绝对 → 返回 null；在根下则 `replaceAll("\\", "/")` 返回。
- `resolve`：值已是绝对（`isAbsolute` 或盘符前缀）→ 原样；否则 `join(downloadRoot, value)`。

### 2.2 写侧收敛（单一咽喉点，按审计 M4 采用方案 a）

转换下沉到 `DatabaseService.upsertAiSummaryTask`（`database.service.ts:1040-1123`）：字段透传处对 `summaryOutput` 非空值调用 `toRelativeSummaryOutputPath(value, DOWNLOAD_ROOT)`，null 结果保留原值。该方法是全量单一写入口（覆盖 runAnalysis/runRebuild/失败/analyzing 各分支与未来新调用方）；claim 阶段空串不受影响（`?? null` 不拦空串）。`DatabaseService` → `summary-dir.ts` → `paths.ts` 单向导入，无环。

### 2.3 读侧三处 resolve

- `analysis-task.controller.ts` markdown 端点：`const mdAbsPath = resolveSummaryOutputPath(record.summaryOutput, DOWNLOAD_ROOT)`，readFile 与 rewriteMarkdownImageUrls 均用 `mdAbsPath`。
- `analysis-task.controller.ts` publish：`summaryPath: resolveSummaryOutputPath(...)`（KnowledgePublisher 契约不变，仍收绝对路径）。
- `knowledge-backfill.service.ts:114`：同上 resolve。

### 2.4 启动幂等迁移

`database.service.ts`：

- 新方法 `migrateAbsoluteSummaryOutputToRelative(): Promise<{ scanned, migrated, kept }>`：SELECT 非空 `summary_output`，对每个绝对值调用 `toRelative`，null→kept（记 debug 日志），成功→单行 UPDATE。**并发安全（审计 M2）**：同一云端 RDS 可能被本地与云端环境同时访问，UPDATE 必须带 CAS：`UPDATE ai_summary_task SET summary_output = $new WHERE id = $id AND summary_output = $old`（读时值比对，防止覆盖并发期间新写入）。**不触碰 `updated_at`（审计 M3）**：迁移只改 summary_output，避免首次启动把被迁移记录按 `updatedAt desc`（列表排序，`database.service.ts:877`）顶到最前。raw SQL 载体用 `this.pool.query`（与 `claimAiSummaryTask` 等守卫型写法一致，审计 m2）。
- 调用点：`onModuleInit` 中 `seedBuiltinPromptIfEmpty()` 之后、listen 之前（DatabaseService 先于 AnalysisTriggerService 初始化，读侧见到的已是迁移后数据）。
- 幂等：相对值非绝对，天然跳过。
- 汇总日志一条（scanned/migrated/kept），不逐行刷屏。

## 3. 不做 / 豁免

- Prisma contract 无 schema 变化（text 列语义变化），不触发 `db migrate`。
- `task.summary_output` 死镜像列不改写。
- `knowledge-publisher.service.ts` 内部不动（仍收绝对 `summaryPath`）。
- 前端 `summaryOutput` 字段类型不变（string，值变为相对路径，仅展示性）。

## 4. 测试策略

扩展 `packages/server/tests/database/ai-summary-task.test.ts`（既有 DB 行为测试，top-level await + truncateAll 结构可安全新增 describe；`fileParallelism: false`）：

1. 迁移：插入绝对路径行（DOWNLOAD_ROOT 下 / DOWNLOAD_ROOT 外遗留值 / 相对值 / 空串 / null）→ run migrate → 断言仅 DOWNLOAD_ROOT 下者转相对、其余不动、`updated_at` 未变；重复 run 幂等。
2. 助手纯函数用例（同一文件内，不依赖 DB 连接）：盘符大小写保留原 case、反斜杠、`""`/`..`/越界返回 null、绝对透传。
3. upsert 咽喉点（转换已下沉到 `DatabaseService.upsertAiSummaryTask`，审计 M4）：以绝对路径 upsert 后 DB 值为相对；空串清空语义不变。

## 5. 验证

- `pnpm typecheck`、`pnpm build`
- `pnpm --filter @bilibili-downloader/server test`（需测试库：docker 起 `pgvector/pgvector:pg17` @55432）
- 运行级（真实总结生成 + markdown 查看 + 发布）留用户部署后确认

## 6. 行为差异声明

- 历史遗留绝对值（旧 `summaryDir`）不变且仍可读（读侧容错）——与 2026-09-03 决策一致。
- 绝对/相对混存有界：新写入恒在 `SUMMARY_BASE_DIR = join(DOWNLOAD_ROOT, "summary")` 之下，`toRelative` 的 null 保留分支对新写入是死代码；混存仅限 requirement 明示容忍的 legacy 绝对值（审计 m5）。
- markdown 查看失败日志改输出 resolve 后路径更利于排障（仅日志，已落地）。

## 7. 执行与闭合（冷回放记录）

- 2026-09-04 冷回放：实际 diff 与第 2 节方案逐条对照——`summary-dir.ts` 新增 `toRelativeSummaryOutputPath`/`resolveSummaryOutputPath`（大小写策略、`""`/`..`/越界守卫按 M1/m1）；转换下沉 `DatabaseService.upsertAiSummaryTask`（M4 方案 a，`analysis-trigger.service.ts` 未改动）；迁移方法带 `WHERE id AND summary_output = 旧值` CAS + pool.query + 不触碰 updated_at（M2/M3/m2）；读侧三处 resolve（markdown/publish/backfill）与 §1 触点表一致；无超范围改动。
- 验证：`pnpm typecheck`、`pnpm build` 通过；server 数据层测试 61/61 通过（测试库 pgvector:pg17 @55432，启动迁移日志 `scanned:0` 空表正常）；AC1-AC5 逻辑与测试级满足。
- 文档：owner doc `app-overview.md` markdown 端点行已更新；实现日志 `docs/logs/2026-09-04-summary-output-relative-path.md`。
- 遗留：运行级验证（真实总结生成→查看→发布→跨环境重启迁移）留用户部署后确认。

## 8. v2 修订（2026-09-04，用户决策：存量修正不用启动迁移）

### 8.1 决策

存量 `summary_output` 修正改为**一次性 SQL 脚本手动执行**（`packages/server/scripts/one-off-migrations/003-summary-output-relative.sql`），从 `database.service.ts` onModuleInit 移除启动迁移方法。写侧相对化（upsert 咽喉点）与读侧 resolve 助手**保持不变**。

理由：用户明确要求存量修正走 SQL；启动自动改数据对多环境共用库而言"谁先启动谁改写"的语义不直观，手动 SQL 时点可控。

### 8.2 SQL 设计

- 根目录作为脚本内字面量参数（执行者按环境改：本地 `E:/...`，Docker `/download`），每次执行只转换"该根目录之下"的值，与多环境共用库的语义一致。
- 归属判定用 `ILIKE root || '/%'`（Windows 盘符大小写不敏感）；反斜杠先归一化为正斜杠再截取。
- 保留 v1 关键语义：CAS（`AND t.summary_output = 旧值`）防并发覆盖；不触碰 `updated_at`；根外遗留值与已相对值不动；value==root 或剩余段为空不改写。
- 执行前置条件：停止全部 server 实例。

### 8.3 v2 审计与验证记录

- v2 快速 subagent 审计 passed-with-notes：M1（空剩余段显式守卫，防 `root/` 值被写成空串）、M2（弃 ILIKE 改 `left(lower(...))` 等值比较，绕开通配符/转义依赖）、m1（root 尾斜杠归一化 `rtrim`）、m2（单条 set-based UPDATE，前置停机替代 tautology CAS）、m3（psql 输出 UPDATE 计数供核对）、m4（README 003 登记并区分幂等语义）均已落入脚本。
- 测试库（bdl-test-pg）代表性数据实证：反斜杠 Windows 路径与正斜杠路径正确转相对；Docker 根路径、相对值、空串、遗留 `summaryDir` 值、value==root、value==root+'/' 均不动；`updated_at` 不变；重复执行 UPDATE 0（幂等）；换 `/download` 根执行仅转换 Docker 行且不误伤本地行。
- `database.service.ts` 启动迁移方法与 onModuleInit 调用已移除（`toRelativeSummaryOutputPath` import 保留供 upsert 咽喉点使用）；测试文件移除启动迁移用例，保留 upsert 咽喉点与助手纯函数用例。
- `pnpm typecheck` 通过；server 数据层测试 60/60 通过。
