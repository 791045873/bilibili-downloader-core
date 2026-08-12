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

- Active requirement: `docs/requirements/2026-08-12-ai-summary-raw-record-and-retrigger.md`
- Active owner doc: `docs/design/app-overview.md`
- Active plan: `docs/plans/2026-08-12-ai-summary-raw-response-view-plan.md`
- Active backlog item: `下载任务列表分页、过滤与 AI 总结入口`
- AI autonomy: `plan-first`（2026-08-04 已切换到方案 B，更新后的计划需重新审计后再实施）
- Current blocker: `none`

Rule:

- If active requirement is `none`, agents may help create or clarify requirements and context, but must not implement product behavior.
- If AI autonomy is not `implement`, agents must follow `docs/context/ai-autonomy-policy.md` before changing product behavior.
- If documentation freshness is `stale` or `unknown`, agents may research, audit, and draft alignment docs, but must not implement product behavior until the baseline is re-established or a human confirms the intended behavior.
- If documentation freshness is `partially stale`, agents may implement only slices whose active requirement, owner doc, codebase-map route, and touched code area have been verified fresh; otherwise treat the slice as `plan-first` or `research-only`.

## Current Technical Baseline

- Frontend stack: Vue 3 + Vite + TypeScript
- Backend stack: NestJS + TypeScript
- Database/model source: SQLite（better-sqlite3，通过 server 包管理）

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
