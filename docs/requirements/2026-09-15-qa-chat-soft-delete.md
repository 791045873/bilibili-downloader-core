# 需求：QA 问答会话删除改为软删除

> 来源：用户 2026-09-15 直接请求（"将 QA 问答页面的聊天删除功能改为软删除……目的在于方便之后分析所有对话……目前仅改为软删除即可，其他的不需要动"）
> Owner Doc：`docs/design/app-overview.md`（穿搭问答（Web）章节）
> 相关既有实现：`docs/requirements/2026-09-09-rag-chat-service.md`（会话/消息模型基线）
> 保护区：数据删除（`ask-first`）——需求与计划需人工/子代理评审后再实施
> 范围确认（2026-09-15，用户）：仅把"删除会话"从物理删除改为软删除；不做恢复、不做分析读取接口、不改其他行为

## Goal

把 QA 问答页"删除会话"从物理删除（`conversation` 行删除 + `message` 级联删除）改为软删除（仅标记删除、保留全部会话与消息数据），以便后续分析全部对话、改进系统对话体验；删除的对外可见行为与前端交互保持不变。

## In Scope

### 数据模型（Prisma contract + migration）

- `Conversation` 增加可空删除标记列：`deletedAt Timestamptz? @map("deleted_at")`（无默认值，未删除为 NULL）。
- `prisma contract emit`；对现有库走 `prisma migration plan --name qa_chat_soft_delete` + `prisma db migrate`（additive 单列）；fresh 库由 `db init` 建列。
- `Message` 与 `Conversation` 的级联 FK 保持不变（物理删除能力保留，但当前删除路径不再触发）。

### 数据访问层（`packages/server/src/database/database.service.ts`）

- `deleteConversation(id)`：改为软删除，仅在未删除时写 `deleted_at = now()`（幂等；不触发 message 级联）。
- `listConversations()`：仅返回 `deleted_at IS NULL` 的会话。
- `getConversation(id)`：对已软删除会话返回 `undefined`（因此既有 `requireConversation` 校验对已删除会话返回 404，与现状一致）。
- `ConversationRecord` / `mapConversationRow`：透出 `deletedAt`（可选）。

### API 与前端

- `DELETE /api/chat/conversations/:id`：端点、响应 `{ deleted: true }`、错误码语义（不存在/已删除 → 404）全部不变，仅底层语义由物理删除变软删除。
- 前端（`QaChat.tsx` 删除按钮与列表刷新）不做任何改动。

### 测试与文档

- 更新 `packages/server/tests/database/chat.test.ts` 的删除用例：由"级联删除 messages"改为"软删除后列表隐藏、`getConversation` 返回 undefined、messages 仍存在"。
- 补充 `listConversations` 排除已软删除会话的用例。
- 更新 `docs/design/app-overview.md` 的删除语义说明；记录 `docs/logs/`。

## Out Of Scope

- 恢复/回收站接口或 UI。
- 面向分析的已删除对话读取接口（本次只保证数据不丢，读取能力后续另立需求）。
- 物理清理、保留期、归档、定时任务。
- 前端任何改动（删除按钮、二次确认、交互均不变）。
- 其他删除路径（下载任务、AI 总结任务）不动。
- 鉴权/权限、支付、部署配置（部署随镜像契约演进自然进行，不新增手动步骤）。

## Main User Flows

### 删除会话（行为与现状一致）

1. 用户在 `/qa` 会话列表对某会话点删除并二次确认。
2. 服务端把该会话标记为已删除（`deleted_at` 置值），不删除消息。
3. 会话从列表消失；再次请求该会话的消息/删除等返回 404（与现状一致）。

## Business Rules

- **只标记不删数据**：软删除仅写 `conversation.deleted_at`；`message` 行全部保留。
- **对现有接口不可见**：`listConversations` 排除已删除；`getConversation` 对已删除返回 `undefined`，故消息列表、发送、照片上传、删除的 `requireConversation` 均表现为 404。
- **幂等**：对已删除会话再次删除仍返回 404（与现状"不存在即 404"一致）。
- **不可恢复**：本次不提供任何恢复入口。
- **契约兼容**：响应结构与错误码不变；前端零改动。
- **无物理清理**：不新增删除数据的任务或接口。

## Roles / Permissions

- 单用户工具，无角色/权限系统；本次不触碰鉴权（属保护区域，未涉及鉴权改动）。

## Edge Cases

- 删除-生成并发：`insertAssistantMessage` 落库前经 `getConversation` 校验，软删除后同样抛 `NotFoundException`，既有并发语义不变。
- 重复删除同一会话：404（与现状一致）。
- 已软删除会话的消息仍可通过直接查库读取（供后续分析），但当前无 API 暴露。
- 会话被软删除后，其 `message` 不会因该操作被清理；`summary`/知识库等无关数据不受影响。
- 老库升级：`db migrate`/容器 `db init` 自动补 `deleted_at` 列（additive），无历史数据改写。

## Open Questions

无（仅软删除、其他不动，已由用户 2026-09-15 明确）。

## Acceptance Criteria

- [ ] `conversation.deleted_at` 列经 contract/emit/migration 落地；fresh 库 `db init` 建列，存量库 `db migrate` 加列成功。
- [ ] 删除会话后，会话从 `GET /api/chat/conversations` 消失；`GET /api/chat/conversations/:id/messages`、再次 `DELETE` 返回 404（与现状一致）。
- [ ] 删除会话后，数据库中该会话的 `message` 行仍全部存在（软删除未丢数据）。
- [ ] 前端删除交互与响应无变化；`pnpm typecheck`、`pnpm build` 通过。
- [ ] `packages/server/tests/database/chat.test.ts` 更新并通过（含列表隐藏、消息保留、getConversation 返回 undefined）。
- [ ] 未新增恢复能力、分析读取接口或物理清理路径。
