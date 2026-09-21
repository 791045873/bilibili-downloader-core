# 云端 / NAS 职责重划分与总结内容云端单一真源（设计讨论与裁决记录）

> 状态：**设计讨论 / 裁决记录（umbrella）**。实现按 Phase 拆分：Phase 1a 已实现就绪，见 `docs/requirements/2026-09-17-cloud-read-path-db-render.md`；Phase 1b/2/3/4 各自另立需求与计划。
> 来源：2026-09-17 用户多轮讨论；分析依据 `docs/analysis/2026-09-17-cloud-nas-split-feasibility.md`
> 拟 Owner Docs：`docs/design/app-overview.md`、`docs/architecture/system-baseline.md`、`docs/architecture/module-boundaries.md`
> 保护区：部署（`ask-first`）、数据迁移 / 删除（`ask-first` / `plan-first`）。reviewer availability = `none`，closure 需人工或子代理评审。
> 审计：`docs/audits/2026-09-17-document-audit-cloud-nas-responsibility-split.md`（独立子代理双通道）。裁决：**未达实现就绪门槛**，实现 blocked 直至人工裁决与拆分。
> Owner-doc 冲突（待人工批准更新）：`docs/architecture/2026-07-06-video-analysis-baseline.md:40,69` 现规定"所有部署形态均需配置 `QWEN_VISION_PROXY_URL`，无公网 URL 直连路径"，与本草案云端直连裁决冲突。
> Supersedes（待人工确认）：`2026-09-07-summary-integrity-check.md`（其 Non-Goals 明确不检查视频本体 / COS 对象）、`2026-08-24-cos-summary-knowledge-publish.md`（影子双写 / `knowledge_status` / publish）、`2026-09-01-knowledge-backfill.md`（回填子系统）。
> 相关既有产出：`docs/discussions/2026-08-21-summary-cloud-knowledge-base.md`、`docs/requirements/2026-08-24-cos-summary-knowledge-publish.md`、`docs/requirements/2026-09-07-summary-integrity-check.md`、`docs/requirements/2026-09-01-knowledge-backfill.md`

## Goal

把当前"单个 server 进程同时承担 API、下载、分析、文件管线"的单体部署，拆分为：

- **NAS（数据面 worker）**：视频下载与 FFmpeg 合并、低清分析视频下载、基于本地高清视频的截图、多模态视频分析、总结重建、完整性检查；把总结内容写入云 DB、截图直传 COS。视频原始数据只留在 NAS（体积原因）。
- **云端（控制面 api）**：前端托管、对外读 / 查询 API、知识检索、RAG 问答、设置 / 提示词、下载与分析等动作的触发入队。

并确立**总结内容以云端为唯一真源**（DB 存文本与图片 URL，COS 存图片，NAS 只保留视频），使云端可在不访问 NAS 文件系统的前提下对外提供全部读取与问答能力。

## Background（已形成的关键裁决）

1. **职责边界**：下载 / 合并 / 低清 / 截图 / AI 分析编排 / 重建 / 完整性检查全部留 NAS；读取 / 检索 / 问答 / 拍板 UI 在云端。
2. **总结真源迁移**：云端读取改为从 DB 渲染 md，不再读 NAS 的 md 文件；本地不再保留 md 与原始截图。
3. **图片存储形态**：文本段与 `screenshot_url` 入 DB，**图像字节入 COS**（DB 不存二进制）。
4. **`/summary-files` 静态挂载删除**（其唯一用途是展示 md 内本地截图，改为 DB 渲染后不再需要）。
5. **COS 发布内联**：分析结束即写云 DB + 直传 COS，取消独立的"发布 / 回填 / knowledge_status 影子"子系统（历史数据需一次性回填）。
6. **网络模型**：云端不主动连 NAS；NAS 仅出站。控制走云 DB、数据走 COS。NAS 不需要稳定域名 / IP。
7. **触发即作业**：下载、低清、分析、重建、完整性检查统一为 DB 作业，NAS 认领执行，结果回写 DB。
8. **vision-proxy / LLM 调用角色**：NAS 保留 vision-proxy（本地视频必须经 DashScope Python SDK 读取本地路径）；云端把调用方式改为 **OpenAI 官方 Node.js SDK**（`openai` 包）走同一端点的 OpenAI 兼容面，**所用模型、端点、配置均不变**（人工裁决，2026-09-17：只换调用方式，不换模型 / 端点 / 配置）。
9. **截图策略**：**本地已下载高清优先**；缺失时在 NAS 下载高清后再截图。送 LLM 分析仍用低清优先。

## Supersedes

- `docs/requirements/2026-09-07-summary-integrity-check.md`：其 Non-Goals 明确"不检查视频文件本体、不检查 COS 对象"，本草案 Q5 将二者纳入判据 → **取代其判据范围**。
- `docs/requirements/2026-08-24-cos-summary-knowledge-publish.md`：其"影子双写 + `knowledge_status` + 独立发布"设计，被本草案"分析内联写云 DB + 直传 COS"取代；`knowledge_status` / `knowledge_error` 去留见清理项。
- `docs/requirements/2026-09-01-knowledge-backfill.md`：历史回填已由用户手动完成，本草案**不再实施该子系统**。
- `docs/requirements/2026-09-04-summary-output-relative-path.md`、`2026-09-09-outputfile-relative-anchor.md`：其"相对 `DOWNLOAD_ROOT` 锚点"仍是 **NAS 侧约定**；云端读取不再 join 媒体路径，属对既有语义的收窄，不推翻锚点本身。
- `docs/architecture/2026-07-06-video-analysis-baseline.md`：其"所有部署形态均需 `QWEN_VISION_PROXY_URL`、无公网 URL 直连"被"云端 OpenAI SDK 直连（NAS 仍经代理）"取代 → 需人工批准更新 owner doc。

## Owner-Doc Deltas

- `docs/design/app-overview.md`：用户角色（:20-22，改为 admin / user 两级）、`/summary-files`（:36、:59、:88、:107）、删除语义"只删 DB 不动磁盘 / COS"（:38、:46、:90）、markdown 从本地文件读取、`rebuild` 语义、完整性检查判据、Docker 描述（:12）、含 vision-proxy 配置的 503 语义（:105）、Integration Points 相关行。
- `docs/architecture/system-baseline.md`：Runtime Shape（新增 worker / api 两角色）、Deployment Shape（两镜像）、External Platforms（云端 OpenAI SDK）。
- `docs/architecture/module-boundaries.md`：vision-proxy 职责（云端直连 vs NAS 代理）、新增 `server-common` / `cloud-server` / `nas-worker` 包边界与依赖方向。
- `docs/architecture/2026-07-06-video-analysis-baseline.md`：:40、:69 的"强制代理 / 无直连"表述。
- `docs/design/feature-inventory.md`：知识发布、完整性检查、rebuild 等状态更新。
- `docs/context/codebase-map.md`：新增 worker / 作业表 / 用户系统入口。
- `packages/docker/Dockerfile.server`、`Dockerfile.vision-proxy`、`docker-compose.yml`、`compose.mjs`：两镜像拆分（部署保护区，需 Dockerfile 验证）。

## Architecture Invariants（架构不变量）

- **NAS 仅出站**：NAS 只发起对云 DB、COS、模型服务的出站连接；云端永不拨入 NAS。任何"云主动调 NAS"的需求须重新评审（届时才考虑反向隧道）。
- **控制走 DB，数据走 COS**：跨主机不传控制信息于 HTTP，不传大文件于 DB。
- **真源划分**：总结内容 = 云 DB；截图 = COS；视频 = NAS。
- **云端不 join 媒体路径**：云端一律不从 `DOWNLOAD_ROOT` 解析媒体绝对路径；DB 相对路径锚点仅对 NAS 有效。
- **触发即投递作业**：云端的动作触发写 DB 作业行，不直接调用 NAS。

## Target Package Layout

```
packages/
├── core/               — 不变（领域模型 / usecases / ports）
├── adapters/           — 不变（bilibili / downloader / ffmpeg / fs / llm / embedding / parser）
├── bilibili-api-sdk/   — 不变
├── server-common/      — 新增：DB/Prisma、logging、作业仓储、settings/cookie 读写、共享类型
├── cloud-server/       — 新增：云端 NestJS api（parse / download 创建 / analysis 触发 / chat / knowledge-search / auth / prompt / settings）
├── nas-worker/         — 新增：NAS NestJS worker（下载执行 / 分析引擎 / 截图 / rebuild / repair / integrity / vision-proxy 客户端）
├── frontend/           — 不变（经 HTTP 只连 cloud-server）
├── vision-proxy/       — 不变（只被 nas-worker 调用）
└── docker/             — cloud-server / nas-worker / vision-proxy 三个 Dockerfile
```

- 云端项目**不依赖** ffmpeg / analysis 执行 / vision-proxy 代码（物理杜绝误调用，解决 H2）。
- `nas-worker` 依赖 `adapters` 的 bilibili / ffmpeg / llm / parser。
- `server-common` 的抽离（尤其约 1780 行的 `DatabaseService`）是拆分的前置工作量，须作为独立阶段。

## In Scope

> 建议按 Phase 拆分实施，每 Phase 独立出计划与审计。以下为总体范围。

### Phase 1：读取侧去 NAS 依赖 + 云端单一真源

#### Phase 1a：读取侧 DB 渲染（已拆为独立需求 `docs/requirements/2026-09-17-cloud-read-path-db-render.md`）

- 两个 markdown 端点改为从 DB 渲染（优先 `summary` + `summary_segment`，回退 `ai_summary_task.raw_response`），图片用 `screenshot_url`（COS）。
- **保留** `/summary-files` 挂载；不改 schema、不删数据、不停止写本地 md。

#### Phase 1b：内联发布与本地写入下线

- 分析管线把总结内容写云 DB、截图直传 COS 作为内联步骤；不再写本地 md 作为对外读取源。
- 删除 `/summary-files` 静态挂载与相关读路径（`main.ts`、`summary-dir.ts` 中的重写 helper 按裁剪范围处理）。
- 历史回填已由用户手动完成（`knowledge-backfill` 记为 done）；本期不再实施，保留能力以备重建。

### Phase 2：持久化作业与跨主机触发

- 引入统一 DB 作业抽象（`worker_job`，kind 清单以 Q3 为唯一真源），含认领（claim）、租约（lease）、心跳（heartbeat）、状态与结果。
- 下载任务沿用既有 `claimNextCreatedTask` 模式；为低清 `analysis_sub_task` 与分析触发补等价认领。
- 云端 API 只写作业行；NAS worker 认领执行。
- 以 DB 状态替换进程内互斥（`rebuildingIds`、`summary-integrity` 的 `running`）与进程内触发回调（`download-scheduler.ts` 的 `onTaskFinished → onAnalysisTrigger`）。

### Phase 3：拆分为两个独立 NestJS 项目（cloud-server / nas-worker）

- 抽出共享包 `server-common`（DB/Prisma、logging、作业仓储、settings/cookie、共享类型）。
- 拆出 `cloud-server`（api）与 `nas-worker`（worker）两个独立 NestJS 项目；各自 Dockerfile。
- NAS worker 承担下载 / 分析 / 截图 / 重建 / 完整性检查；云端 api 承担读 / 检索 / 问答 / 设置 / 触发。
- 云端多模态改用 **OpenAI 官方 Node.js SDK**（`openai` 包）直连同一端点；`QwenClient` 仅保留 NAS 经代理路径（本地视频）。
- 截图源改为本地高清优先；远端流截图**降级保留为最后兜底**。

### Phase 4：收敛与清理

- 清理：`ai_summary_task.summary_output`（如不再需要）、`knowledge_status` / `knowledge_error`（内联后是否保留重试态由计划定）、`SUMMARY_BASE_DIR`、`resolveSummaryOutputPath`、`listLocalImageRefs`、`rewriteMarkdownImageUrls`、`rewriteMarkdownImages`，并更新 owner docs。
- 删除/重总结的级联语义收口（COS 截图与 `summary_segment`）。

## Out Of Scope

- 视频上云或云端直接访问 NAS 文件。
- 在线播放、转码、多平台支持（沿用 `project-vision.md` 非目标）。
- 反向隧道 / 内网穿透 / DDNS（仅在出现"云主动调 NAS"需求时另立需求）。
- 托管消息队列（仅当 DB 轮询实时性不足时另议）。
- 公开注册 / 第三方 OAuth / 支付（本期仅引入受控的小用户系统，见 Roles / Permissions）。
- 除以下**有意变更**外，下载 / 分析主流程行为保持不变：截图源优先级（本地高清优先）、`completed` 定义（内容完备）、删除 / 重总结级联、完整性检查判据、Cookie 真源迁移。

## Main User Flows

### 下载

1. 用户在云端前端发起下载 → 云端写下载任务（`created`）。
2. NAS worker 认领（`created → downloading`）→ 执行下载 + FFmpeg 合并 → 写回结果与相对路径。
3. 前端轮询云端读接口查看进度 / 结果。

### AI 总结（含截图与云端入库）

1. 触发（用户或自动）→ 云端写分析作业 / 认领 `ai_summary_task`（`pending`）。
2. NAS 就绪低清视频（必要时下载）→ 送 LLM 分析 → 用**本地高清**截图。
3. NAS 先把 segments（含可空的 `screenshot_url`）写云 DB 并置 `completed`；截图上传独立进行、失败可重试（不阻塞完成）。

### 查看总结 / 问答

1. 云端按 DB 渲染 md（图片用 COS URL）返回前端。
2. QA 检索命中 `summary_segment`，`screenshotUrl` 直接可展示；问答图片由云端**直连**多模态模型（URL 输入）。

### 重试截图（原 rebuild）

1. 云端校验 DB 前置条件（记录存在、`completed`、`raw_response` 非空）→ 写 `screenshot_retry` 作业。
2. NAS worker 认领：用 `raw_response` 的时间戳 + 本地视频重生截图 → 回写 COS 与 `screenshot_url`（**不重跑分析、不重调 LLM**）。

### 重总结（retrigger）

1. 云端写 `analyze` 作业（重跑 LLM）。
2. NAS 执行分析 → 按 `(summary_id, seq)` 原地 upsert 内容与向量（删多余尾行；文本变更时 `embedding = NULL` 再重算）。

### 完整性检查

1. 云端写完整性检查作业 → NAS worker 认领。
2. NAS 读云 DB 全部 `completed` 总结，逐一校验云端记录与 **NAS 视频存在性**（及 COS 截图可达性）。
3. 结果写回 `ai_summary_task` 完整性列；云端读接口 / UI 轮询展示。

## Business Rules

- **单一真源**：总结内容以云 DB 为准；本地 md 与截图为派生物，不承担消费职责。
- **完成门槛 = 内容入库**：`completed` 要求分析文本结果完整写入云 DB（`summary` + `summary_segment`）；截图入 COS **不阻塞完成**，`screenshot_url` 允许暂时为空。
- **截图可重试**：截图失败单独跟踪并提供手动重试作业（从 NAS 本地视频 + 已存时间戳重截并回写 COS），不重跑分析、不重调 LLM。
- **渲染兜底（审计 B1）**：云端渲染优先 `summary` + `summary_segment`；当记录 `completed` 但无 `summary` 行（历史或异常）时，回退 `ai_summary_task.raw_response` 经纯函数 `generateMarkdown` 现渲。
- **可恢复性前提**：只要 `raw_response`（云）与视频（NAS）在，md 与截图均可重建；这是允许删除本地副本的前提条件。
- **幂等**：作业重复投递、下载重试、写库 upsert 均须幂等。
- **截图存储**：截图唯一存储为 COS；`screenshot_url` 允许为空，缺失不影响 `completed`，可手动重试截图补齐。
- **截图源顺序**：本地已下载高清优先 → 缺失时 NAS 下载高清 → 仍不可得时远端流截图兜底；降级须显式标记。送 LLM 分析仍用低清优先。
- **触发与执行分离**：云端只写作业；执行、磁盘校验、ffmpeg 可用性判断在 NAS。
- **不变量优先**：任何方案不得引入云端对 NAS 的入站调用。
- **B站接口调用最小化**：B站接口调用尽量集中在云端（解析 / 触发阶段）；NAS 只保留执行下载所必需、且因时效无法提前解析的调用，并用进程内内存缓存减少重复。**结论（已定）**：非下载类解析全部前移云端；`resource_type` 随作业负载下发（不加列）；创作者 mid / 提示词解析在云端完成并随作业负载下发；NAS 仅剩 **playurl 与字幕** 两类下载固有调用（均不可缓存 / 时效敏感）。不引入云端 B站网关。

## Roles / Permissions

- **引入小用户系统（auth 保护区，需独立 owner doc + 测试）**：
  - 角色：`admin`（内置）与 `user`（普通）。
  - **写操作仅 admin**：下载/分析触发、删除、重建/重试截图、完整性检查、设置/提示词管理、任务/总结管理。
  - **普通用户仅 QA 问答**：创建/查看/删除自己的会话、上传照片、发送消息；以及 QA 回答来源所需的"AI 总结"整页读取（按 `(bvid,cid)`）。
  - 其余读接口（下载列表、总结任务列表、设置等）仅 admin。
- **NAS↔云服务身份**：NAS 不调云端业务 API；直连云 DB 用**独立最小权限 DB 角色**、直连 COS 用专用密钥。无需服务令牌。
- **限流**：本期不做（用户明确先不考虑），保留为后续可选。
- 备注：auth 属保护区域（`plan-first`），reviewer availability = `none` 时实现保持 blocked，需人工/子代理评审。

## Data / Model Impact（需 Prisma contract + migration）

- 新增 `worker_job` 表（字段见 Q3）与 `worker_heartbeat` 表。
- `ai_summary_task`：`summary_output` 去留，`knowledge_status` / `knowledge_error` 去留；**完整性列语义变更**：`integrity_status` 扩为 `complete` / `partial` / `missing`，`integrity_detail` 改为结构化 JSON（`contentMissing[]` / `screenshotMissing[]` / `videoMissing[]`），`integrity_checked_at` 不变。
- **B站登录 Cookie（已定）**：真源为**云数据库的 `app_settings` 表**（云 PostgreSQL 的 key/value 表，见 `contract.prisma:102-107`、`database.service.ts:738-760`，**不是云服务器本地目录**），存 cookie JSON + `updated_at` 版本。各主机读取并物化为本地文件 / 内存串。登录（扫码或手动粘贴）由云端 API 承接并写库；NAS worker 需支持**运行时刷新**（现状为启动时加载一次：`parse.service.ts:50-56`、`download.service.ts:108-114`，且登录后 `ParseService` 的客户端不会自动刷新）。
- **B站接口缓存（已定）**：云端保留 `FileCacheStore`（每缓存项一个本地 JSON 文件，`cacheStore.ts:64-81`）；**NAS 不保留磁盘缓存**——SDK 客户端不传 `cacheStore` 时默认使用 `MemoryCacheStore`（`client.ts:106-108`），即进程内缓存、无磁盘文件。
  - 依据：NAS 的 B站调用主要是 playurl 解析，而 playurl **明确不缓存**（`cacheStore.ts:203-209`）；其余可缓存调用（`getVideoInfo`、字幕列表）频率低，磁盘缓存收益边际。
  - 注意：NAS 并非"只传字节"，仍会调用 B站接口——下载需 info + playurl + 字幕列表；分析触发需 `getVideoInfo` 取创作者 mid（`analysis-trigger.service.ts:334`）；远端截图兜底需 playurl（`analysis-video-resolver.ts:182,253`）。**已定**：mid / 提示词解析移到云端触发阶段，解析好的 `promptId` 随作业负载下发，NAS 不再为此调 B站接口。
- **`resource_type` 前移解析（已定，方案 B）**：云端创建任务时解析 `ResourceType`，**随下载作业负载（`worker_job.payload`）下发**；NAS 执行时直接使用，免去执行期 `resourceParser.parse` 的 B站调用。**不新增 `task.resource_type` 列**；若任务经其他路径执行而 payload 缺失，则由该路径**重新解析后下发**。parse 已实现全部 6 类（video / bangumi / cheese / favorites / user-space / ugc-season，见各 matcher 与 `resource-parser.ts`），故该类型对番剧 / 课堂等非 `video` 资源有实际意义。
- **截图完备性表示（已定）**：由 `summary_segment.screenshot_url` **派生**（全部非空 = 完整；部分为空 = 部分缺失），**不新增 `image_status` 列**；供前端展示与"重试截图"入口。
- 删除 / 重总结的级联语义（`summary` / `summary_segment` / COS 截图）。
- **用户系统（auth 保护区）**：新增 `user` 表（`id/username/password_hash/role/created_at/updated_at`）；`conversation` 新增 `user_id` 外键（QA 会话按用户隔离），**存量会话统一归 admin**（迁移回填）。需独立需求与计划。
- 所有变更须走 `contract → emit → migration plan → db migrate`，additive 优先；删除列属数据保护区，需人工批准。

## API / Integration Impact

- `GET /api/summary-tasks/:id/markdown`、`by-resource/:bvid/:cid/markdown`：改为 DB 渲染；`meta` 由 DB 字段重建（`createdAt` 用 DB 时间近似）。
- 移除 `/summary-files/*` 静态挂载及其前端引用。
- **段 ↔ 截图结构化映射（审计 B3）**：`AnalysisEngine` 对外输出 `segments[].screenshotFiles`（现仅暴露扁平 `screenshotFiles`），内联发布按结构上传 COS 并记录 `screenshot_url`，不再从本地 md 反解。
- `POST /api/summary-tasks/:id/rebuild` 语义收窄为 **"重试截图"**（NAS 作业）：从本地视频按已存时间戳重截、上传 COS、回写 `screenshot_url`，不重跑分析、不重调 LLM；`/retrigger`（重跑分析）与 `POST /api/summary-tasks/integrity-check`（及其 status）语义改为作业投递 + 轮询 DB 状态。
- 下线 `POST /api/summary-tasks/:id/publish`（`analysis-task.controller.ts:401`）与 `POST/GET /api/knowledge/backfill`（`knowledge-backfill.controller.ts`）：内联发布取代前者，回填已完成、能力保留但不作为常规入口。
- 下线 `POST /api/summary-tasks/repair`：截图缺失由 `screenshot_retry`（可批量）承担，视频缺失由下载作业承担。
- 云端 LLM 客户端为新增 `openai` SDK 调用（不扩展 `QwenClient`）；`QwenClient` 仅保留 NAS 经代理模式（本地视频）。
- **云端 LLM 客户端**：引入 `openai` Node.js SDK 作为云端 LLM 调用通道，指向同一端点的 OpenAI 兼容面；模型 / 端点 / 配置不变。需确认兼容基址路径（现原生基址为 `.../api/v1`）、处理 DashScope 专有参数 `enable_thinking` 与 `response_format` 的差异、保留 Base64 禁用约束。
- **NAS 视频路径不适用 OpenAI SDK**：本地视频不受支持，NAS 分析继续经 vision-proxy。
- **配置拆分（仅当需要时）**：`app_settings` 当前仅 `llm.apiKey` / `llm.modelName`；若云端与 NAS 共用同一端点与模型，则无需拆分。
- 部署：拆为 `cloud-server` / `nas-worker` 两个独立 NestJS 项目与镜像（保护区）。

## Edge Cases

- NAS 离线：作业保持 `queued`，UI 按 heartbeat 显示"等待 NAS 上线"。
- NAS 崩溃 / 租约超时：作业可被重新认领；重建非破坏且幂等，完整性检查只读，重跑安全。
- 截图上传失败 / COS 未配置：**不影响 `completed`**；记录 `screenshot_url` 为空（可派生"部分 / 全部缺失"状态），用户可手动重试截图补齐（不重跑分析）。
- 历史存量：回填已由用户手动完成；本地文件在删除前保留为只读备份（见 Local-Copy Lifecycle）。
- 双写漂移：`ai_summary_task.raw_response` 与 `summary.raw_response` 需明确权威，避免不一致。
- 相对路径歧义：云端不得解析媒体相对路径，防止不同主机同名路径指向不同内容。
- 多 worker：认领 + 租约保证单次执行；内存互斥失效问题由 DB 作业取代。
- COS 公网可读（既有设计）：截图 URL 为公网直链（`TENCENT_COS_PUBLIC_URL_PREFIX`），无签名过期问题；多模态直连与前端展示直接使用该 URL。

## Open Questions

阻塞实施与否如下（需人工裁决）：

1. ~~COS 成功是否为分析完成的必要条件？~~ 已修订：`completed` = **内容完备**（分析文本入云 DB），截图入 COS 不阻塞完成且可独立手动重试（见 Q1）。
2. ~~远端流截图：移除还是保留兜底？~~ 已确认：**保留为兜底**（见 Q2）。
3. ~~作业载体~~ 已确认：**新增通用 `worker_job` 表**（字段清单见建议答案 Q3）；`task` / `analysis_sub_task` 继续作业务真源。
4. ~~raw_response 权威表~~ 已确认（见 Q4）：`summary` + `summary_segment` 为消费权威；`ai_summary_task.raw_response` 为恢复 / 重建源；错误只写 `error_message`，`raw_response` 只放模型输出。
5. ~~完整性检查新语义的精确判据与报告格式~~ 已确认（见 Q5）：分内容 / 截图 / 视频三类报告，严重度区分。
6. ~~角色拆分形态~~ 已确认：**拆成两个独立 NestJS 项目**（`cloud-server` / `nas-worker`）+ 新增共享包 `server-common`（见 Q6）。
7. ~~轮询间隔与是否引入 MQ~~ 已确认：**先 DB 轮询**（3–5s，带退避 / 抖动），后续可加 PostgreSQL `LISTEN/NOTIFY`；不引入 MQ。
8. ~~未发布 / 失败总结在云端是否必须可读~~ 已确认（见 Q8）：仅 `completed` 可读；`completed` 仅保证内容完备，图片可缺省并重试。
9. ~~历史回填范围与时机~~ **已由用户手动完成，本期不再实施回填**（保留能力，不作为 Phase 1 门控）。
10. ~~删除 / 重总结级联~~ 已确认（见 Q10）：删除 `summary` 级联 segments + 异步清 COS 前缀；重总结原地 upsert + 删尾行 + 文本变更清向量。
11. ~~对外访问鉴权~~ 已确认（见 Q11）：两个层面——NAS↔云用最小权限服务身份（无云端业务 API 令牌）；前端访问用**小用户系统 + 内置 admin**，仅 admin 可写，普通用户仅 QA 问答。属 auth 保护区，需独立 owner doc + 测试。**限流本期不做。**
12. ~~云端 LLM 提供方 / 模型~~ 已确认：**仅换调用方式（OpenAI Node SDK），模型 / 端点 / 配置不变**。兼容基址已在 `docs/discussions/2026-08-18-proxy-auth-from-db.md` 记录为 `.../compatible-mode/v1`；剩余细节：`enable_thinking`（DashScope 专有）与 `response_format` 在新 SDK 下的替代与语义。
13. ~~NAS 视频分析是否迁离 DashScope~~ 已定（技术必然）：本地视频不属 OpenAI SDK 能力范围，NAS 分析继续经 vision-proxy。
14. ~~Embedding 是否更换~~ 已定：embedding 本就走独立的 OpenAI 兼容客户端（`EmbeddingClient`，`embedding.service.ts:58-63`），本次**不动**，无向量重算。
15. ~~Cookie 真源与登录流程归属~~ 已确认（见 Q15）：登录在云端，写 `app_settings`；NAS 物化 + 版本刷新。**补充（用户）：除扫码登录自动提取 cookie 外，支持用户手动粘贴 cookie。**
16. ~~是否为 NAS 的 B站读接口引入云端网关~~ **已定：不引入网关，采用"前移解析 + `resource_type` 随作业负载下发"。** 云端在创建任务时解析 `ResourceType`（`ResourceParserPort.ts:35-42`）并放入 `worker_job.payload`，NAS 下载执行时直接读取以构造 `resolveStreams`，免去执行期 `resourceParser.parse`（`download.service.ts:528-534`）。结论：NAS 仅保留 playurl 与字幕两类下载固有 B站调用（均不可缓存 / 时效敏感）；未来若出现可缓存的 B站读需求，再评估网关（需服务鉴权，属保护区）。

## 遗留问题（Open Items，2026-09-17）

以下为尚未裁决 / 尚未撰写的项，均为**非阻塞**（不阻塞 Phase 1a 转计划）：

1. ~~H5 — `conversation.user_id` 存量会话归属~~ 已确认：**存量会话统一归 admin**（迁移回填）。
2. ~~H5 — Migration & Rollback 段~~ 已确认并写入 `## Migration & Rollback` 段。
3. ~~目录 / backlog 处置~~ 已确认并执行：**方案 3**——主需求移至 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`，Phase 1a 留 `docs/requirements/` 并登记 backlog。
4. ~~Phase 2 / Phase 3 详细需求未撰写~~ 已撰写：Phase 1b `docs/requirements/2026-09-17-cloud-inline-publish-local-retire.md`、Phase 2 `docs/requirements/2026-09-17-cloud-worker-jobs.md`、Phase 3 `docs/requirements/2026-09-17-cloud-project-split.md`、Phase 4 `docs/requirements/2026-09-17-cloud-cleanup.md`。
5. **Q12 遗留细节**：`enable_thinking`（DashScope 专有）与 `response_format` 在新 OpenAI SDK 下的替代与语义。
6. **H2 已解决**：由"拆成两个独立 NestJS 项目"物理分离，无需再定角色路由白名单。
7. ~~`POST /api/summary-tasks/repair` 的归宿~~ 已确认：**下线该端点**——截图缺失由 `screenshot_retry`（可批量）承担，视频缺失由下载作业承担。
8. ~~完整性检查报告结构~~ 已确认：`integrity_status` 扩为 `complete` / `partial` / `missing`；`integrity_detail` 改为结构化 JSON（`contentMissing[]` / `screenshotMissing[]` / `videoMissing[]`）；视频缺失仅告警。
9. ~~`cos_cleanup` 的 `queue` 路由~~ 已确认：**`api`（云端）**（只调 COS，无需本地文件，且删除应不依赖 NAS 在线）。
10. ~~用户系统实现细节~~ 已拆为独立需求 `docs/requirements/2026-09-17-user-auth.md`（密码哈希算法实现时定）。
11. ~~`project-context.md` active requirement~~ 已确认：**暂不切换**；先闭合 `qa-chat-soft-delete`，Phase 1a 可先出计划（`plan-first`）但不动 active requirement。

## 裁决记录（Decisions Log，2026-09-17）

> 全部 Q1–Q16 已裁决。以下为裁决与理由留档；其中早期"建议"字样仅表示当时为提案，现已定案。

**Q1. `completed` 的定义？截图是否阻塞完成？—— 已确认（2026-09-17 修订）。**
- 裁决：`completed` 表示**分析任务结束，且最终分析结果（文本内容）已完整、正确地存储到云 DB**（`summary` + `summary_segment` 文本与元数据齐全）。**截图是否进入 COS 不阻塞 `completed`**，作为独立、可手动重试的事项。
- 修订说明：此条**取代**先前"图文必须完备硬门"的说法——完成门槛是**内容完备**，不是图文完备。`COS 必需配置` 的结论一并撤销。
- 截图缺失处理：提供独立的**"重试截图"**动作（NAS 作业）：从本地视频按已存 `timestampSeconds` 重新截图、上传 COS、回写 `summary_segment.screenshot_url`，**不重跑分析、不重调 LLM**。`screenshot_url` 允许暂时为空。
- 既有代码需改：失败路径把 `raw_response` 写成错误信息的问题仍需修正（`analysis-trigger.service.ts:529-536`），保证分析内容不因后续步骤失败而丢失。

**Q2. 远端流截图：移除还是保留兜底？—— 已确认：保留为兜底。**
- 裁决（用户，2026-09-17）：远端接图可作为兜底项。
- 建议采集顺序：**本地已下载高清 → （缺失时）NAS 下载高清 → （仍不可得时）远端流截图兜底**；每次降级在结果与日志中显式标记原因。
- 成本提示：为截图而重下高清体积较大；若"仅分析、未下载"的资源较多，可再评估是否把远端兜底提前或主要依赖远端兜底（待观察）。

**Q3. 作业载体：新表还是扩展现有表？—— 已确认：新增 `worker_job` 表。**
- 决策：新增通用 `worker_job` 表作统一执行队列；`task` / `analysis_sub_task` 等继续作为**业务状态真源**。
- 已确认字段清单：

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `id` | bigserial PK | 作业标识 |
| `kind` | text | download / low_res_download / analyze / retrigger / screenshot_retry / integrity_check / cos_cleanup |
| `queue` | text | 目标消费者（默认 `nas`；`cos_cleanup` 为 `api`），用于路由 |
| `ref_type` / `ref_id` | text? / bigint? | 关联领域行（task / ai_summary_task / summary） |
| `dedup_key` | text? | 防重复：同一逻辑工作的**活跃**作业唯一（部分唯一索引） |
| `status` | text | queued / leased / running / succeeded / failed / canceled |
| `priority` | int | 排序 |
| `attempts` / `max_attempts` | int | 重试控制 |
| `available_at` | timestamptz | 退避 / 定时可执行时间 |
| `lease_owner` | text? | 认领的 worker 标识 |
| `lease_expires_at` | timestamptz? | 租约到期（reaper 回收） |
| `heartbeat_at` | timestamptz? | 最近心跳（观测） |
| `payload` | jsonb | 作业输入（promptId、bvid/cid、force 等；不放密钥） |
| `result` | jsonb? | 作业输出摘要 |
| `last_error` | text? | 最近错误 |
| `cancel_requested` | bool | 取消请求（运行中 worker 在安全点检查） |
| `created_at` / `updated_at` / `started_at` / `finished_at` | timestamptz | 审计与观测 |

- 配套：worker 存活单独用 `worker_heartbeat`（`worker_id` / `role` / `last_seen_at` / `meta`），与作业租约分离。
- 索引 / 约束：认领用 `(status, available_at, priority)`；`dedup_key` 部分唯一索引（`WHERE status IN ('queued','leased','running')`）；按消费者查询用 `(queue, status)`。终态作业保留期（如 30 天）后清理（保留期与清理由计划定）。
- **租约 / 心跳机制（`lease_expires_at` + `heartbeat_at`）**：
  1. worker 认领作业时写 `lease_owner=<自己>`、`lease_expires_at=now()+TTL`（如 60s），表示这段时间独占该作业；
  2. 执行期间由**独立定时器**（不能阻塞在下载里）定期续期：更新 `heartbeat_at=now()` 并把 `lease_expires_at` 推后（如每 20s）；
  3. worker 崩溃 → 心跳停止 → 租约到期；
  4. **reaper**（云端或任一 worker）扫描 `status=running/leased` 且 `lease_expires_at<now()` 的作业，重置为 `queued`（`attempts++`），供重新认领。
  - 目的：防止崩溃 worker 让作业永久卡在 running。
  - 约束：TTL 明显大于心跳间隔（约 3 倍余量）。
  - 语义：作业为**至少一次**（可能重复执行），故每个 handler 必须幂等（下载"文件存在即跳过"、COS 同 key 覆盖、DB upsert）。
  - 字段取舍：`lease_expires_at` 为正确性必需；`heartbeat_at` 为观测性字段（可由 `lease_expires_at - TTL` 推导），建议保留以便排障。
  - 与 `worker_heartbeat` 区分：后者是 **worker 级**存活（UI 显示"NAS 在线"），前者是**作业级**存活。
- 理由：统一认领 / 租约 / 心跳入口；`rebuild`/`integrity`/`screenshot_retry` 本无归属表；避免把调度字段混入领域表。代价是双写，由"创建领域行时同事务插入 job、完成时同事务更新两者"缓解。
- 分阶段：Phase 2 先给动作类作业用 job 表；下载可暂时沿用 `claimNextCreatedTask`，稳定后再迁移。

**Q4. `raw_response` 权威表？**
- 建议：**双表并存、职责分离**：`ai_summary_task.raw_response` = 分析记录 + 恢复 / 重建源（不用于渲染）；`summary` + `summary_segment` = 面向消费与 RAG 的权威内容源。
- 理由：`summary_segment` 本就是检索必需；`ai_summary_task` 承载生命周期与完整性列。避免第三份拷贝。
- **错误信息与 `raw_response` 分离（无需新增列）**：`ai_summary_task.error_message` 已存在（`contract.prisma:32`）。修的是**行为**——失败时不得再把错误写进 `raw_response`（现状 `analysis-trigger.service.ts:534`）。语义：
  - LLM 成功、后续步骤失败 → `status=failed`，`raw_response`=模型 JSON，`error_message`=失败原因；
  - LLM 本身失败 → `status=failed`，`raw_response`=NULL，`error_message`=错误。
  - 即 `raw_response` **永远只放模型输出**；`summary.raw_response`（jsonb）同样只接受合法模型 JSON。
- 风险：两处 raw_response 可能漂移；需由管线在同一事务 / 同一步骤写入，并由完整性检查加一致性校验。

**Q5. 完整性检查新判据与报告格式？**
- 建议：范围 = 全部 `completed` 的 `ai_summary_task`；分三类检查并分别报告：
  1. **内容**（云）：`summary` + 至少一条 `summary_segment`（或 raw_response 可解析）；
  2. **截图**（COS）：各 `screenshot_url` 可达（HEAD 200）；
  3. **视频**（NAS）：按该资源的**已完成下载任务**（`findCompletedTaskByBvidAndCid`）的 `outputFile` 相对锚点在本机存在；同资源多条时优先取文件实际存在的一条，全部缺失才判为视频缺失。
- 报告：`integrity_status` 扩为 **`complete` / `partial` / `missing`**（内容缺失→`missing`；内容完整但部分截图缺失→`partial`；全齐→`complete`）；`integrity_detail` 改为**结构化 JSON**（`contentMissing[]` / `screenshotMissing[]` / `videoMissing[]`）；`integrity_checked_at` 不变。**视频缺失仅作告警**（用户可能主动删），不影响整体 verdict。
- 执行：由 NAS worker 认领作业执行（需读本机文件），云端只展示 DB 结果。
- 注意：这是契约级变更（旧判据是"本地 md/截图"），需更新 owner doc 与测试。

**Q6. 角色拆分形态？—— 已确认：拆成两个独立 NestJS 项目。**
- 决策（用户）：**把 NAS 服务与云端服务拆成两个独立的 NestJS 项目**，物理分离，边界更清晰。
- 目标结构（已确认命名）：
  - `packages/cloud-server`（`@bilibili-downloader/cloud-server`）：云端 api。
  - `packages/nas-worker`（`@bilibili-downloader/nas-worker`）：NAS worker。
  - `packages/server-common`（`@bilibili-downloader/server-common`）：**必须新增的共享包**，避免 DB / 日志 / 作业仓储等重复。
  - `packages/core`、`packages/adapters`、`packages/bilibili-api-sdk`、`packages/frontend`、`packages/vision-proxy` 保持不变。
- 依赖方向：`cloud-server` / `nas-worker` → `server-common` → `adapters` → `core`；`frontend` 经 HTTP 只连 `cloud-server`；`nas-worker` 经 HTTP 只连本地 `vision-proxy`。
- 收益：云端项目**不依赖** ffmpeg / analysis 执行 / vision-proxy 代码，从根上杜绝误调用（解决 H2）。
- 代价：需要把共享的 `DatabaseService`（约 1780 行）、Prisma 客户端、logging、作业仓储、settings/cookie 读写抽到 `server-common`；属**较大的重构工作量**，应作为独立阶段。
- 备选（未采纳）：单 `server` 包 + 两入口 / `ROLE` 切换——改动小，但边界弱、云端仍带媒体代码。

**Q7. 轮询间隔与是否引入 MQ？**
- 建议：**先 DB 轮询，3–5 秒，带退避；不引入 MQ。** 可选升级：用 PostgreSQL `LISTEN/NOTIFY`（NAS 出站长连）做近实时唤醒，不新增基础设施。
- 理由：单用户、低作业量；`SKIP LOCKED` / 守卫型 UPDATE 已能保证并发正确；MQ 在此规模是过度设计。

**Q8. 未发布 / 失败总结在云端是否可读？**
- 建议：**仅 `completed` 可读（维持现状 409 语义）**。新总结 `completed` 仅保证**内容完备**；图片可能缺失，缺失时前端缺省展示并提供"重试截图"入口。
- 历史存量：回填完成前可能只有文本、无 COS 图，此时渲染正文、图片缺省；回填后补齐（是否加"图片回填中"占位实现时定）。
- 理由：保持现有错误语义与前端契约；避免为失败态设计额外展示分支。

**Q9. 历史回填？—— 已由用户手动完成，本期不再实施。**
- 历史内容与截图已由用户手动回填；`knowledge-backfill` 子系统记为 `done`（见 `docs/backlog/README.md`）。
- 本草案不再实施回填，保留 `backfill` 能力以备重建；本地文件在删除前保留为只读备份（见 Local-Copy Lifecycle）。

**Q10. 删除 / 重总结级联？（含术语解释）**
- **级联删除**：删除一条 `summary` 时，其关联的多行 `summary_segment` 必须一并删除，否则会变成孤儿行并**继续被 RAG 检索命中**（即被删内容"复活"）。契约中 `summary_segment → summary` 已是 `onDelete: Cascade`（`contract.prisma:162`），DB 层自动生效；问题在于 `DELETE /api/summary-tasks/:id` 目前**只删 `ai_summary_task`，不删对应 `summary`**（两条记录按 `(bvid,cid)` 各自独立），所以需要在删除路径上补"同时删除对应知识记录（其 segments 随之级联）"。
- **异步清 COS 前缀**：COS 是对象存储，**没有关系级联**；截图按固定前缀 `summary/<bvid>-<cid>/screenshots/...` 存放（`knowledge-publisher.service.ts:137`）。删除总结时要**枚举并删除该前缀下的全部对象**。因为对象可能很多、涉及多次网络调用，且重总结后可能残留不再被 `screenshot_url` 引用的旧图，所以采用**后台清理作业异步、幂等执行**，不阻塞 API 请求。
- 建议：删除 `summary`（`summary_segment` 随之级联）+ 投递 COS 前缀清理作业。
- **重总结改为"原地更新"（已认可）**：按 `(summary_id, seq)` upsert（复用唯一键 `summary_segment_summary_id_seq_key`），并删除 `seq >= 新段数` 的多余尾行；不再整体"删旧插新"。理由：① 减少写入与索引抖动；② 与既有"按归一化文本复用向量"逻辑天然契合（文本未变沿用向量，文本变则重算）。**注意**：目前无任何持久化消费方引用 `summary_segment.id`（`reply_sources` 不含 segmentId），故"稳定 ID"仅为前瞻性收益，不作为主要理由。
- `seq` 为位置语义，更新时须整体覆盖 `title/content/timestamp/frame_description/screenshot_url`。
- **向量失效要求（审计 B2）**：文本已变但第二步跳过 / 失败的行必须显式 `embedding = NULL`，否则会保留旧向量，造成文本与向量不匹配并被 pgvector 静默命中。
- COS key 按真实文件名 `segment-{segIdx}-frame-0.jpg`（`ffmpeg-screenshot.ts:91`），未变段无需重传；多余旧 key 交由清理作业回收。COS 层当前**无 list / delete 能力**（`cos-store.service.ts` 仅 `upload`/`uploadBuffer`/`publicUrl`），清理作业需新增封装。
- 注意：这是行为变更 + 数据删除保护区，需人工批准与测试。另需决定：引用该总结的历史 QA 消息来源链接在删除后应表现为 404（当前"无记录即报错、不兜底"语义可复用）。

**Q11. 鉴权 / 限流？—— 已确认（两个层面）。**
- **NAS↔云（服务间）**：NAS 不调云端业务 API；直连云 DB 用独立最小权限 DB 角色、直连 COS 用专用密钥，无需服务令牌。仅在将来引入云端 B站网关或反向隧道时才需服务级鉴权。
- **前端→云端（用户侧）**：引入**小用户系统 + 内置 admin**；仅 admin 可写，普通用户仅 QA 问答。属 auth 保护区，需独立 owner doc + 测试。
- **已确认的子决策（用户 2026-09-17 全部采纳）**：
  1. **用户模型**：独立 `user(id, username, password_hash, role, created_at, updated_at)`；role ∈ {admin, user}（不塞进 `app_settings`）。
  2. **admin 引导**：内置 admin 首次启动由环境变量 `ADMIN_INITIAL_PASSWORD` 播种；不存在则创建、存在则不动；**环境变量缺失时启动告警且不创建默认密码**（需人工配置）。避免硬编码默认密码。
  3. **普通用户来源**：由 admin 创建 / 邀请，不开放自助注册。
  4. **会话机制**：**服务端 session（HttpOnly Cookie）**，可吊销；与现有 B站 扫码登录 cookie 隔离（命名 / 路径分离）。
  5. **QA 会话归属**：`conversation` 新增 `user_id`（外键），QA 会话按用户隔离（现状无归属、所有会话共享；存量会话归属需迁移策略，见 Edge Cases）。
  6. **权限矩阵**：admin = 全部；user = QA（自己的会话 CRUD、照片上传、发消息）+ 按 `(bvid,cid)` 读"AI 总结"整页；其余接口（下载/总结管理、设置、提示词、重建、完整性）仅 admin。
  7. ~~限流~~ 本期不做（用户明确先不考虑），保留为后续可选。
- 备注：本项属 auth 保护区，需**独立需求与计划**（owner doc + 测试）；`reviewer availability=none` 时实现保持 blocked。

**Q15. Cookie 真源、登录归属与 NAS 刷新机制？—— 已确认。**
- 建议：
  1. **登录（扫码）由云端承接**：前端访问云端 API，`AuthController` 的二维码/轮询/用户信息都在云端；确认登录后把 cookie 写入 `app_settings`（含 `updated_at` 版本）。
  2. **支持手动粘贴 cookie（用户补充）**：除扫码自动提取外，提供入口让用户直接粘贴 cookie 字符串，校验后同样写入 `app_settings`（与扫码结果同源、同版本机制）。
  3. **NAS 从云 DB 物化 cookie**：启动时读取并写本地 `COOKIE_FILE_PATH`（或直接内存串）；`DownloadService` 执行下载前按版本检查，变化则 `setCookieString` 重建/刷新 SDK 客户端（现状只在启动加载一次：`download.service.ts:108-114`；且登录后 `ParseService` 客户端不会自动刷新）。
  4. **刷新触发**：每个下载/分析作业开始前比对 DB 的 `updated_at`，另加低频轮询（如 30–60s）兜底。
- 理由：前端在云端、cookie 真源在云 DB，登录放云端最自然；NAS 只做出站读库 + 物化。
- 备选：登录放 NAS（前端需经云端跳转到 NAS，破坏"NAS 仅出站"不变量，不推荐）。

## Local-Copy Lifecycle

顺序不可颠倒（先有替代读取，再停写，最后删除）：

1. **落地云端 DB 渲染**（Phase 1a）：读取侧不再依赖本地 md / 截图。
2. **内联发布**（Phase 1b）：分析结束即写云 DB + 直传 COS，`completed` 保证内容入库。
3. **停止写入本地 md / 截图**（Phase 1b 之后）。
4. **验证通过后删除本地副本**（Phase 4 清理）。
- 历史回填已由用户手动完成；本地文件在验证通过前保留为只读备份。

## Migration & Rollback

- **迁移顺序**：先加**可空列**（`conversation.user_id` 等）→ 单独**幂等回填**（存量会话归 admin）→ 稳定后按需收紧 NOT NULL；新表（`worker_job` / `worker_heartbeat` / `user`）纯 additive、无存量。
- **部署顺序**：先 schema、后代码（additive 下旧代码兼容新 schema）。
- **回滚**：保留 additive 列，**不执行 down migration**；删列留到 Phase 4 且需人工批准（数据保护区）。
- **回填脚本**：幂等（如 `WHERE user_id IS NULL`），可重复执行并报告剩余未完成量。

## Deployment / Config

- **两个独立 NestJS 项目 + 两个镜像**：`cloud-server`（云端：Node，无 ffmpeg / 无 Python）与 `nas-worker`（NAS：Node + ffmpeg + vision-proxy），共享代码抽到 `server-common`。各自独立 Dockerfile。
- **新增 / 变更配置**：`ROLE`、轮询间隔、租约 TTL、心跳间隔、worker 专用最小权限 `DATABASE_URL`（独立角色）、`ADMIN_INITIAL_PASSWORD`、云端多模态 SDK 配置（OpenAI 兼容 baseURL）、COS（截图存储）。
- **vision-proxy 仅 NAS**；云端移除对 `QWEN_VISION_PROXY_URL` 的强制依赖。
- **Cookie**：真源 `app_settings`；NAS 物化 `COOKIE_FILE_PATH` 并支持版本刷新。
- **验证**：`pnpm docker:build`、`docker compose config`（经 `node compose.mjs config`）。

## Testing / Observability

- **测试**：数据层 vitest（作业表认领 / 租约、用户表与权限、删除级联、原地 upsert 与向量失效）；跨主机手工验证清单（NAS 离线排队、租约超时重领、COS 失败可重试、历史渲染兜底、角色路由白名单）。记录于 `docs/testing/`。
- **观测**：作业积压 / 失败计数、worker heartbeat 在线态、租约回收日志、取消语义；日志经 `packages/server/src/logging/` allowlist。
- 现状 E2E 为 `none`（`project-context.md`），跨主机路径必须手工验证。

## Acceptance Criteria

> 每 Phase 的验收在各自计划中细化；以下为总体可测方向。

- [ ] 云端在**无 NAS 文件系统访问**的前提下，可返回总结列表、总结正文（图片为 COS URL）与 QA 来源整页。
- [ ] 总结内容唯一真源为云 DB + COS；本地不再写入 / 依赖 md 与截图作为对外读取源。
- [ ] `/summary-files` 静态挂载已移除（Phase 1b 后），前端无引用残留。
- [ ] 下载、分析、重试截图、完整性检查均以 DB 作业形式触发；NAS 离线时作业排队且状态可见。
- [ ] 进程内互斥 / 回调不再承担跨主机触发；租约超时可恢复。
- [ ] NAS 仅出站：可在无端口映射、无 DDNS 条件下运行。
- [ ] NAS 侧 vision-proxy 保留；云端多模态经 OpenAI Node SDK 直连，不强制要求 `QWEN_VISION_PROXY_URL`。
- [ ] 截图源为本地高清优先；缺失时经 NAS 下载作业补足后再截图。
- [ ] `pnpm typecheck`、`pnpm build` 通过；数据层测试与新增作业测试通过。
- [ ] 部署与数据模型变更经人工批准；相关 owner docs 同步更新。
- [ ] Phase 1a 的验收以独立需求 `docs/requirements/2026-09-17-cloud-read-path-db-render.md` 为准。

## Phasing Note

本草案跨越部署、数据模型与多模块边界，**不应作为单一计划实施**。切片与顺序：
- **Phase 1a** 已拆为独立可实现需求：`docs/requirements/2026-09-17-cloud-read-path-db-render.md`（纯读取侧 DB 渲染 + 云端不 join 媒体路径，无 schema、无删数据）。
- **Phase 1b/2/3/4** 各自另立需求与计划；Phase 2/3 为架构需求另行评审。
- 任何涉及部署与列删除的步骤须走保护区流程（人工 / 子代理批准；reviewer=none 时 blocked）。
