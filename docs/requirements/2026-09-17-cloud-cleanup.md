# 需求：收敛与清理（Phase 4）

> 来源：拆自 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（Phase 4）
> Owner Doc：`docs/design/app-overview.md`、`docs/architecture/system-baseline.md`、`docs/context/codebase-map.md`
> 前置：Phase 1a / 1b / 2 / 3 均已落地并验证
> 保护区：**数据删除（`ask-first`）**——删除既有本地文件与列需 owner doc + 测试 + 人工批准；reviewer availability=none 时 blocked
> 状态：待前置完成后实现（含数据删除，须人工批准）

## Goal

在读取与发布完全脱离本地文件、且部署拆分稳定后，收敛遗留物：删除既有本地 md / 截图副本、清理废弃列与 helper，并收口删除 / 重总结的级联语义。

## In Scope

### 数据清理（保护区）

- 删除 NAS 上既有的本地 md 与截图副本（验证通过后；先只读备份 → 人工确认 → 删除）。
- 删除废弃列（需人工批准）：`ai_summary_task.summary_output`、`knowledge_status`、`knowledge_error`（最终去留由本需求确认）。
- 清理 `worker_job` 终态作业（保留期如 30 天）。

### 代码 / 文档清理

- 移除 `PathsService.SUMMARY_BASE_DIR`、`resolveSummaryOutputPath`、`listLocalImageRefs`、`rewriteMarkdownImageUrls`、`rewriteMarkdownImages` 等仅服务本地 md 的 helper。
- 删除/收口删除与重总结的级联：删除 `summary` 级联 `summary_segment`，并投递 `cos_cleanup`（`queue=api`）。
- 更新 owner docs：`app-overview.md`、`system-baseline.md`、`module-boundaries.md`、`codebase-map.md`、`feature-inventory.md`。

## Out Of Scope

- 任何功能性变更（本阶段只清理）。
- 用户系统、鉴权（已由 auth 需求承担）。
- 视频清理（NAS 视频保留）。

## Business Rules

- **先备份后删除**：本地副本在人工确认前保留为只读备份。
- **删列需人工批准**：列删除属数据保护区。
- **级联一致**：删除 `summary` 必须级联 segments 并清理 COS 前缀。

## Roles / Permissions

- 沿用现状（admin 可写）。

## Data / Model Impact

- 删除 `ai_summary_task.summary_output` / `knowledge_status` / `knowledge_error`（**待人工批准**）。
- 无新增表 / 列。

## API / Integration Impact

- 无新增端点；确认 Phase 1b 已下线的 `publish` / `backfill` / `repair` 无残留引用。

## Edge Cases

- 删除本地副本前若发现仍有读取依赖 → 中止并回退。
- 列删除前确认无代码引用（含前端与脚本）。

## Open Questions

- `knowledge_status` / `knowledge_error` 最终去留（保留重试态 vs 删除）。
- `worker_job` 终态保留期具体值。

## Acceptance Criteria

- [ ] 本地 md / 截图副本经人工确认后删除；删除前有只读备份与验证记录。
- [ ] 废弃列删除经人工批准并成功迁移；无代码 / 前端引用残留。
- [ ] 仅服务本地 md 的 helper 已移除。
- [ ] 删除总结时 `summary` 级联 `summary_segment` 且投递 `cos_cleanup`。
- [ ] `worker_job` 终态按保留期清理。
- [ ] `pnpm typecheck`、`pnpm build` 通过；owner docs 更新。
