# Plan：P1 — Prisma 基础设施（零行为变更）

> 日期：2026-09-01
> 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
> 需求：`docs/requirements/2026-09-01-prisma-orm-introduction.md`
> 前置：P0 已闭合（`docs/plans/2026-09-01-prisma-p0-test-harness-and-baseline-plan.md`）
> Audit: 已通过独立 subagent 审计并修订，见 `docs/audits/2026-09-01-plan-audit-prisma-p1-infrastructure-plan.md`

## 1. Goal

server 包正式接入 Prisma 8 依赖与构建链路，落位 contract、生成产物与 NestJS `PrismaService`；**不切换任何数据访问路径**，现有 `DatabaseService` 与全部消费者行为不变。

## 2. 已核实的 Prisma 8 事实（P0/P1 探查实证）

- CLI：`prisma@latest` = 8.0.0-rc.12；运行时包 `@prisma/orm-postgres`（版本独立于 CLI）。
- contract 三件套同目录：`contract.prisma`（手写源）、`contract.json` + `contract.d.ts`（`contract emit` 生成，**需提交**）。
- 运行时 client：`import postgres from '@prisma/orm-postgres/runtime'` → `postgres<Contract>({ contractJson, url })`，查询形如 `db.orm.public.<Model>.where({...}).first()`。
- **Prisma Next 要求 PostgreSQL ≥ 15**（测试容器 17 ✓；云端 RDS 版本需在 P3 前核实）。
- contract PSL 不一定保留索引排序方向（P0 实测丢失 `DESC`）；P1 验证 `updatedAt(sort: Desc)` 语法是否被 emit/verify 接受，不接受则如实记录限制。

## 3. Scope

### 3.1 依赖与配置

- `packages/server/package.json`：+`@prisma/orm-postgres`（dependencies）；+`prisma`、`@prisma/cli-engine`（devDependencies，`prisma.config.ts` 依赖）。**三者均 save-exact 精确锁版**（RC 窗口期内 `^` 语义会漂移到 stable，造成 CLI/运行时/contract 产物错配）；不引入 dotenv（server 经 `--env-file`/环境注入，CLI 命令经环境变量取 `DATABASE_URL`；闭合时实测 `contract emit` 无 dotenv 可用）。
- `packages/server/prisma.config.ts`：`definePrismaConfig({ orm: ormConfig({ contract: './src/prisma/contract.prisma', db: { connection: process.env.DATABASE_URL } }) })`。
- `packages/server/package.json` scripts：+`prisma:emit`（`prisma contract emit`），供 contract 变更后手动/CI 执行。

### 3.2 Contract 落位

- 从 P0 基线 `packages/server/prisma/baseline/contract.prisma` 复制到 `packages/server/src/prisma/contract.prisma`，保留推断出的模型/索引/映射；baseline 目录保留为历史记录。
- 修正项：`idx_ai_summary_task_updated_at` 补排序方向（语法可行则 `updatedAt(sort: Desc)`，否则维持现状并记录）。
- `contract emit` 生成 `contract.json` + `contract.d.ts` 并提交；`Contract` 类型即 `contract.d.ts` 的导出，`PrismaService` 从该文件 import type（tsconfig `include: ["src"]` 自动拾取，typecheck 步骤验证）。
- 构建产物交付机制（单一机制，已定）：**import attributes（`import contractJson from './contract.json' with { type: 'json' }`）+ tsc 自动 emit**——被 src 代码 import 的 json 在 `rootDir: src` 下由 tsc 按相对路径复制进 dist（base tsconfig 已有 `resolveJsonModule`），无需 nest-cli.json。备选回退（仅当实测失败时启用）：`new URL(..., import.meta.url)` + fs 读，此时才需要 nest-cli.json assets（include 路径相对 sourceRoot，为 `prisma/contract.json`）。

### 3.3 PrismaService（NestJS 装配）

- `packages/server/src/database/prisma.service.ts`：`@Injectable()`，内部持 `postgres<Contract>` client（`url: process.env.DATABASE_URL`，同 `DATABASE_URL`）；`OnApplicationShutdown` 关闭连接。连接惰性建立（首个查询才连），注册本身不改变启动行为；`DATABASE_URL` 缺失时与 `DatabaseService` 同语义（构造即抛错，不引入新启动失败模式）。`app.module.ts` 根注册会急事实例化构造函数，故缺失即抛与现状一致。
- `packages/server/src/database/prisma.module.ts`：提供并导出 `PrismaService`；`app.module.ts` imports。**零消费者改动**：本阶段无任何 service/controller 注入它。

### 3.4 连接策略决策（写入 plan 与 closure 记录）

- **决策：P1 采用独立连接**（Prisma client 自建连接，非复用 `DatabaseService` 的 `pg` Pool），理由：driver adapter 复用 pool 的 API 未在文档实证、且需暴露 `DatabaseService` 私有 pool 造成耦合；过渡期连接上限临时升高（pg max 10 + Prisma 默认）对本地/云端 RDS 均可承受。P2 若出现连接压力再评估 adapter 复用。
- **pgTypes.setTypeParser 全局影响**：现有全局 parser（int8→Number、timestamptz→ISO string）影响进程内所有 `pg` 连接。P1 用实测钉住 Prisma client 对 BigInt/Timestamptz 列的**实际返回类型**（可能为 BigInt/Date，也可能被全局 parser 影响），结果写入 closure 记录，作为 P2 映射层设计输入；P2 映射层须同时精确复刻 `toIsoTimestamp` 归一化（`database.service.ts:1560-1581`，仅作用于 `pg` 连接），与实测类型一并继承给 P2a 子 plan。
- `connectWithRetry` 语义：`PrismaService` 本阶段不复制重试逻辑（惰性连接 + 无消费者）；首个消费域切换时（P2a）如需重试语义，由该域子 plan 决策。

### 3.5 验证

- `packages/server/tests/prisma/prisma-service.test.ts`：测试库上实例化 `PrismaService`，经 `db.orm` 读取 `AppSettings`/`Task`（seed 由现有 pg pool helper 写入），断言可连通、字段形状正确，并记录 BigInt/Timestamptz 的运行时类型；附加断言：仅构造 `PrismaService`（不发查询）不建立连接（惰性）。
- dotenv 排除验证：`prisma contract emit` 在无 dotenv、仅 process env `DATABASE_URL` 下成功。
- 全量回归：`pnpm --filter @bilibili-downloader/server test`（既有 40 用例不受影响）、`pnpm typecheck`、`pnpm build`。
- `dist` 冒烟：`node -e "import('./packages/server/dist/database/prisma.service.js')"` 级别的可加载性检查（不连库），证明 import attributes 与 assets 复制正确。

## 4. Out Of Scope

- 任何 `DatabaseService` 方法、consumer、API 行为的改动。
- schema 所有权 / migrate（P3）。
- Dockerfile / compose 改动（P4）。
- `progressBuckets`、日志语义（P2d）。

## 5. 风险

| 风险 | 对策 |
| --- | --- |
| `@prisma/orm-postgres/runtime` 与 server 的 moduleResolution bundler / ESM 组合兼容性 | P1 实测 typecheck+build+dist 冒烟；不兼容则记录并升级处理（如调 tsconfig module） |
| import attributes 在 vitest 2.1.8（vite 5 变换管线）下行为与 tsc/node 不一致 | §3.5 测试覆盖；失败即切换 fs-read 回退机制（plan §3.2 已定） |
| `contract emit` 对 `sort: Desc` 的支持不确定 | 实测决定；失败则记录为限制，P3 migrate 比对时人工核对 |
| contract.d.ts 生成物与 `composite: true` 工程冲突 | skipLibCheck 已开；实测 build |
| 全局 pg type parser 使 Prisma 返回类型与 contract 标注（BigInt/Timestamptz）不一致 | P1 实测记录，P2 映射层按实测设计 |
| 云端 PG 版本 < 15 | P3 前人工核实 RDS 版本；本阶段仅记录 |

## 6. 闭合判据

1. §3.5 全部验证通过（证据入 `docs/testing/2026/`）。
2. `PrismaService` 已注册但零消费者注入（diff 复核）；既有 40 用例不回归。
3. 连接策略决策与运行时类型实测结论写入 closure 记录与 `docs/logs/`。
4. `project-context.md` 技术基线行更新（提及 Prisma 8 基础设施）。
5. cold-replay 闭合自检（P1 无行为变更，非保护区，可用 cold-replay）。

## 7. Checklist

- [x] 依赖 + `prisma.config.ts` + `prisma:emit` 脚本（版本锁定：prisma 8.0.0-rc.12 / @prisma/cli-engine 0.3.0 / @prisma/orm-postgres 8.0.0-rc.8 / temporal-polyfill）
- [x] contract 落位 + DESC 修正尝试（`sort: Desc` 被 PSL 拒绝，维持记录在案）+ emit 产物提交（storageHash 与基线一致）
- [x] PrismaService / PrismaModule / app.module 注册（含 Temporal 全局注入，见 testing 文档发现 1）
- [x] PrismaService 集成测试（4 用例，运行时类型：int8→BigInt、timestamptz→Temporal.Instant）
- [x] 全量回归（44/44、typecheck、build、dist 冒烟均通过）
- [x] closure 记录（连接决策 + 类型实测）+ 文档同步 + cold-replay（2026-09-01：对照 §3/§5/§6 与 testing 证据逐项核对；零行为变更经 git diff 与"无消费者注入"复核；本文件与 testing 文档、logs 一致）

## 8. Closure 记录（§3.4 决策落定）

- **连接策略**：PrismaService 独立连接（未复用 `pg` Pool），理由见 §3.4；P2 若出现连接压力再评估 driver adapter 复用。
- **运行时类型实测**：见 `docs/testing/2026/09-01-prisma-p1-infrastructure-testing.md` 发现 1/2 —— P2 映射层输入：BigInt→Number、`Temporal.Instant`→ISO 字符串，并复刻 `toIsoTimestamp`（database.service.ts:1560-1581）的历史格式归一化语义。
- **PG ≥ 15**：测试容器 17 满足；云端 RDS 版本核实留给 P3 前人工确认。
