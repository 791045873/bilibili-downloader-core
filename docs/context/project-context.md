# Project Context

## Purpose

Keep this file as the shortest current snapshot an AI agent needs before doing useful work.

Update it in place. Do not create dated copies.

## Project Identity

- Project name: `bilibili-downloader-core`
- Product type: Bilibili 视频下载工具（Web 应用 + Docker）
- Primary users: NAS 用户、普通 Web 用户
- Current milestone: MVP 已完成，进入功能扩展阶段
- Documentation freshness: `fresh`

## Active Work

- Active requirement: `none`（已全部完成：AI 总结视图 markdown 渲染 `docs/requirements/2026-08-17-ai-summary-view-markdown.md`；数据库迁移 `docs/requirements/2026-08-24-sqlite-to-postgresql-migration.md`；COS 知识发布管道 `docs/requirements/2026-08-24-cos-summary-knowledge-publish.md`）
- Active owner doc: `docs/design/app-overview.md`
- Active plan: `none`（最近关闭：`docs/plans/2026-08-24-cos-summary-knowledge-publish-plan.md`，2026-09-01 用户确认关闭，桶公有读遗留项已复验解决；此前：`docs/plans/2026-08-24-sqlite-to-postgresql-migration-plan.md` 已关闭）
- Active backlog item: 无（最近完成项：移除前端 BaseURL 配置、测试连接改用原生端点；此前：视觉代理密钥改为 DB 来源 + 请求透传、移除多模态直连分支与 chatCompletion 死代码、环境变量清理、提取 Python 视觉代理为独立子包、Docker 拆分视觉代理为独立容器）
- AI autonomy: `plan-first`（2026-08-04 已切换到方案 B，更新后的计划需重新审计后再实施）
- Current blocker: `none`

Rule:

- If active requirement is `none`, agents may help create or clarify requirements and context, but must not implement product behavior.
- If AI autonomy is not `implement`, agents must follow `docs/context/ai-autonomy-policy.md` before changing product behavior.
- If documentation freshness is `stale` or `unknown`, agents may research, audit, and draft alignment docs, but must not implement product behavior until the baseline is re-established or a human confirms the intended behavior.
- If documentation freshness is `partially stale`, agents may implement only slices whose active requirement, owner doc, codebase-map route, and touched code area have been verified fresh; otherwise treat the slice as `plan-first` or `research-only`.

## Current Technical Baseline

- Frontend stack: React 19 + Vite + TypeScript（Zustand 状态管理 + antd 组件库 + TanStack Query 服务端状态）
- Backend stack: NestJS + TypeScript
- Database/model source: PostgreSQL（`pg` 连接池，经 `DATABASE_URL` 连接；schema 由 `database.service.ts` 启动时建表；本地与云端统一使用，不再使用本地 SQLite）

## Verification Commands

| Purpose                    | Command                                               |
| -------------------------- | ----------------------------------------------------- |
| Install dependencies       | `pnpm install`                                        |
| Run app locally (server)   | `pnpm --filter @bilibili-downloader/server start:dev` |
| Run app locally (frontend) | `pnpm frontend:dev`                                   |
| Run app locally (both)     | `pnpm dev:server`                                     |
| Typecheck / compile check  | `pnpm typecheck`                                      |
| Build                      | `pnpm build`                                          |
| Lint / static check        | `none`                                                |
| Unit tests                 | `none`                                                |
| E2E / integration tests    | `none`                                                |
| Docker build               | `pnpm docker:build`                                   |

## Optional Layers Currently In Use

Mark only the optional layers this project actually maintains.

- [x] `docs/discussions/`
- [x] `docs/audits/`
- [x] `docs/testing/`
- [ ] `docs/skills/`
- [ ] `docs/analysis/`
- [x] `docs/retrospectives/`
- [ ] `docs/lessons/`

## AI Block Conditions

AI MUST stop and wait for human input before proceeding when:

- verification commands are all placeholders and cannot be inferred from the project
- any change touches payment or data-deletion paths with no existing test coverage and no owner doc describing expected behavior

These are project-specific hard stops in addition to `AGENTS.md`, `docs/context/ai-autonomy-policy.md`, source-of-truth conflict rules, and required plan/closure audit rules.

For ambiguity that does not affect user-visible behavior, contracts, protected areas, or closure evidence, resolve by writing assumptions into the relevant doc and proceed according to the autonomy policy. Mark uncertain assumptions explicitly so humans can review later.

## Notes For AI Agents

- If this file is empty or stale, ask for or create a context update before large implementation work.
- AI may correct factual context from live repo evidence, but must not loosen autonomy, remove blockers, mark stale docs fresh, or downgrade protected areas without human confirmation or human-approved owner-doc evidence.
- Do not infer current milestone or active plan from chat alone.
- Do not report verification success while commands still contain `<fill real command>` placeholders.
