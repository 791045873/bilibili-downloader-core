# Plan：P0 — 测试基座与 Prisma schema 基线

> 日期：2026-09-01
> 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
> 需求：`docs/requirements/2026-09-01-prisma-orm-introduction.md`
> Audit: 已通过独立 subagent 审计并修订，见 `docs/audits/2026-09-01-plan-audit-prisma-p0-test-harness-and-baseline-plan.md`

## 1. Goal

为 server 包建立可运行的数据库行为测试基座，并对现有 `DatabaseService` 的关键行为（含数据删除路径）建立"现状钉住"的行为测试；同时用 Prisma CLI 从既有库结构生成 schema 基线产物，供 P1 使用。**本阶段不改任何产品代码行为。**

## 2. Scope

### 2.1 测试基座

- server 包接入 vitest（沿用 `packages/bilibili-api-sdk` 的既有模式：`type: module`、`tests/` 目录、`vitest run`）。
- 测试数据库供给：经 `TEST_DATABASE_URL` 环境变量注入；`DatabaseService` 构造读 `process.env.DATABASE_URL`（构造时读取，非模块加载时），测试 setup 在实例化前将 `DATABASE_URL` 指向 `TEST_DATABASE_URL`。未设置时**fail-loud**：所有测试失败并输出设置说明（含容器命令），不允许静默跳过。注意：DB 不可达时 `connectWithRetry` 线性退避 10 次约 55s 后才失败，属预期。
  - 文档化的一键容器命令（Windows/Docker Desktop）：`docker run --rm -d --name bdl-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bdl_test -p 55432:5432 postgres:17`；不强制 Docker，任何可达 PG 均可。
- 测试间隔离：每个用例前 TRUNCATE 全部业务表（RESTART IDENTITY CASCADE），不重建库；FK（analysis_sub_task→task、summary_segment→summary）由 CASCADE 覆盖，partial unique index 不受 TRUNCATE 影响。
- 播种/一次性迁移的可测性：二者仅在 `onModuleInit → initSchema()` 运行，用例内 TRUNCATE 后不会自动重跑；相关用例直接以 test-only 方式再次调用 `initSchema()`（类型断言访问私有方法）验证幂等。
- `package.json` 增加 `test` 脚本与 vitest devDependency；vitest 版本对齐 SDK（^2.1.x）。注意：`tests/` 与 `vitest.config.ts` 不在 server tsconfig `include: ["src"]` 内，测试类型错误仅在 vitest 运行时暴露（与 SDK 先例一致）。

### 2.2 行为测试（test-first，钉住现状）

| 域 | 必测行为 |
| --- | --- |
| task 生命周期 | insertTask 返回自增 id，默认值钉住（status='created'、progress=0、autoSummary=0、summaryStatus='none'、updatedAt 取 now 忽略传入值）；updateTaskProgress；updateTaskStatus（success/failed 置 completedAt、动态 SET 字段）；claimNextCreatedTask（FIFO、原子性：无可抢任务返回 undefined、抢后状态 downloading）；**并发用例**：并行两次 claimNextCreatedTask 恰好一次成功 |
| task 查询 | listTasksPaginated（状态组展开 all/active、分页 total/hasMore、JOIN 出 summaryStatus）；findTasksByBvidsAndCids（(bvid,cid) 元组去重语义）；findLatestTaskByBvidAndCid；findCompletedTaskByBvidAndCid 仅取 success |
| task 删除路径（契约） | deleteTask：删 task + analysis_sub_task，两步非事务，**保留** summary/summary_segment（现状怪癖按原样钉住）；clearTasks：清空两表 |
| analysis_sub_task | insert/update 状态流转；getAnalysisSubTasks 按 bvid+cid 资源级查询；initSchema 后 partial unique index `idx_analysis_sub_task_active` 生效（活跃重复插入冲突，failed 不受限）；一次性"旧记录 supersede"迁移幂等 |
| ai_summary_task | claimAiSummaryTask 守卫语义（新建→claimed；pending/analyzing→rejected；终态→re-claim 并重置执行字段，同时覆盖 title/sourceTaskId/promptId、置 lastTriggeredAt、**保留** lastCompletedAt）；**并发用例**：pending 期间并行 claim 恰好一次 claimed:true；upsertAiSummaryTask 字段保留语义（promptId/executionTiming/rawResponse/modelName/createdAt 未提供时保留既有值）；deleteAiSummaryTask 条件删除（pending/analyzing 拒绝）并断言 boolean 返回契约；listAiSummaryTasksPaginated 过滤（status 多选、search ILIKE + 转义、updatedFrom/To）；updateSummaryKnowledgeStatus |
| 启动对账 | reconcileStaleAnalysisState：created 子任务与 pending/analyzing 总结置 failed 并写入重启消息；终态不受影响 |
| 一次性状态合并迁移 | initSchema 的 task.summary_status → ai_summary_task 合并（ON CONFLICT DO NOTHING 幂等、completed 时的 lastCompletedAt 取值） |
| ai_prompt | insert/list 排序（is_system 优先、created_at 升序）；update；delete；clearAiPromptDefault/setAiPromptDefault/getDefaultAiPromptId；initSchema 空表播种内置提示词，重复调用不重复播种（幂等） |
| ai_prompt_creator | upsert/delete/getCreatorBindingByMid |
| app_settings | getSettings 缺失键不含于结果；setSettings upsert；空串删除 |
| 知识库 | upsertSummaryKnowledge：首次写入 summary+segments；重复发布替换旧 segments（幂等）；事务内一致（segments 与 summary 同生共死） |
| 类型语义 | 时间戳字段以 ISO 8601 字符串返回（'T' 分隔，UTC 'Z'）；int8 字段为 number——范围含 id、cid（三表）、fileSize、durationMs、ai_prompt_creator.mid |

日志语义（progressBuckets 去重等）不做断言测试——**对总 plan §3 的显式偏差**：progressBuckets 为进程内存态、无 DB 可观察效应，P0 无法以行为测试钉住；该保留义务由 P2d 子 plan 继承（P2d 闭合判据须包含 progressBuckets 语义保持）。总 plan §3 措辞在 P0 闭合时同步更新。

### 2.3 Prisma schema 基线

- 当前 npm dist-tags：`latest` = `8.0.0-rc.12`（无 stable 8.x，semver `8` 匹配不到 prerelease），故 CLI 用 `pnpm dlx prisma@latest` 并在基线 README 中记录解析到的确切版本；若实施日已有 stable 8.x，改用 `prisma@8` 并记录。
- Prisma 8 工作流（以当日官方文档为准）：`contract infer --db <url> --output <path>` → `contract emit` → `db sign` → `db verify`（若 CLI 形态不同，按实际命令执行并如实记录）。
- 产物落盘 `packages/server/prisma/baseline/`（schema/contract 文件 + 生成命令记录 README），并逐表与 `initSchema()` DDL 人工核对，核对记录写入 `docs/testing/`（差异点：列类型、默认值、索引、命名映射注记；`task` 表 camelCase 列需 `@map`）。
- 基线产物仅作 P1 输入，本阶段不接入构建、不生成 client。

## 3. Out Of Scope

- 修改 `DatabaseService` 或任何产品源码（唯一例外：`package.json` devDependency/scripts、新增 `vitest.config.ts`、新增 `tests/`、新增 `prisma/baseline/`）。
- Dockerfile / compose 改动。
- 任何 Prisma 运行时接入。

## 4. 验证

| Purpose | Command |
| --- | --- |
| 数据层测试 | `pnpm --filter @bilibili-downloader/server test`（新增） |
| Typecheck | `pnpm typecheck` |
| Build | `pnpm build` |

闭合时回填 `docs/context/project-context.md` 验证命令表（Unit tests 行 + 备注测试库要求）。

## 5. 闭合判据

1. 全部测试在本地通过（附输出证据至 `docs/testing/2026/`）。
2. `pnpm typecheck`、`pnpm build` 通过。
3. 基线产物 + 逐表核对记录存在且差异点全部解释。
4. `project-context.md` 验证命令表已回填。
5. `docs/logs/` 追加日期日志；总 plan checklist 更新。
6. 闭合审计（P0 属非保护区、非产品行为变更，可用 cold-replay）。

## 6. 风险与回滚

- 风险：Windows 本地无 Docker / 无可用 PG → 测试无法运行。对策：TEST_DATABASE_URL 指向任何可达 PG 即可；容器命令仅为推荐。
- 风险：Prisma 8 CLI 工作流与预期不符（contract infer vs db pull）。对策：以当日官方文档为准，产物形态允许偏差，核对记录如实记载所用命令。
- 回滚：删除新增文件与 devDependency 即可，无产品代码改动。

## 7. Checklist

- [x] vitest 接入 + 测试库供给与隔离 helper（fail-loud 已实测：未设 TEST_DATABASE_URL 即报错并输出容器命令）
- [x] §2.2 全部行为测试编写并通过（7 文件 40 用例，2026-09-01）
- [x] Prisma 基线产物 + 逐表核对记录（`packages/server/prisma/baseline/`，infer→emit→sign→verify 全通过）
- [x] 验证命令回填 project-context
- [x] 测试证据落 `docs/testing/2026/09-01-prisma-p0-baseline-testing.md`、日志落 `docs/logs/2026-09-01-prisma-p0-test-harness-baseline.md`
- [x] cold-replay 闭合自检（2026-09-01）：对照 plan §2/§5 逐项核对本 checklist 与 testing 证据；`src/` 零产品代码改动经 git diff 复核；对总 plan §3 的 progressBuckets 偏差声明与总 plan 措辞更新一致；fail-loud 行为与 plan §2.1 一致（双向实测）。
