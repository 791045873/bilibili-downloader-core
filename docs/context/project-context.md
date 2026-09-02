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

- Active requirement: `docs/requirements/2026-09-01-prisma-orm-introduction.md`（Prisma 8 渐进式改造数据访问层；其后依次：knowledge-backfill、knowledge-vector-search Phase 2。约束：knowledge-backfill 不得与 Prisma 阶段并行修改 `database.service.ts`，串行执行）
- Active owner doc: `docs/design/app-overview.md`
- Active plan: `docs/plans/2026-09-01-prisma-introduction-master-plan.md`（P0、P1、P2a 已完成闭合；下一步：P2b 域迁移子 plan；2026-09-01 已通过 subagent plan 审计，见 `docs/audits/2026-09-01-plan-audit-prisma-introduction-master-plan.md`）
- Active backlog item: 无（回填需求已定稿，见 Active requirement；待出 plan）
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
- Database/model source: PostgreSQL（`pg` 连接池，经 `DATABASE_URL` 连接；schema 由 `database.service.ts` 启动时建表；本地与云端统一使用，不再使用本地 SQLite）；Prisma 8 基础设施已接入（`PrismaService`/contract 见 `packages/server/src/prisma/`，尚无消费者，数据访问仍走 `DatabaseService`；运行时类型差异见 `docs/logs/2026-09-01-prisma-p1-infrastructure.md`）

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
| Unit tests (server 数据层) | `pnpm --filter @bilibili-downloader/server test`（需测试库：`TEST_DATABASE_URL`，推荐 `docker run --rm -d --name bdl-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bdl_test -p 55432:5432 postgres:17`；SDK 包测试：`pnpm --filter bilibili-api-sdk test`） |
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
