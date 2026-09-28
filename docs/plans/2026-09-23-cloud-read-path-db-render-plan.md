# 2026-09-23 云端/NAS Phase 1a — 总结读取侧改为从云 DB 渲染

> Plan Status: planned
> Last Reviewed: 2026-09-23
> Source: `docs/requirements/2026-09-17-cloud-read-path-db-render.md`
> Related: 上游 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（Phase 1a）；下游依赖本切片：Phase 1b `docs/requirements/2026-09-17-cloud-inline-publish-local-retire.md`
> Audit: required（非保护区：不改数据模型/不删数据/不改部署/不涉 auth；reviewer availability=none → 允许 cold-replay 代替）
> Testing: `docs/testing/2026/09-23-cloud-read-path-db-render-testing.md`

## Current Baseline

- 两端点均在 `packages/server/src/analysis/analysis-task.controller.ts` 的 `AnalysisTaskController`：
  - `GET /api/summary-tasks/:id/markdown`（`:186-207`）→ `getAiSummaryTaskById(id)`。
  - `GET /api/summary-tasks/by-resource/:bvid/:cid/markdown`（`:213-238`）→ `getAiSummaryTaskByResource(bvid,cid)`（`database.service.ts:929`）。
  - 共用私有 `renderSummaryMarkdown(record, logRef)`（`:240-272`）：当前**读本地文件**——`resolveSummaryOutputPath(record.summaryOutput, DOWNLOAD_ROOT)` → `readFile`（`node:fs/promises`，`:16 import`）→ `extractSummaryMeta` 剥 frontmatter → `rewriteMarkdownImageUrls(body, mdAbsPath, SUMMARY_BASE_DIR)` 重写为 `/summary-files/…`。
  - 现有错误码：400（id/资源非法）、404（记录不存在）、409（非 `completed`）、409（`!summaryOutput`）、404（`readFile` 失败）。
- 渲染函数 `generateMarkdown(input: DocumentInput): string`（`document-generator.ts:36-68`）：输出 frontmatter + `# {videoTitle}` + 每段 `## {title}`/`content`/`![{frameDescription}]({relativePath})` + `> {frameDescription}`；**不输出 timestamp**（`segments[].timestamp` 存在但不落文）。
- `extractSummaryMeta(content): { meta, body }`（`summary-dir.ts:87-131`）：解析 frontmatter `title/video_url/model/created_at` → `SummaryMeta{title?,videoUrl?,model?,createdAt?}`；`body` 为去 frontmatter 正文。
- 数据层现状（`database.service.ts`）：写侧 `upsertSummaryKnowledge`（`:1404-1469`）；读侧**无**"取 `summary` 头 + 按 `seq` 排序 segment 全字段"的方法——`getSummarySegmentsForEmbedding`（`:1488-1514`，仅 `seq/title/content/embedding*`）与 `searchKnowledgeSegments`（`:1531+`，跨库 top-k）均不满足渲染需要。
- `raw_response` 为 JSON 文本，含 `summary[]`（元素 `{title,content,timestamp,frameDescription}`，见 `analysis-engine.ts:420-441`/`normalizeSummaryItems:530`）；写侧 md frontmatter `created_at` 用 `new Date().toString()`——故 meta 必须从 DB 重算，不能信任 md 内文（支撑 Meta Decision）。
- 数据模型（`contract.prisma`，本切片**不改**）：
  - `Summary`（`:135-149`）：`videoTitle`(NOT NULL)、`videoUrl?`、`modelName?`、`rawResponse Jsonb`、`createdAt`；`@@unique([bvid,cid])`。
  - `SummarySegment`（`:151-167`）：`summaryId`、`seq`、`title`、`content`、`timestampSeconds?`、`frameDescription?`、`screenshotUrl?`；`@@unique([summaryId,seq])`。
  - `AiSummaryTask`（`:23-49`）：`title?`、`status`、`summaryOutput?`、`rawResponse?`、`modelName?`、`createdAt`、`lastCompletedAt?`（**无 videoUrl 列**）；`@@unique([bvid,cid])`。
- `SUMMARY_BASE_DIR` getter（`paths.service.ts:47`）与 `/summary-files` 静态挂载（`main.ts:21-40`，`SUMMARY_STATIC_PREFIX="/summary-files"`，`summary-dir.ts:14`）——本切片**保留**，不删除。
- 测试布局：数据层测试在 `packages/server/tests/database/*.test.ts`（vitest，需 `TEST_DATABASE_URL`，`global-setup.ts` 自动 `db init`）；相关有 `ai-summary-task.test.ts`、`summary-integrity.test.ts`、`knowledge.test.ts`。当前无 controller 层 E2E（项目 E2E=`none`）。
- 缺口：读取路径强依赖本地 md 文件与 `SUMMARY_BASE_DIR`，无法在"无本地媒体文件"的云端部署独立提供总结正文。

## Goals

- 两个 markdown 端点的**数据来源**由本地 md 文件改为**云 DB 渲染**（`summary`+`summary_segment`，回退 `ai_summary_task.raw_response`），响应结构 `{ content, meta }` 与请求参数不变。
- 渲染结果正文与现状模板一致（`generateMarkdown`），图片用 `summary_segment.screenshot_url`（COS 绝对 URL），不输出 timestamp、不含 frontmatter、不含 `/summary-files` 链接。
- 读取路径**不读盘**（不 `readFile`、不 join `DOWNLOAD_ROOT`），为 Phase 1b 云端化铺路。

## Non-Goals

- 删除 `/summary-files` 挂载或前端引用、停止写本地 md/截图、删除本地副本（Phase 1b/清理）。
- 内联发布、作业化（`worker_job`）、镜像拆分、用户系统、NAS/云互联。
- `rebuild` / `integrity-check` 语义变更。
- 任何 Prisma contract / migration 变更（**无 schema 变更**）。

## Infrastructure And Config Prereqs

- 无新增基础设施：不改 env / 端口 / CORS / 部署形态。
- 数据依赖：渲染主路径依赖既有 `summary`/`summary_segment` 数据（COS 图片 URL 已入库）；无该数据时按取值链回退 `raw_response`。
- 测试依赖：`TEST_DATABASE_URL`（pgvector/pg17 测试容器，见 `docs/context/project-context.md`）。
- 保护区：无（不涉数据删除/部署/auth）。reviewer availability=none → plan/closure 可用 cold-replay 自查并留证。

## Execution Plan

### Phase 1 - 数据层只读查询方法

Status: planned
Targets: `packages/server/src/database/database.service.ts`

- Item Types: `Add`
- Prereqs: 无

- [ ] `Add`: 新增只读方法 `getSummaryWithSegmentsByResource(bvid, cid)`，读取 `summary` 头字段 + 按 `seq ASC` 的 `summary_segment` 全渲染字段。无匹配 `summary` 行返回 `undefined`。
- [ ] `Add`: 返回类型（结构边界契约）：`{ videoTitle: string; videoUrl: string | null; modelName: string | null; createdAt: Date; segments: Array<{ seq: number; title: string; content: string; frameDescription: string | null; screenshotUrl: string | null }> }`。
- [ ] `Proof`: `pnpm typecheck`。

Exit Criteria:

- [ ] 方法经 Prisma 读取（不新增 raw SQL 除非既有查询模式要求），`summary` 存在/不存在两路返回正确。
- [ ] 未改动写侧方法与任何 schema。
- [ ] `docs/logs/` 记录本相位进展。

### Phase 2 - 渲染管线（DB → markdown）与 raw 回退

Status: planned
Targets: `packages/server/src/analysis/analysis-task.controller.ts`, `packages/server/src/analysis/document-generator.ts`（仅复用，如需导出纯函数则新增）

- Item Types: `Fix | Add | Decision`
- Prereqs: Phase 1

- [ ] `Decision`: 复用 `generateMarkdown` + `extractSummaryMeta` 组合而非新写模板——把 DB 行映射为 `DocumentInput`（`screenshot_url` 作为 `images[].relativePath` 传入；空则该段无图；`timestamp` 传空不影响输出），生成完整 md 后用 `extractSummaryMeta` 剥 frontmatter 得 `content`。理由：保证与现状正文模板逐字节一致，避免新增用户可见文本；备选（直接拼字符串）会引入模板漂移风险。
- [ ] `Add`: **抽出三个纯函数**（可独立单测的可测缝——因 `E2E=none`，这是 AC1/AC2/AC4 的唯一确定性证明路径；均不依赖 `this`/DB/fs）：
  - `buildSummaryMeta(summaryRow | null, task, bvid) → SummaryMeta`（实现下方 Meta 取值链）。
  - `renderSummaryFromDb(summaryRow, segments) → { content }`（DB 行 → `DocumentInput` → `generateMarkdown` → `extractSummaryMeta` 取 body；`screenshot_url` 作为图片 `relativePath`）。
  - `renderRawResponseMarkdown(rawResponse) → { content }`：解析 `raw_response` JSON 的 `summary[]` → 构造无图 `DocumentInput` → `generateMarkdown`。`raw_response` 为空 / 非合法 JSON / `summary` 缺失或空数组 → 抛 409（"该总结内容不可用"）。
- [ ] `Fix`: 重写 `renderSummaryMarkdown`（薄编排）：先 `getSummaryWithSegmentsByResource`；命中 → `renderSummaryFromDb`；未命中 `summary` 行 → 回退 `renderRawResponseMarkdown`；meta 一律经 `buildSummaryMeta`。移除 `readFile` / `resolveSummaryOutputPath` / `rewriteMarkdownImageUrls` 读盘分支。
- [ ] `Decision`: Meta 取值链（按需求 §Meta）：`title←summary.videoTitle ?? task.title`；`videoUrl←summary.videoUrl ?? https://www.bilibili.com/video/{bvid}`；`model←summary.modelName ?? task.modelName ?? ""`；`createdAt←task.lastCompletedAt ?? task.createdAt`（**不用** `summary.createdAt`）。理由：`summary.createdAt` 为首次发布时刻，重分析后过期。
- [ ] `Decision`: 漂移告警（需求 Business Rules §summary 权威 + Edge Cases §漂移）：`summary` 与 `raw_response` 同时存在且不一致时，以 `summary` 展示并 `logger.warn`（含 `bvid/cid`）记录一条**非阻塞**告警。判据用廉价信号（segment 数与 `raw_response.summary[]` 长度不等），不做正文逐字节 diff。理由：满足需求可观测性要求且低成本；备选（完全不检测）会漏掉需求明列的告警。
- [ ] `Fix`: 错误码调整（有意）：保留 400（非法 id/资源）、404（`ai_summary_task` 记录不存在）、409（非 `completed`）；**移除**"本地文件缺失→404"与"`!summaryOutput`→409"两分支，新增"内容不可用→409"。`summary` 行存在但 segment 为空 → 200（标题 + 空正文）。
- [ ] `Proof`: `pnpm typecheck`、`pnpm build`。

Exit Criteria:

- [ ] 两端点数据来源全部走 DB；请求参数、`{ content, meta }` 结构不变。
- [ ] `content` 不含 frontmatter、不含 `/summary-files` 链接；图片为 COS URL；无 `screenshotUrl` 段不输出图片；不输出 timestamp。
- [ ] 错误码逐条符合上表；"文件缺失 404"与"`summary_output` 空 409"确认为有意移除。
- [ ] 漂移时以 `summary` 展示且记录 warn（非阻塞）。
- [ ] `docs/logs/` 记录本相位进展。

### Phase 3 - 测试与验证

Status: planned
Targets: `packages/server/tests/database/*.test.ts`（新增/扩展一处），渲染纯函数单测，controller 单测

- Item Types: `Add | Proof`
- Prereqs: Phase 2

- [ ] `Add`: 数据层测试覆盖 `getSummaryWithSegmentsByResource`：有 summary+segment（按 seq 有序、字段完整）、无 summary 行（返回 undefined）。
- [ ] `Add`: 渲染纯函数单测：`renderSummaryFromDb`（含/不含图片段、空 segment→标题+空正文）、`renderRawResponseMarkdown`（合法 JSON → 纯文本；空/非 JSON/空数组 → 409）、`buildSummaryMeta` 四字段取值链（含 `createdAt` 来自 `lastCompletedAt`/`createdAt`；含 videoUrl 回退）。
- [ ] `Add`: controller 轻量单测——`new AnalysisTaskController(mockDb, mockPaths)`，覆盖 200 主路径（AC1）与完整错误矩阵 400/404/409（AC6），并断言漂移时走 `summary` + warn。
- [ ] `Add`: 不读盘断言——用 fs spy 断言渲染路径未调用 `readFile`（覆盖 summary 主路径与 raw 回退路径）。
- [ ] `Proof`: `pnpm --filter @bilibili-downloader/server test`（测试容器，`TEST_DATABASE_URL`）+ `pnpm typecheck` + `pnpm build`，全绿。

Exit Criteria:

- [ ] 需求 Acceptance Criteria 逐条被测试或人工核对覆盖（AC1/AC6 由 controller 单测覆盖）。
- [ ] 全部验证命令通过。
- [ ] `docs/logs/` 记录本相位进展。

### Phase 4 - 文档与闭合

Status: planned
Targets: `docs/design/app-overview.md`, `docs/context/codebase-map.md`, `docs/context/project-context.md`, `docs/backlog/README.md`, `docs/logs/`

- Item Types: `Add | Proof`
- Prereqs: Phase 1–3

- [ ] `Add`: 更新 `docs/design/app-overview.md`（需求点名 :36/:59/:88/:89/:107 相关行）：两端点读取来源改为 DB、错误码变化、`/summary-files` 保留但两端点不再产生其链接。
- [ ] `Add`: 更新 `codebase-map.md`（Server 行的 summary-tasks markdown 描述）、`docs/design/feature-inventory.md`（补“查看总结/markdown 渲染”条目、更新数据源）、`project-context.md`（Active work 推进 Phase 1a）、`backlog/README.md`（Phase 1a → in-progress/done，解除 Phase 1b 的"依赖 Phase 1a"阻塞）；在 `docs/requirements/2026-08-17-ai-summary-view-markdown.md` 头部加“读路径已被 Phase 1a 取代”指针（需人工确认）。
- [ ] `Proof`: 独立 closure audit（reviewer=none → cold-replay 自查，留证于本计划 Closure 段或 `docs/audits/`）。

Exit Criteria:

- [ ] owner doc / codebase-map / project-context / backlog / log 全部更新且互相一致。
- [ ] testing 文档每条方向确认通过或明确裁决 out of scope。
- [ ] closure gates 全绿。

## Plan Audit

- Status: passed（with required fixes applied）
- Reviewer / Agent: 独立子代理 cold-replay 代理（fresh context，无本计划撰写记忆；reviewer availability=none 下的代替，非保护区允许）
- Evidence: `docs/audits/2026-09-23-plan-audit-cloud-read-path-db-render.md`（Verdict: PASS-WITH-REQUIRED-FIXES；baseline 全部 file:line 逐条 CONFIRMED）。三条 should-fix 已在本计划落实：①漂移告警成为 Phase 2 显式 Decision + Exit + 测试方向；②Phase 2 抽出 `buildSummaryMeta`/`renderSummaryFromDb`/`renderRawResponseMarkdown` 三个可测纯函数缝；③Phase 3 新增 controller 轻量单测覆盖 AC1（200）与 AC6（400/404/409 矩阵）。无 blocker。

## Closure Gates

- [ ] in-scope behavior is complete
- [ ] relevant docs are aligned（app-overview / codebase-map / project-context / backlog / log）
- [ ] verification has run（`pnpm --filter @bilibili-downloader/server test`、`pnpm typecheck`、`pnpm build`）
- [ ] corresponding `docs/testing/` document exists 且每条方向确认通过或裁决 out of scope
- [ ] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed（cold-replay 代理留证）before implementation
- [ ] micro-plan exception not applicable（跨两端点 API 行为 + 错误码变更 + 新数据层方法）
- [ ] text consistency verified：top status / phase status / exit criteria / closure gates / testing doc / log 一致
- [ ] closure audit was independent（或 cold-replay 代理留证）
- [ ] closure evidence exists in files

## Deferred But Adjudicated

### 删除 `/summary-files` 挂载与前端引用

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 本切片明确不改部署形态、保留静态挂载；删除属 Phase 1b/清理范畴。
- Successor Required: `yes`（Phase 1b `docs/requirements/2026-09-17-cloud-inline-publish-local-retire.md`）

## Closure

Status Note: 未闭合——计划已过 plan audit（cold-replay 代理），尚未实施。

Closure Audit Evidence:

- Reviewer / Agent: 待回填
- Evidence: 待回填

Follow-up:

- Phase 1b 起停止写本地 md/截图并下线 `/summary-files`（独立需求）。
