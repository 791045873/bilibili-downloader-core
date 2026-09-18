# 需求：总结读取侧改为从云 DB 渲染（Phase 1a）

> 来源：拆自 `docs/requirements/2026-09-17-cloud-nas-responsibility-split.md`（Phase 1a）
> Owner Doc：`docs/design/app-overview.md`
> 关联分析：`docs/analysis/2026-09-17-cloud-nas-split-feasibility.md`；审计：`docs/audits/2026-09-17-document-audit-cloud-nas-responsibility-split.md`
> 保护区：无（不改数据模型、不删数据、不改部署、不涉 auth）。需 plan audit（reviewer=none 时非保护区可用 cold-replay）。
> 状态：实现就绪（本切片无阻塞性开放问题）

## Goal

让"查看 AI 总结"的读取路径不再依赖 NAS 上的本地 md 文件，改为从云 DB 渲染，使任何无 NAS 文件系统访问的部署都能独立提供总结正文；为后续云端化（Phase 1b 起）铺路。

## In Scope

- `GET /api/summary-tasks/:id/markdown` 与 `GET /api/summary-tasks/by-resource/:bvid/:cid/markdown` 改为**从 DB 渲染**：
  - 首选 `summary` + `summary_segment`（含 `screenshot_url`）组装 md；
  - 无 `summary` 行时回退 `ai_summary_task.raw_response`，用纯函数 `generateMarkdown` 渲染（纯文本、无图）。
- 图片链接使用 `summary_segment.screenshot_url`（COS）；缺失则不输出图片；不再重写为 `/summary-files/...`。
- 响应结构保持 `{ content, meta }` 不变；`meta`（title/videoUrl/model/createdAt）由 DB 字段重建（`createdAt` 用 DB 时间近似）。
- 更新 owner doc `docs/design/app-overview.md` 对应行为描述；补数据层/接口测试。
- 保留 `/summary-files` 静态挂载（本切片不删除）。

## Out Of Scope

- 删除 `/summary-files` 挂载或前端引用（留待 Phase 1b/清理）。
- 停止写入本地 md / 截图、删除本地副本。
- 内联发布、作业化（`worker_job`）、镜像拆分、用户系统、NAS/云互联。
- `rebuild` / `integrity-check` 语义变更。
- 任何 Prisma contract / migration 变更。

## Main User Flows

### 查看总结正文

1. 用户在总结列表或 QA 来源点"查看总结"。
2. 云端按 id 或 `(bvid,cid)` 查 DB。
3. 服务端渲染 md 正文（DB 内容 + COS 图片 URL）并返回 `{ content, meta }`。
4. 前端渲染；图片经 COS URL 加载。

## Business Rules

- **渲染优先级**：`summary` + `summary_segment` → 回退 `ai_summary_task.raw_response`（`generateMarkdown`）。
- **可读性**：仅 `completed` 可读（维持现状 409）；不再因 `summary_output` 指向的本地文件缺失而 404。
- **图片**：只用 `screenshot_url`（COS），不 join 本地媒体路径，不输出 `/summary-files` 链接。
- **meta 重建**：title/videoUrl/model 取自 `summary`（或 `ai_summary_task`），createdAt 用 DB 时间近似。
- **不改数据**：本切片只读 DB，不新增/删除行。

## Roles / Permissions

- 沿用现状（本切片不引入用户系统）；读取仍按现有访问方式。

## Data / Model Impact

- 无。仅使用既有 `summary` / `summary_segment` / `ai_summary_task` 列。

## API / Integration Impact

- 两个 markdown 端点的**数据来源**由本地文件改为 DB；请求参数、响应结构、错误码语义（409/404/400）保持不变。
- 不再依赖 `PathsService.SUMMARY_BASE_DIR` 读取 md；`/summary-files` 挂载保留但这两个端点不再产生其链接。

## Edge Cases

- `completed` 但无 `summary` 行（历史 / 未发布）→ 回退 `raw_response` 渲染纯文本、无图。
- `raw_response` 为空 → 视为无内容（返回与"无输出文档"一致的错误语义，实现时定 409）。
- `summary` 存在但 `summary_segment` 为空 → 渲染标题 + 空正文（不报错）。
- 部分段 `screenshot_url` 为空 → 该段不输出图片。
- `raw_response` 非合法 JSON（历史异常数据）→ 按无内容处理（不抛 500）。
- 存量 `summary_output` 本地路径不再被读取，绝对值 / 相对值均不影响本切片。

## Open Questions

- 无阻塞项。`raw_response` 非合法 JSON 的精确响应码（409 vs 空正文）实现时定，不影响行为契约。

## Acceptance Criteria

- [ ] 在**无 NAS 文件系统**的部署下，两个 markdown 端点均能返回正确 `content` 与 `meta`。
- [ ] 已发布总结的图片为 COS URL；无 `screenshot_url` 的段不输出图片。
- [ ] `completed` 但无 `summary` 行的记录，回退 `raw_response` 返回文本。
- [ ] 端点不再读取本地 md 文件（可通过移除本地 summary 目录验证不回归 404）。
- [ ] 请求参数、响应结构、错误码与现状兼容；前端零改动。
- [ ] `pnpm typecheck`、`pnpm build`、数据层测试通过；owner doc 更新。
