# 2026-09-04 summary_output 相对路径化

## 背景

`ai_summary_task.summary_output` 原存生成时的绝对路径，换环境（本地 ↔ Docker 云端）后同一云端库中的历史记录路径失效。用户要求：存相对路径、读侧按当前环境基础路径拼接、并修正存量数据。

## 改动

- `summary-dir.ts` 新增两个纯助手：
  - `toRelativeSummaryOutputPath(value, downloadRoot)`：仅当值位于 downloadRoot 之下时转相对（POSIX 分隔符）；大小写仅用于归属判定、`relative()` 保留原 case；空串/越界/等于根返回 null 不改写。
  - `resolveSummaryOutputPath(value, downloadRoot)`：相对值按根拼接为绝对路径；绝对值（迁移前遗留）原样透传。
- 写侧咽喉点（审计 M4 方案 a）：转换下沉 `DatabaseService.upsertAiSummaryTask`，全量写入自动相对化；空串清空语义不变。
- 读侧三处 resolve：markdown 查看端点、publish 知识库端点、历史回填服务（KnowledgePublisher 契约不变，仍收绝对路径）。
- 启动幂等迁移 `migrateAbsoluteSummaryOutputToRelative()`（onModuleInit，seed 之后）：仅改写 DOWNLOAD_ROOT 之下的绝对值；UPDATE 带读时值 CAS 防多实例并发覆盖；不触碰 `updated_at`（避免打乱列表排序）；根外遗留绝对值保留。无 schema 变更（text 列语义变化）。

Plan：`docs/plans/2026-09-04-summary-output-relative-path-plan.md`（独立 subagent 审计 passed-with-notes，M1-M4/m1-m5 已修订）。Requirement：`docs/requirements/2026-09-04-summary-output-relative-path.md`。

## 验证

- `pnpm typecheck`、`pnpm build` 通过。
- server 数据层测试 61/61 通过（含新增：upsert 咽喉点、迁移幂等/越界保留/updated_at 不变、助手纯函数用例；测试库 pgvector:pg17 @55432）。
- 运行级验证（真实总结生成→查看→发布→换环境重启迁移）留用户部署后确认。

## 已知边界

- 迁移前旧 `cwd/summaryDir` 位置的遗留绝对值不迁移（沿用 2026-09-03"忽略旧数据"决策），读侧容错原样读取。
- 同一记录若曾在 A 环境生成、文件被拷到 B 环境 `DOWNLOAD_ROOT/summary` 下，需手动把 DB 值改为相对路径（或删除记录重触发）。

## v2 修订（同日，用户决策：存量修正不用启动迁移）

- 移除 `database.service.ts` 的启动迁移方法与 onModuleInit 调用；存量修正改为一次性 SQL 脚本 **`packages/server/scripts/one-off-migrations/003-summary-output-relative.sql` 手动执行**（幂等，可重复）。
- 用法：停全部 server → 改脚本内 root 字面量为当前环境下载根目录（本地 `E:/sata1-18502986266/bilibili-download`，Docker `/download`；正斜杠、无尾斜杠）→ `psql "$DATABASE_URL" -f ...` → 核对 `UPDATE n` 计数。本地与 Docker 各执行一次。
- v2 快速审计 passed-with-notes（M1 空剩余段守卫 / M2 弃 ILIKE 改等值比较 / m1 尾斜杠 / m2 单条 UPDATE / m3 计数核对 / m4 README 登记），已全部落入脚本。
- 测试库实证：反斜杠/正斜杠 Windows 路径正确转换；Docker 行、相对值、空串、遗留值、value==root、value==root+'/' 均不动；`updated_at` 不变；重复执行 UPDATE 0；`/download` 根不误伤本地行。
- `pnpm typecheck` 通过；server 数据层测试 60/60。写侧相对化（upsert 咽喉点）与读侧 resolve 不变。

## 执行记录：云端存量数据已修正

- 2026-09-04：用户已在云端 PostgreSQL（`DATABASE_URL` 指向的阿里云 RDS）手动执行 `packages/server/scripts/one-off-migrations/003-summary-output-relative.sql`（root 按云端环境设置）。存量绝对路径已按脚本语义修正为相对路径，幂等可重复；后续如发现个别行未覆盖（根外遗留值属预期保留），可核对后按需再执行。
