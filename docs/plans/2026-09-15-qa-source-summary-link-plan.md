# 2026-09-15 QA 回答来源视频增加"AI 总结"整页链接

> Plan Status: in progress
> Last Reviewed: 2026-09-15
> Source: `docs/requirements/2026-09-15-qa-source-summary-link.md`
> Related: `docs/requirements/2026-09-09-rag-chat-service.md`（QA 功能基线）、`docs/requirements/2026-08-17-ai-summary-view-markdown.md`（总结 Markdown 查看基线）
> Audit: required
> Testing: none（读-渲染型小改动，按 Verification Baseline 以 typecheck/build + 手工路径核对）

## Current Baseline

- QA 来源渲染：`packages/frontend/src/pages/QaChat.tsx:579-600`，`ChatBubble` 遍历 `message.replySources`，每条渲染 B 站链接（`videoLink`，`QaChat.tsx:57-61`）与 `tipTitle`，无总结入口。
- 来源类型：`packages/server/src/chat/chat.types.ts:17-23` 与 `packages/frontend/src/types/index.ts:287-293`，字段为 `videoTitle/videoUrl/timestampSeconds/tipTitle/screenshotUrl`；落库 `message.reply_sources` (jsonb)，见 `database.service.ts:270-276`、`insertMessage`。
- 来源组装：`packages/server/src/chat/chat.service.ts:130-133` 取被引 `ChatHit`，`buildReplyPayload`（`chat.service.ts:321-351`）拼装 images/sources。
- 检索结果：`database.service.ts:1529-1568 searchKnowledgeSegments` 的 SELECT 仅取 `s.video_title/s.video_url`，未取 `s.bvid/s.cid`（`summary` 表两列均存在，见 `contract.d.ts` Summary 模型）。
- 总结定位与查看：`database.service.ts:927-935 getAiSummaryTaskByResource(bvid,cid)` 已存在；`analysis-task.controller.ts:184-230 getAiSummaryTaskMarkdown(id)` 读 `summary_output`、`extractSummaryMeta` + `rewriteMarkdownImageUrls`（`summary-dir.ts`）。`ai_summary_task` 对 `(bvid,cid)` 有唯一约束。
- 前端总结渲染基线：`AiSummaryTasks.tsx:343-360 openSummary` 调 `getAiSummaryTaskMarkdown(id)`，`855-910` 用 `ReactMarkdown` + antd `Image` 渲染（含元数据条）；无独立总结详情路由，`router.tsx` 仅列表页。
- 缺口：来源数据未透传 `bvid/cid`；无按视频资源取总结的接口；无总结整页路由与页面。

## Goals

- 每条含视频标识的 QA 来源条目新增"AI 总结"链接，跳转到独立整页路由展示该视频完整 AI 总结。
- 保持来源去重粒度（按 source 条目）、三段式结构、B 站链接与 QA 既有行为不变。
- 总结不存在/未完成/文件缺失时详情页只报错，不降级。
- 不改动数据库 schema、Prisma contract、鉴权、部署。

## Non-Goals

- 不按视频聚合来源条目。
- 不提供缺失总结的兜底内容或自动跳转。
- 不改动 AI 总结任务页列表/弹窗与既有 `/api/summary-tasks/:id/markdown` 行为。
- 不回填历史消息的 `reply_sources`。

## Infrastructure And Config Prereqs

- No infra prereqs beyond existing baseline.
- 不新增依赖：前端复用 react-router、react-markdown、remark-gfm、antd。
- 无数据迁移、无回滚脚本需求。
- 保护区域：本次不涉及 auth/权限、数据删除、支付、部署，均不改动。

## Execution Plan

### Phase 1 - 后端来源数据透传

Status: pending
Targets: `packages/server/src/database/database.service.ts`, `packages/server/src/chat/chat.types.ts`, `packages/server/src/chat/chat.service.ts`

- Item Types: `Add`
- Prereqs: none

- [x] `Add`: `searchKnowledgeSegments` 查询补充 `s.bvid AS "bvid"`、`s.cid AS "cid"` 并纳入返回结构与类型。
- [x] `Add`: `ChatHit` 增加 `bvid: string`、`cid: number`。
- [x] `Add`: `ChatReplySource` 增加 `bvid: string`、`cid: number`；`buildReplyPayload` 在每条来源注脚中填充。
- [x] `Proof`: `pnpm typecheck`。

Exit Criteria:

- [ ] 检索返回带 `bvid/cid`；新回答 `reply.sources` 每条含 `bvid/cid`。
- [ ] 现有 `images`/`sources` 其余字段与去重行为不变。
- [ ] `docs/logs/` 记录本相位进展。

### Phase 2 - 后端按视频资源取完整总结接口

Status: pending
Targets: `packages/server/src/analysis/analysis-task.controller.ts`

- Item Types: `Add | Decision`
- Prereqs: none

- [x] `Decision`: 新增资源级接口 `GET /api/summary-tasks/by-resource/:bvid/:cid/markdown`（而非让前端先查任务 id 再二次请求）。选择理由：QA 来源只有 `bvid/cid`，一次性返回 `{ content, meta }` 减少往返且与现有返回结构一致。备选：返回 `{ id }` 由前端再调按 id 接口（多一次往返、契约更碎）。残余风险：需与 `/summary-tasks/:id/markdown` 的失败语义保持一致，避免两套行为漂移。
- [x] `Add`: 抽取按 `AiSummaryTaskRecord` 生成 `{ content, meta }` 的私有方法，供按 id 与按资源两个路由复用。
- [x] `Add`: 新增按资源路由：`getAiSummaryTaskByResource` 定位记录；无记录 404、非 completed 409、`summary_output` 为空 409、md 文件缺失 404、`cid` 非正整数或 `bvid` 为空 400。
- [ ] `Proof`: `pnpm typecheck`；用 curl 核对 200/404/409 分支（需运行实例与库）。

Exit Criteria:

- [ ] 按资源接口返回与按 id 接口一致的 `{ content, meta }`。
- [ ] 失败语义与需求一致，且按 id 接口行为不回归。
- [ ] `docs/logs/` 记录本相位进展。

### Phase 3 - 前端来源链接与整页总结详情

Status: pending
Targets: `packages/frontend/src/types/index.ts`, `packages/frontend/src/api/index.ts`, `packages/frontend/src/pages/QaChat.tsx`, `packages/frontend/src/pages/SummaryDetail.tsx`, `packages/frontend/src/router.tsx`

- Item Types: `Add | Decision`
- Prereqs: Phase 1, Phase 2

- [x] `Decision`: 来源条目新增字段在前端类型置为可选（`bvid?: string; cid?: number`），链接以"两者均有值"为渲染条件。选择理由：历史消息 jsonb 无该字段，可选类型如实反映运行时；避免为回填历史数据引入迁移。备选：类型置必填（会与历史数据不符）。
- [x] `Decision`: "AI 总结"链接采用应用内路由跳转（同标签页），目标 `/summary/:bvid/:cid`。选择理由：需求为"跳转到新页面（整页）"，SPA 内路由即整页视图且可刷新/直达。备选：`target="_blank"` 新标签页（与 B 站外链一致，但非"应用内整页"）。残余风险：从 QA 页跳走后返回需依赖浏览器后退（详情页提供返回入口）。
- [x] `Add`: 前端 `ChatReplySource` 增加可选 `bvid/cid`；新增 `getSummaryMarkdownByResource(bvid, cid)` API。
- [x] `Add`: `QaChat.tsx` 来源条目在既有内容后追加"AI 总结"链接（有标识时渲染）。
- [x] `Add`: 新增 `SummaryDetail.tsx` 整页组件：读取路由参数、请求总结、复用 `md-preview` + `ReactMarkdown` + antd `Image` 渲染正文与元数据条；加载态/错误态（仅错误信息 + 返回）。
- [x] `Add`: `router.tsx` 新增 `summary/:bvid/:cid` 懒加载路由。
- [x] `Proof`: `pnpm typecheck`、`pnpm build`。

Exit Criteria:

- [ ] 新回答来源条目均可点击进入整页总结；错误资源显示错误而非兜底。
- [ ] 历史消息来源不渲染链接且不报错。
- [ ] QA 页与 `/summary-tasks` 现有行为无回归。
- [ ] `docs/logs/` 记录本相位进展。

### Phase 4 - 验证、文档与闭合

Status: pending
Targets: `docs/design/app-overview.md`, `docs/context/codebase-map.md`, `docs/context/project-context.md`, `docs/backlog/README.md`, `docs/logs/`

- Item Types: `Proof | Add`
- Prereqs: Phase 1–3

- [x] `Proof`: 执行 `pnpm typecheck`、`pnpm build` 并记录输出。
- [ ] `Proof`: 手工核对：QA 回答来源出现链接 → 点击进入详情 → 正常/错误分支；历史消息无链接。
- [x] `Add`: 更新 `docs/design/app-overview.md`（QA 来源区与新增接口、路由）。
- [x] `Add`: 更新 `docs/context/codebase-map.md`（Frontend/Server 行注记与 Last Verified）。
- [x] `Add`: 更新 `docs/context/project-context.md`（active requirement/plan 回填）与 `docs/backlog/README.md`。
- [x] `Add`: 写入 `docs/logs/` 聚合日志（含验证命令与证据）。
- [ ] `Proof`: 独立 closure audit；本计划非保护区域，若独立 reviewer 不可得，按政策以"与执行期上下文隔离的 cold-replay"自检并记录限制。

Exit Criteria:

- [ ] 需求 Acceptance Criteria 全部满足或有明确证据。
- [ ] owner doc / codebase-map / project-context / backlog / log 全部更新。
- [ ] `pnpm typecheck`、`pnpm build` 通过且有记录。
- [ ] closure audit 完成或按政策记录限制。

## Plan Audit

- Status: passed
- Reviewer / Agent: cold-replay self-review（reviewer availability = none；本计划非保护区域、非高风险，按 `docs/context/ai-autonomy-policy.md` 政策执行）
- Evidence: `docs/audits/2026-09-15-plan-audit-qa-source-summary-link.md`
- Post-audit refinement: 审计 3 项实现注意项（N1 `cid` 数值转换、N2 懒加载导出约定、N3 markdown 方法抽取保持原语义）已并入实现，无需修订后重审。

## Closure Gates

- [x] in-scope behavior is complete（代码层面完成）
- [x] relevant docs are aligned
- [ ] verification has run（`pnpm typecheck`、`pnpm build` 已通过；运行级手工路径核对待执行）
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan exception not applicable（跨前后端多文件、含新接口与路由，须审计）
- [x] text consistency verified: status, phases, gates, log all agree
- [ ] closure audit was independent（或按政策记录限制）
- [ ] closure evidence exists in files

## Implementation Status (2026-09-15)

代码已落地，静态验证通过；**运行级手工路径核对未执行**，故计划保持 `in progress`、退出条件未全部勾选，closure 门禁保持开放。

已落地：来源检索/类型/拼装透传 `bvid/cid`；`GET /api/summary-tasks/by-resource/:bvid/:cid/markdown` 与按 id 路由共用读取逻辑；前端来源"AI 总结"链接 + `/summary/:bvid/:cid` 整页视图；owner doc/codebase-map/project-context/backlog/log 已更新。

待执行（阻断闭合）：手工路径核对（正常总结 / 无记录 404 / 未完成 409 / 文件缺失 404 / 历史消息无链接）与 closure audit。

静态验证证据：`pnpm typecheck` 全包通过；`pnpm build` 全包通过（frontend `vite build` 3410 modules，含 `SummaryDetail` chunk）。

## Closure

Status Note: 未闭合。实现与静态验证完成，运行级手工核对与 closure audit 待执行。

Closure Audit Evidence:

- Reviewer / Agent: 待回填（优先独立 subagent；若不可得，按政策以与执行期上下文隔离的 cold-replay 自检并记录限制）
- Evidence: 待回填

Follow-up:

- 手工路径核对后回填各相位 `Proof` 与退出条件。
