# Prisma Schema 基线（P0 产物）

本目录是 P0 阶段从"由 `initSchema()` 初始化的 PostgreSQL 库"推断出的 Prisma 8 contract 基线，仅作 P1 接入的输入，本阶段不接入构建、不生成 client、不参与运行时。

## 生成环境与命令（2026-09-01 实测）

- CLI：`prisma@latest` → 解析版本 **8.0.0-rc.12**（无 stable 8.x；`pnpm dlx prisma@8` 因 semver 不匹配 prerelease 不可用）
- 扩展包：`@prisma/orm-postgres`、`@prisma/cli-engine`、`dotenv`（config 依赖，P1 才正式入 server 依赖）
- 数据库：一次性 `postgres:17` 容器（`bdl_test`），schema 由 `DatabaseService.onModuleInit → initSchema()` 原样创建

```bash
prisma contract infer --db <url> --output src/prisma/contract.prisma
prisma contract emit      # 产出 contract.json + contract.d.ts
prisma db sign            # 在库内写入 marker
prisma db verify          # ok:true："Database marker and schema match contract"
```

## 与 `initSchema()` 逐表核对记录

8 张表（task、analysis_sub_task、ai_summary_task、app_settings、ai_prompt、ai_prompt_creator、summary、summary_segment）全部推断成功，`db verify` 通过。差异/注记：

| # | 发现 | 处置 |
| --- | --- | --- |
| 1 | `idx_ai_summary_task_updated_at` 实际是 `(updated_at DESC)`，推断出的 contract 丢失排序方向（`@@index([updatedAt])`） | P1 接手时若迁移工具比对严格，需手工补回 DESC；已记录 |
| 2 | `task` 表 camelCase 列（`"fileNameTemplate"` 等）直接映射为字段名、无 `@map`；其余表 snake_case 经 `@map` 映射 | 符合"命名保持原样"决策 |
| 3 | int8/integer 混用：`task.prompt_id`/`ai_summary_task.prompt_id` 为 INTEGER，`ai_prompt_creator.prompt_id` 为 BIGINT；id/cid/fileSize/durationMs/mid 为 BIGINT → contract 中 `BigInt` | 与现状一致；运行时 number 转换语义由 P1 映射层复刻 |
| 4 | partial unique index `idx_analysis_sub_task_active ... WHERE status <> 'failed'::text` 被完整推断（`unique: true` + `where`） | 正确 |
| 5 | FK：`analysis_sub_task.task_id → task.id`（无 ON DELETE）；`summary_segment.summary_id → summary.id`（ON DELETE CASCADE） | 正确；`deleteTask` 两步删除语义与 ON DELETE 行为差异在 P2d 处理 |
| 6 | `summary.raw_response` 推断为 `Jsonb` | 正确 |
| 7 | contract 模型名（`Task`、`AiSummaryTask` 等）为推断器命名，非最终命名 | P1 可调整模型名，表/列名不动 |

## 注意

- 本次 `db sign` 在测试容器库内写入了 marker；容器为一次性（`--rm`），无残留影响。正式接入（P1/P3）时对存量库是否 sign 由 P3 plan 决策。
- 基线推断自"空表 + 测试数据"库，与生产库结构一致（同一 `initSchema()` 建库路径）。
