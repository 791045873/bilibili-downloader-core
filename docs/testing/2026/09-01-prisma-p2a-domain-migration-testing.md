# Testing — P2a 域迁移（ai_prompt / ai_prompt_creator / app_settings → Prisma）

- 日期：2026-09-01
- Plan：`docs/plans/2026-09-01-prisma-p2a-domain-migration-plan.md`
- 结果：**PASS**（46/46 tests；typecheck、build 通过；消费方文件零改动）

## 实施要点（Prisma 8 新查询 API 实测语义，P2b–P2d 直接复用）

1. **Timestamptz 写入必须传 `Temporal.Instant`**（传 Date 报 codec 错误，提示明确要求 Instant 或 TimestamptzString(p)）；统一用 `Temporal.Instant.fromEpochMilliseconds(Date.now())`。
2. **upsert 签名**：`upsert({ create, update, conflictOn?: 唯一键对象 })` —— 冲突键不在顶层字段，必须放 `conflictOn`。
3. **orderBy**：回调式，多项排序为**回调数组** `[(m) => m.isSystem.desc(), (m) => m.createdAt.asc()]`（不是 item 数组）。
4. **IN 过滤**：shorthand 对象不支持 `{ in: [...] }`，必须回调式 `.where((m) => m.key.in(keys))`。
5. **updateAll 要求前置 where**：类型层面强制；全表更新用 `.where((m) => m.id.isNotNull()).updateAll(...)`。
6. **缺失行行为**：`.where({id}).update()/delete()` 返回 `null` 不抛错 —— 与现 SQL 0 行影响的 no-op 语义一致，已补测试钉住。
7. `.where().update()/delete()` 返回受影响行（或 null）。

## 映射层（§3.2 落地）

- `bigintToNumber`：id/promptId/mid（BIGINT）→ number
- `toIsoString`：`Temporal.Instant` → `new Date(epochMilliseconds).toISOString()`（3 位毫秒 UTC，与现 `toIsoTimestamp` 输出格式完全一致；不用 `Instant.toString()`）
- 输入侧 `BigInt(n)` / `Temporal.Instant.fromEpochMilliseconds`
- `is_system`/`is_default` INTEGER 直通 number；`app_settings.value` 可空但写入端不产 null，`Record<string,string>` 契约不变

## 门面装配

- `DatabaseService` 构造函数可选注入 `PrismaService`：生产路径 `DatabaseModule` imports `PrismaModule` 注入共享单例；直接构造（测试）时经 `createPrismaClient()` 工厂自建并在自身 shutdown 关闭（owns 标记），既有测试文件零改动。
- P1 的 `PrismaService` 成为首消费方（经 `DatabaseService`）。

## 验证证据

- 既有 ai-prompt/settings 域行为测试原样通过（等价性证据），新增 1 例 no-op 测试（不存在 id 的 update/setDefault/delete）
- `pnpm --filter @bilibili-downloader/server test`：8 文件 **46/46** 通过
- `pnpm typecheck`、`pnpm build` 通过；`git diff --stat` 确认仅 `database.service.ts`/`database.module.ts`/`prisma.service.ts` 变更，消费方与 API 路由零改动
- 4 处日志点（insertAiPrompt/deleteAiPrompt/upsertCreatorBinding/deleteCreatorBinding）原样保留（diff 复核）

## 产物清单

- 修改：`database.service.ts`（13 方法切 Prisma + 映射层 + 门面装配）、`database.module.ts`（+imports）、`prisma.service.ts`（抽 `createPrismaClient()` 工厂）
- 修改：`tests/database/ai-prompt.test.ts`（+1 no-op 用例）
