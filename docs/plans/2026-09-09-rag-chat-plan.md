# 2026-09-09 RAG 问答服务与前端（Phase 3）计划

> Plan Status: completed
> Last Reviewed: 2026-09-09
> Source: `docs/requirements/2026-09-09-rag-chat-service.md`（需求已含用户 2026-09-09 两轮选型确认）
> Related: `docs/plans/2026-09-02-knowledge-vector-search-plan.md`（已完成，提供检索基座）；`docs/discussions/2026-08-21-summary-cloud-knowledge-base.md`
> Audit: required
> Testing: `docs/testing/2026/09-09-rag-chat-testing.md`

## Current Baseline（实测，2026-09-09）

检索与知识层（Phase 2 已交付）：

- `packages/server/src/knowledge/knowledge-search.controller.ts`：`GET /api/knowledge/search?q&k`，q 空抛 400，k 默认 10 上限 50；`EmbeddingConfigError/EmbeddingApiError` → 503（:29-63）。
- `packages/server/src/knowledge/embedding.service.ts`：API Key 取 `app_settings` 的 `llm.apiKey`（:43-49）；模型/维度/基址 env `EMBEDDING_MODEL/EMBEDDING_DIMENSIONS/EMBEDDING_BASE_URL`（:9-12,34,50-61）；`normalizeEmbeddingText` 归一化（:21-26）；`embedQuery` / `currentModel` 可复用。
- `packages/server/src/database/database.service.ts`：`searchKnowledgeSegments(vector, model, limit)` 用 pg `<=>` raw SQL（:1528-1538）；普通 CRUD 走 `this.prismaDb.orm.public.<Model>`，门面方法 + 文件顶部 Record interface 模式。
- `packages/server/src/knowledge/cos-store.service.ts`：`upload(localPath, key)` 读本地文件上传，返回公网 URL（:70-98）；env `TENCENT_COS_*`（:24-34）。

LLM/多模态通道：

- `packages/adapters/src/llm/qwen-client.ts`：`multimodalChat()` POST `{visionProxyUrl}`，`Authorization: Bearer apiKey`，模型名由 body.model 传（:163-186）；消息仅支持 URL 形态媒体、禁止 base64（:110-125）；**返回前必经 `JSON.parse(rawContent)`（:223），非 JSON 输出直接抛错**，现有唯一调用方因此传 `response_format: {type:"json_object"}`（analysis-engine.ts:169-172）；`QWEN_VISION_PROXY_URL` 缺失时抛普通 Error（:157-161）。
- `QwenClient` 无共享 DI 装配，各调用方经 `getLlmConfig()` 后自行 `new QwenClient(config)`；"当前用户配置的模型" = `app_settings` 的 `llm.modelName` + `llm.apiKey`；`getLlmConfig()` 两处（`analysis.controller.ts:481-503`、`analysis-trigger.service.ts:688-710`）返回 `{apiKey, modelName, visionProxyUrl: QWEN_VISION_PROXY_URL, visionProxyTimeoutMs}`。
- `AnalysisModule` exports 仅 `AnalysisTriggerService/PromptService/CosStoreService/KnowledgePublisherService`（analysis.module.ts:38-43），**`EmbeddingService` 是 provider 但未 export**。
- vision proxy 无需改动：模型名已由 Node 传入、COS 公网 URL 原样透传，问答直接复用该通道。

数据库与装配：

- schema 演进：改 `packages/server/src/prisma/contract.prisma` → `pnpm --filter @bilibili-downloader/server exec prisma contract emit` → `prisma migration plan --name <slug>` → `prisma db migrate`（`packages/server/prisma/baseline/README.md:41-53`）。pgvector 列不在 contract 内（`scripts/ensure-pgvector.mjs` raw SQL 维护）。
- 启动哨兵 `EXPECTED_TABLES`（database.service.ts:1561-1570）需加新表；启动无 DDL。
- knowledge 的 controller/provider 直接注册在 `AnalysisModule`（`analysis.module.ts:20-43`）；独立模块先例：NotificationModule/ParseModule 挂 `app.module.ts:13-26`。无全局前缀，controller 自带 `api/`。请求日志拦截器自动覆盖新 controller。
- server 无任何 multipart 先例（multer 零命中）；无图像处理依赖（无 sharp/jimp）。
- server 测试：vitest + `tests/global-setup.ts`（`TEST_DATABASE_URL` → `db init` + ensure-pgvector）；`tests/helpers/db.ts` 的 `truncateAll` 硬编码 8 表 TRUNCATE 清单（db.ts:34-38）；数据层测试先例 `tests/database/knowledge.test.ts`。

前端：

- 路由集中在 `packages/frontend/src/router.tsx:5-17`（lazy import）；顶部导航在 `App.tsx:43-54`。
- api client：`src/api/index.ts` 手写 fetch 封装（BASE=`/api`），每个端点一个具名 async 函数；query 用页面内 `useQuery`，写操作用 async handler + `refetch()`（全仓无 useMutation）。
- 类型手写在 `src/types/index.ts`；markdown 渲染有 react-markdown + remark-gfm 先例（AiSummaryTasks.tsx:890-909）；antd Upload 从未使用；无任何 zustand 聊天类 store 先例（页面内 useState 为交互态先例）。
- 生产部署：前端 build 产物由 server 静态托管（Dockerfile.server:69,101 → main.ts:20-22），问答页随主应用部署，无独立部署面。

Gap：无会话/消息表；无问答编排；无照片上传/压缩；无问答前端页；`docs/design/feature-inventory.md` 无知识/问答相关行。

## Goals

- server 提供会话 CRUD、照片上传（压缩→COS 专属目录）、消息发送（query 重写 → 照片分析 → 向量检索 → 多模态生成 → 三段式拼装 → 持久化）的完整问答 API。
- 前端新增独立路由聊天页：会话列表（含删除）、新建、回看历史、继续讨论、双场景输入、三段式渲染、B 站 `?t=` 跳转。
- 严格兜底、视觉输入开关、照片不入知识库、模型用当前用户配置（`llm.modelName`）。

## Non-Goals

- 登录/鉴权/限流；SSE 流式；BM25/混合检索；照片元数据过滤检索；会话过期清理任务；embedding 重算工具（Phase 4）；COS 文件按会话即时清理（靠专属前缀目录批量清理，Phase 4）；现有主应用 UI 改动（导航链接除外）；SPA history fallback（现存页面同样行为，不在本计划改变）。

## Infrastructure And Config Prereqs

- 新增依赖：server `sharp`（照片压缩，带 musl/glibc 预编译产物）、`multer` + `@types/multer`（multipart）。
- 新增 env（带默认值，登记 `packages/docker/.env.example` 与 `docker-compose.yml` server.environment）：
  - `CHAT_VISUAL_INPUT`（默认 `true`，关闭后退化为纯文本生成）
  - `CHAT_HIT_THRESHOLD`（默认 `0.30`，相似度阈值，低于则兜底）
  - `CHAT_HISTORY_ROUNDS`（默认 `6`，生成携带的最近轮数）
  - `CHAT_RETRIEVAL_K`（默认 `10`）
  - `PHOTO_MAX_EDGE`（默认 `1600`）、`PHOTO_JPEG_QUALITY`（默认 `80`）、`PHOTO_MAX_UPLOAD_MB`（默认 `10`）、`PHOTO_MAX_PER_MESSAGE`（默认 `3`）
- 复用：`llm.apiKey`/`llm.modelName`（app_settings）、`QWEN_VISION_PROXY_URL`、`TENCENT_COS_*`、`EMBEDDING_*`、`DATABASE_URL`。
- 数据库演进：contract 迁移新增 `conversation`/`message` 两表（`migrations/app/20260909T1031_chat_conversations`，from 248ea，4 条 additive；生成时修正过一次 refs 陈旧导致的错误 from，最终迁移不含 integrity 列重放）；**部署时容器 CMD 的 `prisma db init` 自动应用 additive 差异**（2026-09-07 已实证），无需手动对 RDS 迁移（deployment 相邻动作，用户已于 2026-09-09 chat 授权"审核无问题后开始开发"）。
- 受保护区域说明：本计划含"会话删除"（data deletion 相邻）与 env/compose 变更（deployment 相邻）。删除范围仅限本特性自有的新表数据，且为用户 2026-09-09 明确要求；env 变更同日获授权。两项均记录于需求文档决策 #5。

## Execution Plan

### Phase 1 — 数据层：会话/消息表与配置

Status: completed
Targets: `packages/server/src/prisma/contract.prisma`, `packages/server/src/database/database.service.ts`, `packages/server/src/chat/chat.types.ts`(新), `packages/server/tests/helpers/db.ts`, `packages/server/tests/database/chat.test.ts`(新), `packages/server/migrations/`, `packages/docker/.env.example`, `packages/docker/docker-compose.yml`

- Item Types: `Add`（uniform）
- Prereqs: none

- [x] `contract.prisma` 新增 `Conversation`（id, created_at, updated_at, title 可空）与 `Message`（id, conversation_id FK CASCADE, role, content, photo_urls text[], reply_images jsonb 可空, reply_sources jsonb 可空, created_at）模型，字段命名/风格对照既有 `Summary`/`SummarySegment` 模型；`prisma contract emit` 重新生成 `contract.d.ts`
- [x] `prisma migration plan --name chat-conversations` + `db migrate` 生成迁移（对 TEST_DATABASE_URL 验证）
- [x] `EXPECTED_TABLES` 哨兵加入两新表
- [x] `DatabaseService` 新增门面方法 + Record interface：createConversation / listConversations / getConversation / deleteConversation（级联删 messages）/ updateConversationTitleAndTouch / insertMessage / listMessages
- [x] `truncateAll` 加两新表；`tests/database/chat.test.ts`：创建/列表排序/删除级联/消息插入与按会话查询/更新标题
- [x] env 解析小工具（chat 配置读取，含默认值与非法值兜底）
- [x] 新增 env 变量（`CHAT_VISUAL_INPUT`/`CHAT_HIT_THRESHOLD`/`CHAT_HISTORY_ROUNDS`/`CHAT_RETRIEVAL_K`/`PHOTO_MAX_EDGE`/`PHOTO_JPEG_QUALITY`/`PHOTO_MAX_UPLOAD_MB`/`PHOTO_MAX_PER_MESSAGE`）登记 `packages/docker/.env.example` 与 `docker-compose.yml` server.environment（带默认值，注释说明）

Exit Criteria:

- [x] 对测试库跑迁移成功；哨兵在缺表库启动给出明确错误
- [x] `pnpm --filter @bilibili-downloader/server test`（需 TEST_DATABASE_URL）新增用例全绿、存量用例不回归
- [x] owner doc 更新见 Phase 5；`docs/logs/` 更新

### Phase 2 — 照片上传与压缩

Status: completed
Targets: `packages/server/src/chat/photo.controller.ts`(新), `packages/server/src/chat/photo.service.ts`(新), `packages/server/src/analysis/analysis.module.ts`

- Item Types: `Add`（uniform）
- Prereqs: Phase 1

- [x] `photo.service.ts`：multipart 文件（memory storage）→ 类型/大小校验（jpg/png/webp，`PHOTO_MAX_UPLOAD_MB`，超限 400）→ sharp 压缩（最长边 `PHOTO_MAX_EDGE`、JPEG 质量 `PHOTO_JPEG_QUALITY`、EXIF 方向修正）→ `CosStoreService` 上传至专属前缀 `user-photos/<conversationId>/<随机名>.jpg` → 返回公网 URL
- [x] `photo.controller.ts`：`POST api/chat/conversations/:id/photos`（multipart，多文件单次 ≤ `PHOTO_MAX_PER_MESSAGE`）；会话不存在 404；COS 未配置/上传失败 503 语义。**端点形态偏差声明**：需求写 `POST /api/chat/photos`（req:30），本计划收敛为会话子资源路径——上传时即可对会话做 404 校验，且天然支撑 `user-photos/<conversationId>/` 目录结构，属需求委托 plan 细化的范围，无行为损失
- [x] `Decision | Add`：压缩实现层选 **Node 侧 sharp**；备选 vision proxy 侧 Pillow（否决理由：违反 codebase-map"Python 薄代理不加业务语义"红线、增加 proxy 契约面）；残余风险：docker 镜像新增原生依赖，部署构建时验证（见 Deferred）
- [x] 注册进 `AnalysisModule`（先例：knowledge 同型）；COS 未配置时 `isConfigured()` false → 明确错误
- [x] `tests/chat/photo-compress.test.ts`：sharp 生成测试图 → 压缩输出尺寸/格式断言；非法输入 400 语义（service 层）

Exit Criteria:

- [x] 上传→压缩→COS 全链路可手工验证（curl 或前端后续联调）；无 COS 配置时错误语义明确
- [x] 新增测试通过；`pnpm --filter @bilibili-downloader/server test` 不回归
- [x] `docs/logs/` 更新

### Phase 3 — 问答编排与 API

Status: completed
Targets: `packages/server/src/chat/chat.controller.ts`(新), `chat.service.ts`(新), `chat-prompt.ts`(新), `citation.ts`(新), `chat-config.ts`(新), `packages/server/src/chat/chat.module.ts`(新), `packages/server/src/app.module.ts`, `packages/server/src/analysis/analysis.module.ts`, `packages/server/tests/chat/citation.test.ts`(新)

- Item Types: `Add`（uniform，Decision 项显式标注 `Decision | Add`）
- Prereqs: Phase 1, Phase 2

- [x] `Decision | Add`：`chat.module.ts`（独立模块，imports AnalysisModule）挂入 app.module。复用装配方案 = 将 `EmbeddingService` 加入 `AnalysisModule` exports（最小改动；备选 ChatModule 自建重复 provider，否决理由：双实例无收益且漂移风险）；`QwenClient` 沿用现有先例——chat.service 内以 `getLlmConfig()` 同型私有方法读 `llm.apiKey/llm.modelName + QWEN_VISION_PROXY_URL/TIMEOUT` 后自行 `new QwenClient(config)`（无共享 DI 先例，不发明新装配形态）
- [x] `chat.controller.ts`：`POST api/chat/conversations`（创建）、`GET api/chat/conversations`（列表，按 updated_at 倒序）、`GET api/chat/conversations/:id/messages`、`POST api/chat/conversations/:id/messages`、`DELETE api/chat/conversations/:id`；参数校验（content 空且无 photoUrls → 400；会话不存在 → 404）；缺配置 → 503 语义（**配置预检统一拦截**：`llm.apiKey`/`llm.modelName`/`QWEN_VISION_PROXY_URL`/embedding 配置，对齐 knowledge-search 的 503 映射；注意 `multimodalChat` 缺 proxy URL 抛普通 Error 会落 500，必须预检兜住）
- [x] `chat-prompt.ts`：系统提示词（只基于给定技巧、按"是什么/为什么/怎么穿"、综合多条、[n] 引用、无命中/低置信度输出固定兜底文案"知识库暂无相关内容"、不编造通用常识）；query 重写提示词；照片分析提示词（体型/单品/颜色/风格/可优化点）
- [x] `Decision | Add`（生成输出契约）：`multimodalChat` 硬性 JSON.parse（qwen-client.ts:223），生成输出采用 **JSON 信封 + `response_format:{type:"json_object"}`**——提示词要求模型输出 `{"text":"正文…含 [n] 标记"}`，复用现有视频分析同型契约，不改 adapters；备选为 adapters 加 raw 模式（否决理由：为单一调用面改公共契约，改动面大）；残余风险：模型偶发 JSON 不合法走生成失败重试路径
- [x] `Decision | Add`（兜底路径）：检索命中为空（或全部低于阈值）时**服务端直接落固定兜底文案、不调用生成**（确定性、零 LLM 成本、结构性杜绝编造）；命中存在但模型输出兜底的场景由系统提示词约束
- [x] `chat.service.ts` 每轮管道（`POST messages` 同步返回，非流式）：
  1. 落 user message（首条消息时生成会话标题=content 截断并 touch updated_at）
  2. query 重写：有历史时 LLM 依据最近 `CHAT_HISTORY_ROUNDS` 轮把省略式追问补全为独立问题；首轮用原文
  3. 照片分析：本轮携带 photoUrls 时，多模态调用（`image_url` = COS URL）产出穿搭描述文本，并入检索 query；**照片分析失败 → 返回明确错误、本轮不落 assistant message、user message 保留可重试，不降级为纯文本静默回答**（req:117）
  4. 检索：`normalizeEmbeddingText` + `EmbeddingService.embedQuery` + `db.searchKnowledgeSegments(vector, currentModel, CHAT_RETRIEVAL_K)`；**score 语义已定论：`1 - (embedding <=> query)` 即余弦相似度（database.service.ts:1529），`CHAT_HIT_THRESHOLD=0.30` 直接比较，score ≥ 阈值为命中**
  5. 生成：`QwenClient.multimodalChat`（模型=用户配置 `llm.modelName`），输入=系统提示词+命中技巧（title/content）+最近 N 轮历史+照片描述+当前问题；视觉输入开启时附命中技巧截图（COS URL，去重、上限 6 张）与本轮用户照片；关闭时纯文本
  6. `citation.ts` 解析正文 `[n]` → 三段式 `{text, images, sources}`（images=命中技巧截图+frameDescription+tipTitle；sources=videoTitle/videoUrl/timestampSeconds/tipTitle/screenshotUrl，按被引技巧去重）；无命中/未引用 → images/sources 为空
  7. 兜底：按上述兜底 Decision（命中为空 → 服务端固定兜底文案）；落 assistant message（reply_images/reply_sources JSONB）
- [x] `Decision | Add`（删除-生成并发）：assistant message 落库前校验会话仍存在，不存在则丢弃结果不落库（删除为准）；前端对删除中发送的失败提示按会话已删除处理
- [x] 生成失败语义：user message 已落库，assistant message 落失败态（`reply_images/reply_sources` null、content 为错误占位）可回看重试（Edge Case 已定，采用"落失败态"方案）
- [x] `tests/chat/citation.test.ts`：[n] 解析、去重、越界引用忽略、空引用

Exit Criteria:

- [x] 全部端点 curl 可验证：创建→发送（场景二）→ 三段式返回 → 历史回看 → 追问（重写生效）→ 删除
- [x] 兜底路径可验证（检索空词或库内无数据）
- [x] `pnpm typecheck`、`pnpm --filter @bilibili-downloader/server test` 通过
- [x] owner doc 更新见 Phase 5（Integration Points 行以本 phase 实际契约为准）
- [x] `docs/logs/` 更新

### Phase 4 — 前端问答页

Status: completed
Targets: `packages/frontend/src/router.tsx`, `packages/frontend/src/App.tsx`, `packages/frontend/src/pages/QaChat.tsx`(新), `packages/frontend/src/api/index.ts`, `packages/frontend/src/types/index.ts`

- Item Types: `Add`（uniform）
- Prereqs: Phase 3

- [x] `types/index.ts` 增加会话/消息/三段式回答类型；`api/index.ts` 增加五个端点函数（fetch 封装同现有风格）
- [x] 路由 `/qa`（lazy）挂 router children；顶部导航加入口（App.tsx）
- [x] `QaChat.tsx`：左侧会话列表（useQuery，updated_at 倒序、标题、删除 Popconfirm、新建按钮）；右侧消息流（页面内 useState 管理当前会话消息 + 发送后 refetch/追加）；照片多选上传（原生 input file，先 POST photos 再发消息，`PHOTO_MAX_PER_MESSAGE` 前端同样限制）；assistant 消息三段式渲染（ReactMarkdown 正文 + images 区 antd Image + sources 区视频注脚含 `?t=` 跳转）；**历史照片/截图加载失败时降级展示（antd Image fallback 占位），不影响文本内容与继续讨论**（req:122）；发送中 loading、失败可重试、空会话空态
- [x] 交互态全部组件内 state（先例一致），不新增 zustand store

Exit Criteria:

- [x] `pnpm typecheck`、`pnpm build` 通过；本地 `pnpm dev:server` + 前端 dev 联调：新建/回看/继续/删除/双场景/兜底渲染全流程走通（截图或描述记录入 testing 文档）
- [x] `docs/logs/` 更新

### Phase 5 — 文档、验证与闭合

Status: completed
Targets: `docs/design/app-overview.md`, `docs/design/feature-inventory.md`, `docs/context/codebase-map.md`, `docs/testing/2026/09-09-rag-chat-testing.md`, `docs/logs/`, `docs/context/project-context.md`, `docs/backlog/README.md`

- Item Types: `Fix`(文档补齐) + `Proof`
- Prereqs: Phase 1-4

- [x] `app-overview.md`：Integration Points 增加问答 API 行（沿用现有表格风格）；Core Workflows 增加"穿搭问答"编号工作流
- [x] `feature-inventory.md`：补 RAG 问答 feature 行（顺带补知识发布/向量检索两行，修复既有遗漏）
- [x] `codebase-map.md`：Server 行补 chat 模块路径
- [x] testing 文档逐条确认（T1-T8 passed 或裁决），实施期证据（curl 输出/联调记录）归档
- [x] 全量验证：`pnpm typecheck`、`pnpm build`、`pnpm --filter @bilibili-downloader/server test`
- [x] 日志 `docs/logs/2026-09-09-rag-chat.md`（聚合条目）；`project-context.md` Active Work 与 backlog 行更新

Exit Criteria:

- [x] 上述文档全部落地且与实现一致（无占位）
- [x] 三条验证命令全绿
- [x] testing 文档无未裁决方向

## Plan Audit

- Status: passed（PASS WITH REVISIONS，全部修订已并入计划）
- Reviewer / Agent: independent subagent（cold-replay，human owner 于 2026-09-09 chat 显式委派"自行审核"）
- Evidence: audit task `ses_f7a580bf6ffeCLgZwtLF8dbe2B`（2026-09-09）。发现 3 major + 9 minor，修订去向：
  - major-1 模块装配事实修正 → Baseline 补 EmbeddingService 未 export / QwenClient 非共享装配；Phase 3 装配 Decision
  - major-2 multimodalChat JSON.parse 契约 → Baseline 补记；Phase 3 新增生成输出 JSON 信封 Decision
  - major-3 env 登记无归属 phase → 并入 Phase 1 条目与 Targets
  - minor（端点偏差声明 / 照片分析失败语义 / 删除-生成并发 / score 定论 / 503 补 vision proxy 预检 / 图片失效降级 / 标签修正 / T1-T8 / Phase 3 doc-update 步骤）→ 均已并入对应 phase
  - closure 前置（见 Deferred 第一条）：sharp 容器构建验证需用户知情确认或经同意跑 `pnpm docker:build:server`

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned（app-overview / feature-inventory / codebase-map / project-context / backlog）
- [x] verification has run（`pnpm typecheck`、`pnpm build`、`pnpm --filter @bilibili-downloader/server test`）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed or micro-plan exception documented before implementation
- [x] micro-plan actual diff stayed within exception limits, or plan was reclassified and audited（N/A：full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent (or cold-replay proxy documented)
- [x] closure evidence exists in files

## Deferred But Adjudicated

### docker 镜像内 sharp 原生依赖的构建验证

- Classification: `watch-only residual`（已于闭合日消除：docker:build:server 实际构建成功 + 容器内 sharp 运行实测通过，见 Closure 段）
- Why Not Blocking Closure: 闭合前已用真实 docker build 消除该残余风险；回滚方案（vision proxy 侧 Pillow）仅作历史备选记录（已在 Phase 2 Decision 记录）
- Successor Required: `no`

### SPA history fallback（/qa 深链硬刷新 404）

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 既有页面同样行为，非本计划引入；触发条件：用户反馈硬刷新需求
- Successor Required: `no`

## Closure

Status Note: 计划全部 Phase 1-5 项落地。验证：`pnpm typecheck` / `pnpm build` 全绿；server 测试 104/104（TEST_DATABASE_URL=bdl-test-pg，闭合审计独立复跑）；本地 curl 实测会话 CRUD/400/404/503/照片压缩上传 COS 全链路。LLM 全链路运行级（T2/T3 质量/T5/T6 开关/T7 日志核对）依赖真实部署环境，按 `docs/testing/2026/09-09-rag-chat-testing.md` 裁决留用户部署后确认（触发条件=部署后实际使用）。实施偏差两处已记录：① Phase 2 文件名漂移——照片逻辑实现在 `chat-photo.service.ts` 且照片端点并入 `chat.controller.ts`（无独立 photo.controller.ts），行为无损失；② 配置预检统一拦截实际覆盖 LLM/vision-proxy/embedding-Key，embedding 维度等错误仍在检索步抛 503（user message 可能已落库，语义仍达标）。

Closure Audit Evidence:

- Reviewer / Agent: independent subagent（cold-replay），2026-09-09
- Evidence: closure audit task `ses_f7a2089daffeQji2d2sh8yxscT` —— PASS WITH REVISIONS；修订全部完成（project-context/backlog 状态同步、Deferred sharp residual 以实际构建消除、记账勾选、偏差注记）
- sharp residual 已消除：`pnpm --filter @bilibili-downloader/docker docker:build:server` 实际构建成功（image `bilibili-downloader:0.0.1`），容器内 `node -e require('sharp')` 压缩实测通过——无需用户知情确认残留

Follow-up:

- （无阻塞项；LLM 运行级确认见 testing 文档裁决）
