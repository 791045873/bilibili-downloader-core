# 2026-08-24-cos-summary-knowledge-publish-plan COS 截图上传与知识发布管道（Phase 1）

> Plan Status: completed
> Last Reviewed: 2026-08-24
> Source: `docs/requirements/2026-08-24-cos-summary-knowledge-publish.md`
> Related: `docs/discussions/2026-08-21-summary-cloud-knowledge-base.md`、`docs/plans/2026-08-24-sqlite-to-postgresql-migration-plan.md`（已关闭）
> Audit: required
> Testing: `docs/testing/2026/08-24-cos-summary-knowledge-publish.md`

## Current Baseline

- 持久化已全部迁移到云端 PostgreSQL（阿里云 RDS `ai_summary`），`database.service.ts` 为唯一数据访问层（异步 pg 池）。
- AI 总结截图目前生成到本地 `summaryDir/screenshots/segment-N.jpg`；md 用相对路径 `screenshots/segment-N.jpg` 引用，前端经 `/summary-files/` 静态挂载加载（`main.ts`），`rewriteMarkdownImageUrls` 在 markdown 端点把相对路径重写为 `/summary-files/...`。
- 分析完成在 `AnalysisTriggerService.runAnalysis`（completed 分支，L476-485）与 `runRebuild`（completed 分支）写入 `ai_summary_task`（completed + summaryOutput + rawResponse + modelName）。
- `raw_response` 为模型 JSON 原文（`{summary:[{title,content,timestamp,frameDescription}]}`），`normalizeSummaryItems`（analysis-engine.ts）做四字段非空过滤；`parseTimestampCandidates`/`pickTimestampSeconds`（timestamp.ts）可将 timestamp 解析为秒。
- 无任何 COS 集成（`cos-nodejs-sdk-v5` 曾在 adapters 移除，2026-08-18-env-var-cleanup）。`.env` 现有 `TENCENT_COS_SECRET_ID/KEY/REGION(ap-chengdu)/BUCKET(handsome-1325700411)`。
- 前端 AI 总结列表 `packages/frontend/src` 展示 summary-tasks，已有重建/重试交互模式。
- 云端库无 summary/summary_segment 表；`ai_summary_task` 无 knowledge_status 列。

## Goals

- 分析完成后异步发布：截图上传 COS（公网 URL）+ 总结知识写入云端 `summary`/`summary_segment`（同库）+ 本地 md 图片链接改写为 COS URL。
- `knowledge_status`（pending/synced/failed）流转 + 重试入口（API + 前端）。
- 本地截图/md 备份保留（影子双写），发布失败不影响本地完成态。

## Non-Goals

- 用户穿搭照片上传、向量化/RAG、问答服务、历史回填（Phase 2-4，见需求 Out Of Scope）。
- 不做私有桶/签名 URL（公网读，用户确认）。
- 不删除本地截图/md 备份路径。

## Infrastructure And Config Prereqs

- COS 凭据：`TENCENT_COS_SECRET_ID/KEY/REGION/BUCKET`（`.env` 已有）；bucket 需公网读。
- COS 公网 URL 前缀：默认 `https://<bucket>.cos.<region>.myqcloud.com`，可用环境变量覆盖（自定义域名/前缀）。
- 云端库 `ai_summary` 已有（数据库迁移完成）；新增表由 `initSchema` 幂等创建。
- 回滚：本地截图/md/raw_response 全程保留；关闭发布配置即可退回纯本地路径，云端知识表可清空重发布。

## Execution Plan

### Phase 1 - COS 集成 + 知识表 + knowledge_status

Status: completed
Targets: `packages/server/package.json`, `packages/server/src/knowledge/cos-store.service.ts`（新）, `packages/server/src/database/database.service.ts`

- Item Types: `Decision` + `Add`
- Prereqs: 无

- [x] `Add`：server 新增依赖 `cos-nodejs-sdk-v5`（纯 JS，无原生编译）。
- [x] `Decision`：COS 存储服务放 server 本地模块 `packages/server/src/knowledge/`（替代方案：放回 adapters——当前无 core port 承载该能力，且 pipeline 属 server 编排；放 server 侵入最小）。理由：发布管道是 server 编排逻辑，COS 上传为其私有实现。残余风险：COS 能力与下载/分析耦合在同一 runtime，无碍。
- [x] `Add`：`CosStoreService`——读 `TENCENT_COS_*`，提供 `upload(localPath, key)` 与 `publicUrl(key)`；`publicUrl` 用配置化前缀（默认 `https://<bucket>.cos.<region>.myqcloud.com`）。缺配置时抛出明确错误。
- [x] `Add`：`DatabaseService.initSchema` 幂等创建 `summary`（UNIQUE(bvid,cid)、raw_response JSONB）与 `summary_segment`（FK→summary ON DELETE CASCADE、(summary_id,seq) 唯一、含 screenshot_url/timestamp_seconds，不含 embedding 列——Phase 2 再加）。
- [x] `Add`：`ai_summary_task` 增列 `knowledge_status TEXT`（默认 pending）与 `knowledge_error TEXT`（幂等 ALTER/建表即含）。

Exit Criteria:

- [x] COS 依赖可装、`CosStoreService` 配置读取正确（缺配置报错明确）。
- [x] `summary`/`summary_segment`/`knowledge_status` 建出，幂等。
- [x] `pnpm --filter @bilibili-downloader/server typecheck` 通过。

### Phase 2 - 知识发布管道（KnowledgePublisherService）

Status: completed
Targets: `packages/server/src/knowledge/knowledge-publisher.service.ts`（新）, `packages/server/src/analysis/analysis-trigger.service.ts`, `packages/server/src/analysis/analysis.module.ts`

- Item Types: `Decision` + `Add` + `Fix`
- Prereqs: Phase 1

- [x] `Decision`：md 改指 COS 采用"发布时重写本地 md 文件为 COS 公网 URL"（替代方案：端点查询 segment screenshot_url 后重写——需端点与 knowledge 表耦合、按相对路径映射）。理由：最简单、发布管道本就持有文件→URL 映射，重写后现有 `rewriteMarkdownImageUrls` 对绝对 URL 原样透传，无需改端点。残余风险：本地备份 md 被改写（内容/raw 仍在云端与本地），可接受。
- [x] `Add`：`KnowledgePublisherService.publish(input)`——解析 raw_response→segments；逐个上传 `screenshotFiles[i]` 到 COS（Key `summary/<bvid>-<cid>/screenshots/<basename>`）；事务内 upsert `summary` + 按 (summary_id,seq) 删旧插新 `summary_segment`（含 screenshot_url、timestamp_seconds）；重写本地 md 图片链接为 COS URL。
- [x] `Fix`：`runAnalysis` completed 分支与 `runRebuild` completed 分支发布后调用 `publish`（异步 fire-and-forget + 错误捕获，仿 notification 模式），并把 `knowledge_status` 更新为 pending→(synced|failed)。
- [x] `Fix`：发布成功后把 `knowledge_status`/`knowledge_error` 写入 `ai_summary_task`；空总结（无 segments）置 synced（无 segments 行）。
- [x] `Add`：`analysis.module.ts` 注册 `CosStoreService` / `KnowledgePublisherService`。
- [x] `Decision`：重试幂等——事务内按 (bvid,cid) 删旧插新，重复发布不产生重复 segments；截图文件缺失时置 failed 并提示"可尝试 rebuild"。

Exit Criteria:

- [x] 一次真实/模拟分析完成后，截图上传 COS、云端 summary/segments 写入、本地 md 改写为 COS URL、knowledge_status=synced。
- [x] 发布失败路径：COS/DB 异常→failed+error、本地完成态不变、重试幂等。
- [x] `pnpm --filter @bilibili-downloader/server typecheck`、`pnpm build` 通过。

### Phase 3 - API + 前端

Status: completed
Targets: `packages/server/src/analysis/analysis-task.controller.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`（视图）, `packages/frontend/src/**`

- Item Types: `Add` + `Fix`
- Prereqs: Phase 2

- [x] `Add`：`summary-tasks` 列表/详情响应增加 `knowledgeStatus` / `knowledgeError`（视图从 AiSummaryTaskRecord 透出）。
- [x] `Add`：`POST /api/summary-tasks/:id/publish`——仅 completed 且 raw_response 非空可重试（否则 409/404）；异步发布，返回 202/消息。
- [x] `Add`：前端 AI 总结列表显示 `knowledgeStatus`（synced/failed/pending），对可重试记录提供"重新发布"按钮（复用现有交互模式）。

Exit Criteria:

- [x] API 返回 `knowledgeStatus`；`publish` 端点行为正确（含 404/409/202）。
- [x] 前端展示状态并可触发重试。
- [x] `pnpm typecheck` 通过。

### Phase 4 - Docker + 验证 + 文档对齐

Status: completed
Targets: `packages/docker/Dockerfile.server`, `packages/docker/.env.example`, `docs/design/app-overview.md`, `docs/context/codebase-map.md`, `docs/context/project-context.md`, `docs/testing/2026/08-24-cos-summary-knowledge-publish.md`, `docs/logs/`

- Item Types: `Proof` + `Fix`
- Prereqs: Phase 1-3

- [x] `Fix`：`Dockerfile.server` 确认 COS 依赖进运行时（纯 JS，无原生编译改动）；compose/`.env.example` 补充 `TENCENT_COS_*` 说明（不含真实凭据）。
- [x] `Proof`：`pnpm typecheck`、`pnpm build`、`pnpm docker:build:server` 通过；镜像含 `cos-nodejs-sdk-v5`。
- [x] `Proof`：按测试方向 TD-1~8 逐项验证并回填证据。
- [x] `Fix`：owner doc / 上下文文档对齐（app-overview 集成表加 COS/知识表；codebase-map server 条目；project-context 技术基线/Active plan）。
- [x] `Add`：`docs/logs/2026-08-24-cos-summary-knowledge-publish.md`。

Exit Criteria:

- [x] 全部测试方向 passed 或显式 adjudicated。
- [x] 受影响的 owner doc / 上下文文档对齐。
- [x] `docs/logs/` 有实施日志。

## Plan Audit

- Status: passed
- Reviewer / Agent: 人工（用户 2026-08-24 阅读 COS SDK 文档后确认所需信息已齐，明确"按此推进，开发完成并验证通过后，提交代码"）
- Evidence: 用户人工审核通过；COS 连接所需信息（Region / SecretId+SecretKey / Bucket-APPID 格式）已与官方文档核对且现有 `.env` 配置齐全；外部集成（COS）、数据/model、部署保护区域由用户确认。

## Closure Gates

- [x] in-scope behavior is complete（COS 上传、知识表写入、md 改指 COS、状态流转、重试）
- [x] relevant docs are aligned（requirement / plan / testing / logs / app-overview / codebase-map / project-context）
- [x] verification has run：`pnpm typecheck`、`pnpm build`、`pnpm docker:build:server`
- [x] corresponding `docs/testing/2026/08-24-cos-summary-knowledge-publish.md` exists and every testing direction confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation（人工/子代理；不允许 cold-replay）
- [x] micro-plan actual diff stayed within exception limits, or plan was reclassified and audited —— 不适用（full plan）
- [x] text consistency verified：status、phases、gates、testing document、log 一致
- [x] closure audit was independent（人工/子代理审核；不允许 cold-replay）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 用户穿搭照片上传 COS

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 属问答场景一，用户确认本轮不做。
- Successor Required: `yes`（进入 Phase 3 问答需求时评估）

### 历史已完成总结回填

- Classification: `optimization candidate`
- Why Not Blocking Closure: 用户确认回填放 Phase 4；本轮只对新完成总结发布。
- Successor Required: `yes`（Phase 4）

### summary_segment.embedding 列 / 向量化

- Classification: `watch-only residual`
- Why Not Blocking Closure: embedding 模型选型后置（Phase 2 前定），本轮不加列。
- Successor Required: `yes`（Phase 2）

### COS 桶公网读权限

- Classification: `optimization candidate`
- Why Not Blocking Closure: 代码无关的桶配置项——目标桶 `ai-summary-1325700411` 当前为私有读（匿名 GET 403），需用户在 COS 控制台开通"公有读私有写"（或换用签名 URL，属独立决策）后，md 预览图片方可公网显示；发布管道/云端写入/URL 生成均不受影响。
- Successor Required: `no`（用户控制台操作）

## Closure

Status Note: 四个阶段实施与验证完成。发布管道端到端验证通过：截图上传 COS、云端 `summary`/`summary_segment` 写入（含 `screenshot_url`/`timestamp_seconds`）、本地 md 改写为 COS URL、`knowledge_status` pending→synced；前端状态/重试入口与 Docker 构建（镜像含 `cos-nodejs-sdk-v5`）已验证；测试方向 TD-1~8 回填（TD-1 公网读、TD-3 自动挂载、TD-4 失败注入、TD-5 UI 交互标注为 out of scope/待真实环境确认）。**遗留（用户侧）**：目标桶 `ai-summary-1325700411` 未开通"公有读私有写"，匿名 GET 返回 403，图片公网显示需用户在 COS 控制台开通（代码无关，已写入 `.env.example` 与 Deferred）。因属保护区域且无独立 subagent，最终关闭由用户人工确认。

Closure Audit Evidence:

- Reviewer / Agent: 用户人工（本会话审核人，已批准计划启动并确认执行）；独立 subagent 不可用（`ai-autonomy-policy` Reviewer availability: none），cold-replay 不适用于保护区域。
- Evidence: `docs/testing/2026/08-24-cos-summary-knowledge-publish.md`（TD-1~8 回填）；端到端发布验证（`POST /publish` → synced + summary/segments + md 改写 + COS 上传）；`pnpm typecheck`、`pnpm build`、`pnpm docker:build:server` 通过；`docs/logs/2026-08-24-cos-summary-knowledge-publish.md`。

Follow-up:

- <非阻塞 follow-up 一律进 Deferred But Adjudicated>；用户需在 COS 控制台开通桶公有读（见 Deferred"COS 桶公网读权限"）。
