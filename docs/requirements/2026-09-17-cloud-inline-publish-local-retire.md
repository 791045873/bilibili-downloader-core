# 需求：分析结果内联入库/入 COS，本地 md 与截图下线（Phase 1b）

> 来源：拆自 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（Phase 1b）
> Owner Doc：`docs/design/app-overview.md`、`docs/architecture/2026-07-06-video-analysis-baseline.md`
> 前置：Phase 1a 已落地（`docs/requirements/2026-09-17-cloud-read-path-db-render.md`，读取侧从 DB 渲染）
> 关联审计：`docs/audits/2026-09-17-requirement-reaudit-cloud-nas-and-phase1a.md`
> 保护区：无（不改部署 / auth；**不删除既有本地文件**——删除属 Phase 4 数据删除保护区）
> 状态：实现就绪（停止写本地 md/截图已由用户确认："不需要在本地再保有一份 MD 文件和原始截图"）

## Goal

分析完成后，把总结内容（`summary` + `summary_segment`）**内联**写入云 DB、截图直传 COS，使 `ai_summary_task.status=completed` 即代表**内容已完整入库**；同时停止写本地 md 与截图、移除 `/summary-files` 静态挂载，读取完全走 Phase 1a 的 DB 渲染。保留本地视频（NAS 唯一原始媒体）。

## In Scope

1. **内联发布**：分析成功后，在分析流程内写 `summary` + `summary_segment`（含 `screenshot_url`）到云 DB、上传截图到 COS；**内容入库成功才置 `completed`**（截图缺失不阻塞，见 Edge Cases）。
2. **段 ↔ 截图结构化映射（审计 B3）**：`AnalysisEngine` 对外输出 `segments[].screenshotFiles`；发布按结构映射上传，不再从 md 反解。
3. **`raw_response` / 错误分离（审计 H4）**：`raw_response` 只放模型 JSON；失败写 `error_message`；LLM 成功后的失败不得覆盖 `raw_response`。
4. **停止写本地 md 与截图**：分析不再产出对外 md 文件与本地截图副本；`summary_output` 不再写入（列保留待 Phase 4 清理）。
5. **移除 `/summary-files` 静态挂载**（`main.ts`）与相关重写 helper（`summary-dir.ts` 的 `rewriteMarkdownImageUrls` / `rewriteMarkdownImages` 等按裁剪范围处理）。
6. **下线独立发布 / 回填子系统**：`POST /api/summary-tasks/:id/publish`、`POST/GET /api/knowledge/backfill`；`knowledge_status` / `knowledge_error` 影子状态按计划裁剪（保留重试态由实现定）。
7. 更新 owner doc 与测试。

## Out Of Scope

- **删除既有本地 md / 截图**（Phase 4，数据删除保护区）。
- 作业化（`worker_job`）、项目拆分、用户系统、NAS/云互联（Phase 2/3）。
- 完整性检查判据与报告结构变更（单独需求）。
- `rebuild` → `screenshot_retry` 的语义收窄（另立需求；本切片只保证截图 URL 已入库）。

## Main User Flows

### AI 总结（内联）

1. 触发分析 → NAS 执行 LLM 分析 → 用本地高清视频截图。
2. 写 `summary` + `summary_segment`（含 `screenshot_url`）到云 DB；截图上传 COS。
3. 内容入库成功 → `ai_summary_task.status = completed`；截图上传失败 → 记录缺失（`screenshot_url` 为空），可后续重试。

### 查看总结

1. 云端走 Phase 1a 的 DB 渲染；图片为 COS URL。

## Business Rules

- **完成门槛 = 内容入库**：`completed` 要求 `summary` + `summary_segment` 完整写入；截图入 COS 不阻塞完成。
- **截图缺失可重试**：`screenshot_url` 允许为空；缺失可由 `screenshot_retry` 补齐（不在本切片实现）。
- **幂等**：重跑分析按 `(summary_id, seq)` upsert（删多余尾行；文本变更清向量——见讨论 Q10）。
- **不写本地**：不再产出对外 md / 本地截图副本。
- **错误不覆盖内容**：失败只写 `error_message`。

## Roles / Permissions

- 沿用现状（本切片不引入用户系统）。

## Data / Model Impact

- **无 schema 变更**。使用既有 `summary` / `summary_segment` / `ai_summary_task` 列。
- `summary_output` 停止写入（列保留，Phase 4 决定去留）。
- `knowledge_status` / `knowledge_error` 影子状态按计划裁剪。

## API / Integration Impact

- 移除 `POST /api/summary-tasks/:id/publish`、`POST/GET /api/knowledge/backfill`。
- 移除 `/summary-files/*` 静态挂载与前端引用（Phase 1a 已不再产生该链接）。
- 分析成功路径由"先 completed 再 fire-and-forget publish"改为"内容入库成功后 completed"。

## Edge Cases

- COS 未配置 / 上传失败：内容仍入库并置 `completed`，`screenshot_url` 为空；不阻塞完成。
- LLM 成功但 DB 写入失败：`status=failed`，`raw_response` 保留模型 JSON，`error_message` 记录原因。
- LLM 失败：`status=failed`，`raw_response` 为空，`error_message` 记录错误。
- 段数减少（重跑）：删除 `seq >= 新段数` 的多余行；文本变更行 `embedding = NULL` 后重算。
- 存量本地 md/截图：本切片不删除；读取已不依赖它们（Phase 1a）。

## Open Questions

- 无阻塞项。`knowledge_status` / `knowledge_error` 的具体裁剪方式实现时定。

## Acceptance Criteria

- [ ] 分析成功后，`summary` + `summary_segment` 已写入云 DB，且 `ai_summary_task.status=completed`。
- [ ] `completed` 记录在**无本地 md/截图**的环境下可被 Phase 1a 渲染接口正确返回。
- [ ] 截图上传失败时仍 `completed`，`screenshot_url` 为空；不因此置 `failed`。
- [ ] 失败路径不再把错误写入 `raw_response`；模型 JSON 在后续步骤失败时被保留。
- [ ] 分析不再写本地 md 与本地截图；`summary_output` 不再写入。
- [ ] `/summary-files` 挂载与 `publish` / `backfill` 端点已移除，前端无引用残留。
- [ ] 重跑按 `(summary_id, seq)` 原地更新并清理多余尾行与陈旧向量。
- [ ] `pnpm typecheck`、`pnpm build` 通过；数据层测试与相关纯函数单测通过；owner doc 更新。
