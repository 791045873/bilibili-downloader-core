# 2026-09-15 QA 会话删除改为软删除

> Plan Status: draft（待保护区评审后实施）
> Last Reviewed: 2026-09-15
> Source: `docs/requirements/2026-09-15-qa-chat-soft-delete.md`
> Related: `docs/requirements/2026-09-09-rag-chat-service.md`（会话/消息模型基线）
> Audit: required（保护区：数据删除 `ask-first`；reviewer availability = none → 需人工/子代理评审，不可用 cold-replay 代替）
> Testing: `packages/server/tests/database/chat.test.ts`（需 `TEST_DATABASE_URL`）

## Current Baseline

- `Conversation`/`Message` 模型见 `packages/server/src/prisma/contract.prisma:109-132`；`message.conversation_id` FK `onDelete: Cascade`。
- 数据访问：`database.service.ts:1572-1613`（`createConversation`/`listConversations`/`getConversation`/`updateConversationTitleAndTouch`/`deleteConversation`），`deleteConversation` 现为 `Conversation.delete()` 物理删除，message 经 FK 级联删除。
- 控制器：`chat.controller.ts:91-96` `DELETE /api/chat/conversations/:id`；`requireConversation`（`:98-103`）依赖 `getConversation`。
- 测试：`packages/server/tests/database/chat.test.ts:52-69` 断言物理删除并级联清空 message；`:28-37` 断言列表倒序。
- 迁移工作流：改 `contract.prisma` → `pnpm --filter @bilibili-downloader/server prisma:emit` → `prisma migration plan --name <slug>` → `prisma db migrate`；fresh `db init`（见 `packages/server/prisma/baseline/README.md`）。
- 缺口：无删除标记列；删除为物理删除，无法保留对话供分析。

## Goals

- 删除 QA 会话仅标记 `conversation.deleted_at`，消息数据全部保留。
- 删除的对外可见行为、响应与前端交互保持不变。
- 不改动其他功能。

## Non-Goals

- 恢复/回收站、分析读取接口、物理清理/保留期/归档。
- 其他删除路径、前端改动、鉴权/部署配置。

## Infrastructure And Config Prereqs

- 数据库变更：`conversation` 加可空列 `deleted_at timestamptz`（additive）。实施需可执行 `prisma db migrate` 的目标库；测试需 `TEST_DATABASE_URL`（推荐 pgvector/pg17 测试容器，见 project-context）。
- 回滚：列为可空且无默认值，回滚只需应用回旧镜像；旧代码忽略新列。如需显式回滚：`ALTER TABLE conversation DROP COLUMN deleted_at`（仅当确认无代码依赖）。
- 保护区域：数据删除（`ask-first`）。本计划须经人工/子代理评审后方可实施；不涉及 auth/支付/部署配置改动。

## Execution Plan

### Phase 1 - 数据模型与迁移

Status: pending（待评审）
Targets: `packages/server/src/prisma/contract.prisma`, `packages/server/src/prisma/contract.json`, `packages/server/src/prisma/contract.d.ts`, `packages/server/migrations/app/*`

- Item Types: `Add | Decision`
- Prereqs: 人工/子代理评审通过

- [x] `Decision`: 以可空时间戳 `deleted_at` 作为删除标记（而非布尔 `is_deleted`）。理由：保留删除时间，利于后续分析；NULL 表示未删除，additive 兼容。备选：布尔列（无法承载时间）。
- [x] `Add`: `Conversation` 增加 `deletedAt Timestamptz? @map("deleted_at")`；执行 `prisma:emit`（storageHash `4daf8a58…` → `6bb52ad1…`）。
- [x] `Add`: `prisma migration plan --name qa_chat_soft_delete`（offline）生成 `migrations/app/20260917T0754_qa_chat_soft_delete`（1 条 additive `ADD COLUMN`）。未对目标库执行 `db migrate`（RDS，避免未批准线上变更）；部署时容器 `db init` 自动应用 additive 列。
- [x] `Proof`: fresh 测试库 `prisma db init` 建出含 `deleted_at` 的 schema（`operationsExecuted: 24`，marker `6bb52ad1…`）；记录见 `docs/logs/2026-09-15-qa-chat-soft-delete.md`。

Exit Criteria:

- [ ] contract 与迁移落地；存量库迁移成功、fresh 库建列成功。
- [ ] 未改动其他表/列/索引。
- [ ] `docs/logs/` 记录本相位进展。

### Phase 2 - 数据访问层软删除语义

Status: pending
Targets: `packages/server/src/database/database.service.ts`

- Item Types: `Fix | Decision`
- Prereqs: Phase 1

- [x] `Decision`: `getConversation` 对已删除返回 `undefined`（而非仍可读）。理由：保持现有 `requireConversation` 404 语义与前端行为不变；分析读取后续另立接口。备选：`getConversation` 仍返回、仅列表过滤（会改变发送/上传对已删除会话的行为）。
- [x] `Fix`: `deleteConversation(id)` 改为 `update deleted_at = now() where id = ? and deleted_at is null`（幂等、不触发级联）。
- [x] `Fix`: `listConversations()` 增加 `deletedAt IS NULL` 过滤（保持 `updated_at` 倒序）。
- [x] `Fix`: `getConversation(id)` 增加 `deletedAt IS NULL` 过滤。
- [x] `Fix`: `ConversationRecord`/`mapConversationRow` 透出可选 `deletedAt`。
- [x] `Proof`: `pnpm typecheck`。

Exit Criteria:

- [ ] 删除仅写标记、消息保留；已删除会话对列表/读取不可见。
- [ ] 未改动控制器与前端。
- [ ] `docs/logs/` 记录本相位进展。

### Phase 3 - 测试与验证

Status: pending
Targets: `packages/server/tests/database/chat.test.ts`

- Item Types: `Fix | Add | Proof`
- Prereqs: Phase 2

- [x] `Fix`: 将"deleteConversation 级联删除 messages"用例改为"软删除：列表隐藏、`getConversation` 返回 undefined、message 行仍存在"。
- [x] `Add`: 新增"listConversations 排除已软删除会话"用例。
- [x] `Proof`: 运行 `pnpm --filter @bilibili-downloader/server test`（本地 pgvector/pg17 测试容器，`TEST_DATABASE_URL`；15 files / 105 tests 全通过，含 `chat.test.ts` 8 tests）与 `pnpm typecheck`、`pnpm build`。
- [ ] `Proof`: 手动核对删除后 API 行为（列表消失、消息/再次删除 404）——待运行实例。

Exit Criteria:

- [ ] 数据层测试通过；删除语义与需求一致。
- [ ] `pnpm typecheck`、`pnpm build` 通过。
- [ ] `docs/logs/` 记录本相位进展。

### Phase 4 - 文档与闭合

Status: pending
Targets: `docs/design/app-overview.md`, `docs/context/codebase-map.md`, `docs/context/project-context.md`, `docs/backlog/README.md`, `docs/logs/`

- Item Types: `Add | Proof`
- Prereqs: Phase 1–3

- [x] `Add`: 更新 `docs/design/app-overview.md` 会话删除语义（软删除、消息保留）。
- [x] `Add`: 更新 `docs/context/codebase-map.md`/`project-context.md`/`backlog` 与 `docs/logs/`。
- [ ] `Proof`: 保护区 closure 评审（人工/子代理），记录证据与限制。

Exit Criteria:

- [ ] 需求 Acceptance Criteria 全部满足。
- [ ] owner doc / codebase-map / project-context / backlog / log 更新。
- [ ] 保护区 closure 评审完成并留证。

## Plan Audit

- Status: implementation-authorized（保护区人工授权；独立/closure 评审仍待办）
- Reviewer / Agent: 用户（保护区数据删除 `ask-first` 的人工授权）
- Evidence: 用户 2026-09-15 明确"确认实施"；实施记录见 `docs/logs/2026-09-15-qa-chat-soft-delete.md`。reviewer availability = none，closure 评审不可用 cold-replay 代替。

## Implementation Status (2026-09-15)

代码与迁移产物已落地，静态与数据层验证通过；**HTTP 运行级核对与保护区 closure 评审未完成**，故计划保持未闭合。

已落地：contract `deleted_at` → emit（`6bb52ad1…`）→ `migration plan`（`20260917T0754_qa_chat_soft_delete`，1 additive）；`deleteConversation` 软删除、`listConversations`/`getConversation` 排除已删除、`ConversationRecord` 透出 `deletedAt`；`chat.test.ts` 用例更新与新增；owner doc/codebase-map/project-context/backlog/log 更新。

未对 RDS 目标库执行 `db migrate`（避免未批准线上变更）；部署新镜像时容器 `db init` 自动应用 additive 列。

静态/数据层验证证据：`pnpm typecheck`、`pnpm build` 全包通过；测试容器（pgvector/pg17, 55432）`pnpm --filter @bilibili-downloader/server test` → 15 files / 105 tests 全通过。

待执行（阻断闭合）：HTTP 删除行为核对；保护区 closure 评审。

## Closure Gates

- [x] in-scope behavior is complete（代码层面完成）
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck`、`pnpm build`、server 数据层测试；HTTP 手工核对待补）
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation（保护区人工授权实施）
- [x] micro-plan exception not applicable（含 schema 迁移与数据删除语义变更）
- [x] text consistency verified
- [ ] closure audit was independent（保护区评审，不可 cold-replay 代替）
- [ ] closure evidence exists in files

## Closure

Status Note: 未闭合。实现与静态/数据层验证完成；HTTP 运行级核对与保护区 closure 评审待执行。

Closure Audit Evidence:

- Reviewer / Agent: 待回填（保护区：人工或子代理）
- Evidence: 待回填

Follow-up:

- 面向分析的已删除会话读取接口（本次明确 out of scope，后续另立需求）。
- 部署新镜像时由容器 `db init` 应用 `deleted_at` additive 列（无需手动 `db migrate`）。
