# Plan Audit — knowledge-backfill（含 Prisma 迁移后基线核对）

- 计划：`docs/plans/2026-09-01-knowledge-backfill-plan.md`（2026-09-01 起草，早于 Prisma 迁移 P0–P4）
- 需求：`docs/requirements/2026-09-01-knowledge-backfill.md`
- 审计日期：2026-09-02
- 审计方式：独立 subagent（只读审计 + live 基线核对）。非保护区，closure 可用 cold-replay。

## 结论

VERDICT: PASS WITH REVISIONS → 修订后 approved。方案结构、范围、三个 Decision（内联构造不抽取、并发度 2、内存态批次）经 live 核对仍然成立；Testing TD-1~6 全部行为级、不依赖实现细节，Prisma 化后照用。

## 发现与吸收

1. **CRITICAL——notIn 可空列语义陷阱**：`knowledge_status` 可空，裸 `.notIn(['synced'])` 生成 SQL `NOT IN` 会把 NULL 行（从未发布——89 条回填主体）静默排除（typecheck 通过、仅表现为 total=0）。已在 plan Item 钉死修正表达：`or(m.knowledgeStatus.isNull(), m.knowledgeStatus.notIn(["synced"]))` + `m.rawResponse.isNotNull()`。
2. **每条重查数据源（Moderate）**：`publish` 内部无 synced 守卫（无条件重跑管道）——plan 的"处理前重查"钉为既有 `getAiSummaryTaskById(id)`，TOCTOU 由 (bvid,cid) upsert 幂等兜底。
3. **基线刷新（Moderate）**：Current Baseline 更新为 Prisma 门面现状（raw SQL 仅哨兵+双 claim；容器自动 db init；89 行数字标注为快照、实施时重新计数）。
4. **docker 命令（Minor）**：`pnpm docker:build:server` 非根脚本 → 改 `pnpm --filter @bilibili-downloader/docker docker:build:server`。
5. **建议（可选，采纳）**：testing 补一条"knowledge_status 为 NULL 的行必须包含在回填集合中"的显式断言。
6. **核对无误**：内联构造 Decision 仍成立（3 个调用点、title 回退链确有差异）；无队列设施断言仍成立；串行约束已解除（project-context）。
