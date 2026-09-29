# 2026-09-28 云端/NAS Phase 1a — 总结读取侧 DB 渲染（实现）

> 计划：`docs/plans/2026-09-23-cloud-read-path-db-render-plan.md`
> 需求：`docs/requirements/2026-09-17-cloud-read-path-db-render.md`
> 基线 tag：`pre-cloud-nas-split-2026-09-28`

## 改动

- `packages/server/src/database/database.service.ts`：新增只读方法 `getSummaryWithSegmentsByResource(bvid, cid)`（ORM 读 `summary` 头 + 按 `seq` 升序 `summary_segment` 全渲染字段；无行返回 `undefined`）。
- `packages/server/src/analysis/summary-render.ts`（新增）：三个纯函数 `buildSummaryMeta` / `renderSummaryFromDb` / `renderRawResponseMarkdown`（复用 `generateMarkdown` + `extractSummaryMeta` 得与现状一致正文）。
- `packages/server/src/analysis/analysis-task.controller.ts`：`renderSummaryMarkdown` 改为 DB 渲染薄编排（summary 优先、raw_response 回退）+ 段数漂移非阻塞 warn；移除 `readFile`/`resolveSummaryOutputPath`（读路径）/`rewriteMarkdownImageUrls` 读盘分支与相关 import。
- 测试：`tests/database/summary-render-read.test.ts`、`tests/analysis/summary-render.test.ts`、`tests/analysis/summary-markdown-controller.test.ts`。

## 与计划的偏差

- `renderRawResponseMarkdown` 签名较计划多一个 `videoTitle` 入参：`raw_response` JSON 不含视频标题，H1 需由 meta.title（任务标题）提供，否则回退正文 H1 为空。属正文正确性所需，非行为契约变化。

## 验证

- `pnpm typecheck`、`pnpm build`：通过。
- `pnpm --filter @bilibili-downloader/server test`（`TEST_DATABASE_URL` 指向本地 pgvector:pg17 容器）：18 文件 / 127 项全绿。
- IDE `Edit` 工具本会话故障（`e.trimEnd is not a function`），代码/文档改动改用一次性 Python 脚本精确字符串替换，替换均带唯一命中校验，临时脚本已删除。

## 闭合

- plan 与 closure 均为 cold-replay 自查留证（reviewer availability=none，非保护区允许）。
- active requirement 未切换（仍 `qa-chat-soft-delete`，按 umbrella 遗留项 11）。
- 后继：Phase 1b（内联发布 + 本地下线）可起草计划。
