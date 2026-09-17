# 2026-09-15 QA 会话删除改为软删除 — 实施日志

- 需求：`docs/requirements/2026-09-15-qa-chat-soft-delete.md`
- 计划：`docs/plans/2026-09-15-qa-chat-soft-delete-plan.md`（`Plan Status: draft → 实施中`）
- 保护区：数据删除（`ask-first`）；用户 2026-09-15 确认实施
- 迁移：`packages/server/migrations/app/20260917T0754_qa_chat_soft_delete`（1 条 additive：`ALTER TABLE conversation ADD COLUMN deleted_at timestamptz`）

## 变更文件

- `packages/server/src/prisma/contract.prisma`：`Conversation` 增 `deletedAt Timestamptz? @map("deleted_at")`。
- `packages/server/src/prisma/contract.json`/`contract.d.ts`：`prisma:emit` 重新生成（storageHash `4daf8a58…` → `6bb52ad1…`）。
- `packages/server/migrations/app/20260917T0754_qa_chat_soft_delete/`：`migration plan` 生成（offline，无 DB 连接）。
- `packages/server/src/database/database.service.ts`：
  - `ConversationRecord` 增可选 `deletedAt`；`mapConversationRow` 透出。
  - `listConversations` 加 `deletedAt IS NULL` 过滤；`getConversation` 对已删除返回 `undefined`。
  - `deleteConversation` 由物理删除改为 `update deleted_at = now() where id and deleted_at is null`（幂等，不触发 message 级联）。
- `packages/server/tests/database/chat.test.ts`：删除用例改为软删除语义（列表隐藏、`getConversation` undefined、message 仍为 2 条）；新增"listConversations 排除已软删除会话"用例。
- `docs/design/app-overview.md`：QA 章节增软删除语义说明。
- `docs/context/codebase-map.md` / `docs/context/project-context.md` / `docs/backlog/README.md`：状态与注记更新。

## 决策记录

- 用可空时间戳 `deleted_at` 而非布尔列（保留删除时间，additive 兼容）。
- `getConversation` 对已删除返回 `undefined`，保持既有 `requireConversation` 404 语义，前端零改动。
- 不提供恢复入口、不提供分析读取接口、不做物理清理（均为 out of scope）。

## 验证

- `pnpm typecheck`：全包通过。
- `pnpm build`：全包通过（frontend vite build 3410 modules；server nest build 通过）。
- 数据层测试：本地临时 pgvector/pg17 容器（`bdl-test-pg`，端口 55432）`TEST_DATABASE_URL` → `pnpm --filter @bilibili-downloader/server test`：**15 files / 105 tests 全通过**（含 `chat.test.ts` 8 tests）。
  - globalSetup `prisma db init` 对 fresh 测试库建出含 `deleted_at` 的 schema（`operationsExecuted: 24`，marker `6bb52ad1…`），验证 fresh 路径。
- 未对目标库（`packages/server/.env` 指向的 RDS）执行 `db migrate`：避免未经批准的线上数据变更。部署新镜像时容器 `prisma db init` 会对已签名旧库自动应用 additive 列（已有实证机制）。

## 未闭合项

- 保护区 closure 评审（人工/子代理）未完成；reviewer availability = none，禁止 cold-replay 代替。
- 已删除会话的分析读取接口为明确的后续工作（本次 out of scope）。
