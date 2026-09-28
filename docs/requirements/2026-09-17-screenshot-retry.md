# 需求：重试截图（rebuild → screenshot_retry，作业化）

> 来源：拆自 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（Q1 截图重试 / API `rebuild` 收窄 / 遗留补全 2026-09-23）
> Owner Doc：`docs/design/app-overview.md`、`docs/architecture/2026-07-06-video-analysis-baseline.md`
> 前置：Phase 1b（`screenshot_url` 入 DB、截图入 COS）、Phase 2（`screenshot_retry` 作业化）
> 关联：截图源顺序见讨论 Business Rules；既有 `docs/requirements/2026-07-07-screenshot-source-fallback-3a.md` / `-3b.md`
> 保护区：无。需 plan audit（reviewer=none 可 cold-replay）。
> 状态：实现就绪（依赖 Phase 1b / 2）

## Goal

把 `POST /api/summary-tasks/:id/rebuild` 的语义由"重建总结（含 md / 截图）"**收窄为纯"重试截图"**：从 NAS 本地视频按已存 `timestampSeconds` 重新截图、上传 COS、回写 `summary_segment.screenshot_url`，**不重跑分析、不重调 LLM**。作业化（`screenshot_retry`），支持批量补齐缺失截图。

## In Scope

- **触发**：云端校验前置（记录存在、`completed`、`raw_response` 非空）→ 写 `screenshot_retry` 作业（单条，或批量：针对 `screenshot_url` 为空的段）。
- **执行（NAS worker）**：读 `summary_segment.timestampSeconds` + 本地视频 → 截图 → 上传 COS → 回写 `screenshot_url`。**不触碰 `summary` 文本 / 向量、不重跑分析 / LLM。**
- **截图源顺序**（与分析截图一致，承接讨论 Business Rule）：本地已下载高清优先 → 缺失时 NAS 下载高清 → 仍不可得远端流截图兜底；降级须显式标记。与既有 3a/3b 兜底需求及 Phase 3 一致。
- **API 收窄**：`/rebuild` 收窄为重试截图语义（是否改名 `/screenshot-retry` 见 Open Questions，须保证前端兼容）；触发 + status 作业化（写作业 + 轮询 DB）。
- **幂等**：同段重截覆盖同一 COS key；重复投递由 `dedup_key` 去重。

## Out Of Scope

- 重跑分析 / LLM（由 `retrigger` 承担）。
- 视频缺失的下载补齐（由下载作业承担）。
- 完整性判据与报告（见 `docs/requirements/2026-09-17-integrity-check-rescope.md`）。

## Business Rules

- **不改内容**：仅更新 `screenshot_url`，不动 `summary` 文本 / 向量。
- **不阻塞完成**：`screenshot_url` 可为空；重试为补齐手段，不影响 `completed`。
- **降级显式标记**：截图源逐级降级须在结果 / 日志标注原因。

## Data / Model Impact

- **无 schema 变更**：仅更新 `summary_segment.screenshot_url`。

## API / Integration Impact

- `POST /api/summary-tasks/:id/rebuild` 语义收窄为 `screenshot_retry`；触发 + status 改为作业投递 + 轮询 DB。
- 与 Phase 1b（内联发布已写 `screenshot_url`）、Phase 2（作业机制）衔接。

## Edge Cases

- 本地视频缺失 → 该段截图跳过、记录（供完整性检查 `videoMissing`），并可触发下载作业；不使整作业失败。
- `timestampSeconds` 为空 → 该段无法重截，跳过并记录。
- COS 未配置 / 上传失败 → `screenshot_url` 保持空，可再次重试。
- 批量：仅处理 `screenshot_url` 为空的段（幂等，不重复上传已有截图）。

## Open Questions

- `/rebuild` 保留原路径并收窄语义，还是新增 `/screenshot-retry` 并弃用 `/rebuild`（实现时定，须保证前端兼容）。

## Acceptance Criteria

- [ ] `screenshot_retry` 作业：从本地视频 + 已存 `timestampSeconds` 重截、传 COS、回写 `screenshot_url`；不重跑分析 / LLM。
- [ ] 支持批量补齐 `screenshot_url` 为空的段；幂等。
- [ ] 截图源按"本地高清 → NAS 下载 → 远端兜底"顺序，降级显式标记。
- [ ] 触发 + status 走作业 + DB 轮询（与 Phase 2 一致）。
- [ ] 本地视频缺失 / `timestamp` 缺失 / COS 失败 均安全跳过并可重试，不破坏内容。
- [ ] `pnpm typecheck`、`pnpm build` 通过；截图纯函数与数据层测试通过；owner doc 更新。
