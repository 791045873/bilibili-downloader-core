# 需求：总结读取侧改为从云 DB 渲染（Phase 1a）

> 来源：拆自 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（Phase 1a）
> Owner Doc：`docs/design/app-overview.md`
> 关联分析：`docs/analysis/2026-09-17-cloud-nas-split-feasibility.md`；审计：`docs/audits/2026-09-17-requirement-reaudit-cloud-nas-and-phase1a.md`
> 保护区：无（不改数据模型、不删数据、不改部署、不涉 auth）。需 plan audit（reviewer=none 时非保护区可用 cold-replay）。
> 状态：实现就绪（本切片无阻塞性开放问题）

## Goal

让"查看 AI 总结"的读取路径不再依赖本地 md 文件，改为从云 DB 渲染，使读取侧可在没有本地媒体文件的部署中独立提供总结正文；为后续云端化（Phase 1b 起）铺路。本切片不改变部署形态。

## In Scope

- `GET /api/summary-tasks/:id/markdown` 与 `GET /api/summary-tasks/by-resource/:bvid/:cid/markdown` 改为**从 DB 渲染**：
  - 优先 `summary` + `summary_segment`；
  - 无 `summary` 行（或不可用）时回退 `ai_summary_task.raw_response`。
- **新增只读方法** `getSummaryWithSegmentsByResource(bvid, cid)`（或等价）读取 `summary` + 按 `seq` 排序的 `summary_segment`；**无 schema 变更**。
- 响应结构保持 `{ content, meta }`；`meta` 按下方取值链重建。
- 更新 owner doc `docs/design/app-overview.md`（:36、:59、:88、:89、:107 相关行）并补测试。
- 保留 `/summary-files` 静态挂载（本切片不删除）。

## Rendering Spec（渲染规格，须与现状一致）

- **输出结构**：复用 `generateMarkdown`（`document-generator.ts:36-67`）生成完整 md，再用 `extractSummaryMeta`（`summary-dir.ts:87-132`）剥离 frontmatter——`content` 为正文（**不含 frontmatter**），`meta` 为解析出的元数据。
- **正文模板**：`# {videoTitle}`；每段 `## {title}` + `{content}`；有图时 `![{frameDescription}]({url})` + `> {frameDescription}`。
- **图片 URL**：把 `summary_segment.screenshot_url`（COS 绝对 URL）作为 `generateMarkdown` 的图片 `relativePath` 传入；`screenshot_url` 为空则该段不输出图片。
- **不渲染 timestamp**：现状 `generateMarkdown` 不输出时间戳，DB 渲染亦不输出（避免新增用户可见文本）。
- **分段顺序**：按 `summary_segment.seq` 升序。

## Meta 取值链

- `title` ← `summary.video_title` ?? `ai_summary_task.title`
- `videoUrl` ← `summary.video_url` ?? `https://www.bilibili.com/video/{bvid}`（`ai_summary_task` 无 videoUrl 列）
- `model` ← `summary.model_name` ?? `ai_summary_task.model_name` ?? `""`
- `createdAt` ← `ai_summary_task.last_completed_at` ?? `ai_summary_task.created_at`（ISO 字符串）。**不用 `summary.created_at`**（其为首次发布时刻，重分析后会过期）。

## Fallback（无可用 `summary`）

- 新增纯函数 `renderRawResponseMarkdown(rawResponse, meta)`：解析 JSON 的 `summary[]`，构造 `DocumentInput`（无图）后调 `generateMarkdown`。
- 判定与响应：`raw_response` 为空 / 非合法 JSON / `summary` 缺失或空数组 → 统一返回 **409**（"该总结内容不可用"）。
- `summary` 行存在但 `summary_segment` 为空 → 渲染标题 + 空正文（200，不报错）。

## Out Of Scope

- 删除 `/summary-files` 挂载或前端引用（Phase 1b/清理）。
- 停止写入本地 md / 截图、删除本地副本。
- 内联发布、作业化（`worker_job`）、镜像拆分、用户系统、NAS/云互联。
- `rebuild` / `integrity-check` 语义变更。
- 任何 Prisma contract / migration 变更。

## Main User Flows

1. 用户在总结列表或 QA 来源点"查看总结"。
2. 云端按 id 或 `(bvid,cid)` 查 DB 并校验 `completed`。
3. 服务端渲染正文（DB 内容 + COS 图片 URL）返回 `{ content, meta }`。
4. 前端渲染；图片经 COS URL 加载。

## Business Rules

- **渲染优先级**：`summary` + `summary_segment` → 回退 `ai_summary_task.raw_response`。
- **summary 权威**：两者同时存在时以 `summary` 为准；若与 `ai_summary_task.raw_response` 不一致（漂移），以 `summary` 展示并记录告警（不阻塞）。
- **可读性**：仅 `completed` 可读（维持现状 409）。
- **错误码变化（有意）**：移除"本地文件缺失 → 404"分支；`summary_output` 为空不再单独触发 409（不再使用该列判断）。
- **不 join 媒体路径**：只读 DB + COS，不解析 `DOWNLOAD_ROOT`。

## Roles / Permissions

- 沿用现状（本切片不引入用户系统）。

## Data / Model Impact

- **无 schema 变更**。需新增一个 `summary` + `summary_segment` 的只读查询方法（现仅有写入与向量 raw SQL 查询）。

## API / Integration Impact

- 两个 markdown 端点的**数据来源**由本地文件改为 DB；请求参数、响应结构不变；错误码见 Business Rules 的有意变化。
- 不再依赖 `PathsService.SUMMARY_BASE_DIR` 读取 md；`/summary-files` 挂载保留但这两个端点不再产生其链接。

## Edge Cases

- `completed` 但无 `summary` 行（历史 / 未发布）→ 回退 `raw_response` 渲染纯文本、无图。
- `raw_response` 为空 / 非合法 JSON / `summary` 空数组 → 409。
- `summary` 存在、`summary_segment` 为空 → 200，标题 + 空正文。
- `frameDescription` / `screenshot_url` 为 null → 该段无图片说明 / 无图。
- `summary` 与 `ai_summary_task.raw_response` 漂移 → 以 `summary` 为准并记录。
- 存量 `summary_output` 本地路径不再被读取，绝对值 / 相对值均不影响本切片。

## Open Questions

- 无阻塞项。

## Acceptance Criteria

- [ ] DB 有 `summary`+segment 时，移除本地 summary 目录后两端点仍返回 200，且 `content` 来自 DB。
- [ ] `content` 不含 frontmatter、不含 `/summary-files` 链接；图片为 COS URL；无 `screenshot_url` 的段不输出图片。
- [ ] 无 `summary` 行 + `raw_response` 合法 → 200 纯文本；`raw_response` 空 / 非 JSON → 409。
- [ ] `meta` 四字段按取值链正确（含 `createdAt` 来自 `last_completed_at`/`created_at`）。
- [ ] 渲染路径不读盘：单测用 fs spy 断言 `readFile` 未被调用（覆盖 summary 路径与 raw 回退路径）。
- [ ] 错误码逐条：非法 id→400、记录不存在→404、非 `completed`→409、内容不可用→409；明确"文件缺失 404"与"`summary_output` 空 409"为有意移除。
- [ ] 测试形式：新增 DB 读取方法的数据层测试 + 渲染纯函数单测（项目 E2E 为 `none`，不新增 controller E2E）。
- [ ] `pnpm typecheck`、`pnpm build` 通过；owner doc 相关行更新。
