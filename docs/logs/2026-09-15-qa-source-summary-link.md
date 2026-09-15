# 2026-09-15 QA 来源视频"AI 总结"整页链接 — 实施日志

- 需求：`docs/requirements/2026-09-15-qa-source-summary-link.md`
- 计划：`docs/plans/2026-09-15-qa-source-summary-link-plan.md`（`Plan Status: in progress`）
- 计划审计：`docs/audits/2026-09-15-plan-audit-qa-source-summary-link.md`（cold-replay，reviewer availability = none）

## 变更文件

- `packages/server/src/database/database.service.ts`：`searchKnowledgeSegments` SELECT 增取 `s.bvid`/`s.cid`，映射 `cid: Number(row.cid)`（pg int8 返回字符串）；返回类型补 `bvid/cid`。该结果同时被 `GET /api/knowledge/search` 直接返回（附加字段）。
- `packages/server/src/chat/chat.types.ts`：`ChatHit`、`ChatReplySource` 增加 `bvid/cid`。
- `packages/server/src/chat/chat.service.ts`：`buildReplyPayload` 在每条来源注脚填充 `bvid/cid`（随 `message.reply_sources` jsonb 持久化）。
- `packages/server/src/analysis/analysis-task.controller.ts`：抽取私有 `renderSummaryMarkdown(record, logRef)` 复用读取/剥离 frontmatter/重写图片逻辑；新增 `GET /api/summary-tasks/by-resource/:bvid/:cid/markdown`（400/404/409 分支，不做降级）；按 id 的 `GET /api/summary-tasks/:id/markdown` 行为不变。
- `packages/frontend/src/types/index.ts`：`ChatReplySource` 增加可选 `bvid?/cid?`（历史消息 jsonb 可能缺失）。
- `packages/frontend/src/api/index.ts`：新增 `getSummaryMarkdownByResource(bvid, cid)`。
- `packages/frontend/src/pages/QaChat.tsx`：来源条目追加"AI 总结"整页链接（有 `bvid` 且 `cid != null` 时渲染，`react-router` `Link`）。
- `packages/frontend/src/pages/SummaryDetail.tsx`：新增整页总结视图（元数据条 + `ReactMarkdown` + antd `Image`；加载态/错误 `Result`，仅报错不兜底）。
- `packages/frontend/src/router.tsx`：新增 `summary/:bvid/:cid` 懒加载路由。

## 决策记录

- 来源去重沿用现状（按 source 条目，键 `videoUrl|timestampSeconds|title`），不按视频聚合（用户 2026-09-15 确认）。
- 总结口径为 `ai_summary_task.summary_output` 指向的完整总结 Markdown（产品语义 AI 总结），非知识库 `raw_response` 另行渲染（用户确认）。
- 链接为应用内同标签页整页路由；缺失资源由详情页报错（用户确认不做降级）。

## 验证

- `pnpm typecheck`：通过（core / bilibili-api-sdk / frontend / adapters / server 全包）。
- `pnpm build`：通过（frontend `vite build` 3410 modules，含新增 `SummaryDetail` chunk；其余包 tsc/nest build 通过）。
- 未执行：运行级手工核对（正常总结 / 无记录 404 / 未完成 409 / 文件缺失 404 / 历史消息无链接）。

## 未闭合项

- 手工路径核对与独立（或按政策 cold-replay）closure audit 未完成。
- 计划各相位保持 `pending` 勾选状态待闭合时统一回填。
