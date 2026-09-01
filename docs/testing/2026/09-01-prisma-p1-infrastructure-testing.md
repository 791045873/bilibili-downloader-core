# Testing — P1 Prisma 基础设施

- 日期：2026-09-01
- Plan：`docs/plans/2026-09-01-prisma-p1-infrastructure-plan.md`
- 结果：**PASS**（44/44 tests；typecheck、build、dist 冒烟通过）

## 版本（save-exact 锁定）

- `prisma` 8.0.0-rc.12（devDep）
- `@prisma/cli-engine` 0.3.0（devDep，`prisma.config.ts` 依赖）
- `@prisma/orm-postgres` 8.0.0-rc.8（dep，运行时）
- `temporal-polyfill`（dep，见发现 1）

## 发现（对 P2 映射层的关键输入）

1. **Temporal 必需**：Prisma 8 timestamptz codec（`pg/timestamptz-temporal@1`）解码需要全局 `Temporal`，Node 24.16 默认无（需 `--harmony-temporal`）。处置：`PrismaService` 模块加载时以 `temporal-polyfill` 注入 `globalThis.Temporal`（无则注入，additive、零行为变更）。
2. **运行时类型（与 pg 栈不同，P2 映射层必须转换）**：
   - int8（BIGINT：id/cid/fileSize/durationMs/mid）→ `BigInt`（现状 API 为 `Number`）
   - timestamptz → `Temporal.Instant`（现状 API 为 ISO 字符串，经 `toIsoTimestamp` 归一化）
   - `Temporal.Instant.toString()` 输出 ISO UTC 格式，与现有 API 兼容，但类型需显式转换
   - pg 全局 type parser（`pgTypes.setTypeParser`）不影响 Prisma 独立连接的解码
3. **contract PSL 不支持索引排序方向**：`updatedAt(sort: Desc)` 被 PSL 解析器拒绝（`PSL_INVALID_ATTRIBUTE_SYNTAX`）；`idx_ai_summary_task_updated_at` 的 `DESC` 维持记录在案（emit storageHash 与 P0 基线一致：`85d08401…`），P3 migrate 比对时人工核对。
4. **tsc 自动 emit 验证**：被 import 的 `contract.json` 在 rootDir src 下自动复制到 `dist/prisma/contract.json`（无需 nest-cli.json，审计预判正确）；tsconfig 需显式 include 该 json（composite 项目 TS6307）。
5. dotenv 排除验证通过：`prisma contract emit` 仅凭 process env 成功。

## 测试

- 新增 `tests/prisma/prisma-service.test.ts`（4 用例）：db.orm 读取 AppSettings；Task 运行时类型钉住（BigInt/Instant）；`DATABASE_URL` 缺失构造即抛（与 DatabaseService 同语义）；惰性连接（不可达端口下构造成功、查询才失败）。
- 回归：既有 40 用例全部通过（8 文件 44 用例）。
- dist 冒烟：`import('./packages/server/dist/database/prisma.service.js')` 可加载，缺失 URL 行为正确（import attributes + runtime 子路径解析无误）。

## 产物清单

- 新增：`packages/server/prisma.config.ts`、`packages/server/src/prisma/{contract.prisma,contract.json,contract.d.ts}`、`packages/server/src/database/{prisma.service.ts,prisma.module.ts}`、`packages/server/tests/prisma/`
- 修改：`packages/server/package.json`（+3 依赖、+`prisma:emit` 脚本）、`tsconfig.json`（include 补 json）、`app.module.ts`（+PrismaModule 注册）
- 行为：零变更（PrismaService 无消费者注入；client 惰性连接）
