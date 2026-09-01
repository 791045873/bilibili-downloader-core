# Log — 2026-09-01 Prisma P1（基础设施）

- 完成 P1 plan（经 subagent 审计修订后 approved）并实施：
  - 依赖精确锁版：prisma 8.0.0-rc.12 / @prisma/cli-engine 0.3.0 / @prisma/orm-postgres 8.0.0-rc.8 / temporal-polyfill；`prisma.config.ts` + `prisma:emit` 脚本。
  - contract 三件套落位 `src/prisma/`（emit storageHash 与 P0 基线一致）；PSL 不支持 `sort: Desc`，`idx_ai_summary_task_updated_at` DESC 限制记录在案（P3 人工核对）。
  - `PrismaService`（独立连接、惰性连接、`DATABASE_URL` 缺失构造即抛）+ `PrismaModule` 注册至 `app.module.ts`；零消费者注入，零行为变更。
  - tsc 自动 emit `contract.json` 进 `dist/prisma/`（无需 nest-cli.json；tsconfig include 需显式列 json，composite TS6307）。
- 关键发现（P2 映射层输入）：
  - Prisma 8 timestamptz codec 需要全局 `Temporal`（Node 24 无，`--harmony-temporal` 可开）；已在 `PrismaService` 以 `temporal-polyfill` 注入。
  - 运行时类型：int8→`BigInt`、timestamptz→`Temporal.Instant`；与现有 API 的 Number/ISO 字符串不同，P2 映射层必须转换并复刻 `toIsoTimestamp`。
- 验证：8 文件 44 用例通过；`pnpm typecheck`、`pnpm build` 通过；dist 加载冒烟通过。
- 遗留：云端 RDS 版本（需 ≥15）P3 前人工核实。
