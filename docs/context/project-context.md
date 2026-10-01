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

- Active requirement: `docs/requirements/2026-09-15-qa-chat-soft-delete.md`（QA 会话删除改为软删除）
- Active owner doc: `docs/design/app-overview.md`
- Active plan: `docs/plans/2026-09-15-qa-chat-soft-delete-plan.md`（保护区数据删除；用户已确认实施；contract/迁移/数据层/测试/typecheck/build 已完成；保护区 closure 评审待人工）
- Active backlog item: QA 会话软删除（其他未闭合进行中：QA 来源视频 AI 总结整页链接、QA 移动端适配）
- 已落地（未切 active）：云端/NAS Phase 1a 读取侧 DB 渲染——代码实现 + typecheck/build + 数据层/纯函数/controller 单测全绿（2026-09-28，测试库 127 项通过）；按 umbrella 遗留项 11，active requirement 仍保持 qa-chat-soft-delete 未切换
- 已落地（未切 active，2026-09-30）：Phase 2 异步任务队列 `worker_job`、完整性检查重定义、重试截图、**小用户系统与写操作鉴权（auth）**——四者均已过独立子代理 closure 评审并在各自 plan 内回填闭合证据（auth 评审结论 PASS-WITH-FIXES，B1 部署变量/Secure 开关与 B2 文档口径等修复已并入）；server 28 files / 216 tests 全绿。
- 已落地（未切 active，2026-09-30）：云端拆分 **Phase 3 代码拆分已完成**——退役单体 `packages/server`，拆分为 `cloud-server`（对外 HTTP + 作业生产）/ `nas-worker`（无对外 HTTP、作业消费执行）/ `server-common`（共享内核）三应用，COS 客户端下沉 `adapters/src/cos`；作业队列为云端生产者与 NAS 消费者的跨主机解耦通道。测试：server-common 12 files、cloud-server 12 files、nas-worker 6 files。**Stage D（部署 / 公网暴露）为保护区，仍需人工批准后方可实施**——当前 Dockerfile/compose 仍旧单体布局、`pnpm docker:build` 失效。首次部署必须设置 `ADMIN_INITIAL_PASSWORD`，否则无人可登录。实现记录 `docs/logs/2026-09-30-cloud-project-split.md`、计划 `docs/plans/2026-09-30-cloud-project-split-plan.md`、拆分映射 `docs/analysis/2026-09-30-phase3-stage-b-split-map.md`


- AI autonomy: `plan-first`（新工作需先出需求与计划并过审计）
- Current blocker: `none`
- Pending user confirmation: 部署新镜像后对 RAG 问答 LLM 全链路做运行级确认（T2/T3/T5/T6 开关/T7，见 `docs/testing/2026/09-09-rag-chat-testing.md` 裁决段）

Rule:

- If active requirement is `none`, agents may help create or clarify requirements and context, but must not implement product behavior.
- If AI autonomy is not `implement`, agents must follow `docs/context/ai-autonomy-policy.md` before changing product behavior.
- If documentation freshness is `stale` or `unknown`, agents may research, audit, and draft alignment docs, but must not implement product behavior until the baseline is re-established or a human confirms the intended behavior.
- If documentation freshness is `partially stale`, agents may implement only slices whose active requirement, owner doc, codebase-map route, and touched code area have been verified fresh; otherwise treat the slice as `plan-first` or `research-only`.

## Current Technical Baseline

- Frontend stack: React 19 + Vite + TypeScript（Zustand 状态管理 + antd 组件库 + TanStack Query 服务端状态）
- Backend stack: NestJS + TypeScript
- Database/model source: PostgreSQL（schema 自 P3 起由 Prisma contract/migration 管理：`db init` fresh / `db sign` 采纳存量 / `db migrate` 演进；启动为哨兵检查 + 幂等播种，不再建表；数据访问全量 Prisma，仅 2 个守卫型 claim + 哨兵保留 raw SQL；运行时类型差异见 `docs/logs/2026-09-01-prisma-p1-infrastructure.md`）

## Verification Commands

| Purpose                    | Command                                               |
| -------------------------- | ----------------------------------------------------- |
| Install dependencies       | `pnpm install`                                        |
| Run app locally (cloud-server) | `pnpm --filter @bilibili-downloader/cloud-server start:prod`（**Stage D 待接线**：拆分后无 `start:dev`；旧 `pnpm --filter @bilibili-downloader/server start:dev` 指向已删除的 server 包、已失效） |
| Run app locally (nas-worker)   | `pnpm --filter @bilibili-downloader/nas-worker start:prod`（无对外 HTTP、作业消费端） |
| Run app locally (frontend) | `pnpm frontend:dev`                                   |
| Run app locally (both)     | **Stage D 待接线**：旧 `pnpm dev:server` 仍引用已删除的 `@bilibili-downloader/server`，已失效 |
| Typecheck / compile check  | `pnpm typecheck`                                      |
| Build                      | `pnpm build`                                          |
| Lint / static check        | `none`                                                |
| Unit tests (后端三包)      | `pnpm --filter @bilibili-downloader/server-common test` + `pnpm --filter @bilibili-downloader/cloud-server test` + `pnpm --filter @bilibili-downloader/nas-worker test`（Phase 3 起 DB/日志/作业队列测试随 `server-common`，另有 cloud-server / nas-worker 包内测试；均需测试库 `TEST_DATABASE_URL`，推荐 `docker run --rm -d --name bdl-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bdl_test -p 55432:5432 pgvector/pgvector:pg17`；SDK 包测试：`pnpm --filter bilibili-api-sdk test`） |
| E2E / integration tests    | `none`                                                |
| Docker build               | **Stage D 保护区：`pnpm docker:build` 当前失效**（`Dockerfile.server` 仍 COPY 已删除的 `packages/server/`，三镜像接线待人工批准） |

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
