# 需求草案：云端 / NAS 职责重划分与总结内容云端单一真源

> 状态：**草稿（draft）**，未激活。需人工确认并拆分为分阶段需求与计划后再实施。
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

## Architecture Invariants（架构不变量）

- **NAS 仅出站**：NAS 只发起对云 DB、COS、模型服务的出站连接；云端永不拨入 NAS。任何"云主动调 NAS"的需求须重新评审（届时才考虑反向隧道）。
- **控制走 DB，数据走 COS**：跨主机不传控制信息于 HTTP，不传大文件于 DB。
- **真源划分**：总结内容 = 云 DB；截图 = COS；视频 = NAS。
- **云端不 join 媒体路径**：云端一律不从 `DOWNLOAD_ROOT` 解析媒体绝对路径；DB 相对路径锚点仅对 NAS 有效。
- **触发即投递作业**：云端的动作触发写 DB 作业行，不直接调用 NAS。

## In Scope

> 建议按 Phase 拆分实施，每 Phase 独立出计划与审计。以下为总体范围。

### Phase 1：读取侧去 NAS 依赖 + 云端单一真源

- 云端总结 md 由 DB 渲染（`summary` + `summary_segment` + `screenshot_url`），替换读取 NAS md 文件与 `/summary-files` 相对链接重写。
- 删除 `/summary-files` 静态挂载与相关读路径（`main.ts`、`summary-dir.ts` 中的重写 helper 按裁剪范围处理）。
- 分析管线把总结内容写云 DB、截图直传 COS 作为内联步骤；不再写本地 md 作为对外读取源。
- 历史本地截图一次性回填 COS（复用现有 backfill 能力），完成后下线该子系统。

### Phase 2：持久化作业与跨主机触发

- 引入 DB 作业抽象（`download` / `low-res` / `analyze` / `retrigger` / `rebuild` / `repair` / `integrity-check`），含认领（claim）、租约（lease）、心跳（heartbeat）、状态与结果。
- 下载任务沿用既有 `claimNextCreatedTask` 模式；为低清 `analysis_sub_task` 与分析触发补等价认领。
- 云端 API 只写作业行；NAS worker 认领执行。
- 以 DB 状态替换进程内互斥（`rebuildingIds`、`summary-integrity` 的 `running`）与进程内触发回调（`download-scheduler.ts` 的 `onTaskFinished → onAnalysisTrigger`）。

### Phase 3：NAS 数据面 / 云端控制面角色拆分

- 同一代码库支持 `worker`（NAS）与 `api`（云端）两种角色（建议环境变量切换入口行为）。
- NAS worker 承担下载 / 分析 / 截图 / 重建 / 完整性检查；云端 api 承担读 / 检索 / 问答 / 设置 / 触发。
- 云端多模态改为 URL 直连（`QwenClient` 双模式：URL 直连 / 经代理）。
- 截图源改为本地高清优先；移除或降级远端流截图路径。

### Phase 4：收敛与清理

- 清理：`ai_summary_task.summary_output`（如不再需要）、`knowledge_status` / `knowledge_error`（内联后是否保留重试态由计划定）、`SUMMARY_BASE_DIR`、`resolveSummaryOutputPath`、`listLocalImageRefs`、`rewriteMarkdownImageUrls`、`rewriteMarkdownImages`，并更新 owner docs。
- 删除/重总结的级联语义收口（COS 截图与 `summary_segment`）。

## Out Of Scope

- 视频上云或云端直接访问 NAS 文件。
- 在线播放、转码、多平台支持（沿用 `project-vision.md` 非目标）。
- 反向隧道 / 内网穿透 / DDNS（仅在出现"云主动调 NAS"需求时另立需求）。
- 托管消息队列（仅当 DB 轮询实时性不足时另议）。
- 账号体系 / 多用户 / 支付。
- 下载与分析的业务语义变更（除截图源优先级外，行为保持不变）。

## Main User Flows

### 下载

1. 用户在云端前端发起下载 → 云端写下载任务（`created`）。
2. NAS worker 认领（`created → downloading`）→ 执行下载 + FFmpeg 合并 → 写回结果与相对路径。
3. 前端轮询云端读接口查看进度 / 结果。

### AI 总结（含截图与云端入库）

1. 触发（用户或自动）→ 云端写分析作业 / 认领 `ai_summary_task`（`pending`）。
2. NAS 就绪低清视频（必要时下载）→ 送 LLM 分析 → 用**本地高清**截图。
3. NAS 把 segments 与 `screenshot_url` 写云 DB、截图传 COS；`ai_summary_task` 置 `completed`。

### 查看总结 / 问答

1. 云端按 DB 渲染 md（图片用 COS URL）返回前端。
2. QA 检索命中 `summary_segment`，`screenshotUrl` 直接可展示；问答图片由云端**直连**多模态模型（URL 输入）。

### 重建

1. 云端校验 DB 前置条件（记录存在、`completed`、`raw_response` 非空）→ 写重建作业。
2. NAS worker 认领：用 `raw_response` + 本地视频重生截图 → 回写 COS 与 DB。

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

## Roles / Permissions

- 当前为单用户工具，无角色 / 权限系统。
- **对外访问将涉及鉴权 / 限流**（受保护区域），本草案不定义具体方案；如公开运营需另立需求（owner doc + 测试）。

## Data / Model Impact（需 Prisma contract + migration）

- 新增作业抽象（新表或扩展现有表，见 Open Questions）与 `worker_heartbeat`。
- `ai_summary_task`：`summary_output` 去留，`knowledge_status` / `knowledge_error` 去留，完整性三列语义变更（判据从"本地 md/截图"改为"云端记录 ↔ NAS 视频 / COS 可达"）。
- **截图完备性表示**：可由 `summary_segment.screenshot_url` 派生（全部非空 = 完整；部分为空 = 部分缺失），或新增 `image_status` 列；供前端展示与"重试截图"入口（实现时定）。
- 删除 / 重总结的级联语义（`summary` / `summary_segment` / COS 截图）。
- 所有变更须走 `contract → emit → migration plan → db migrate`，additive 优先；删除列属数据保护区，需人工批准。

## API / Integration Impact

- `GET /api/summary-tasks/:id/markdown`、`by-resource/:bvid/:cid/markdown`：改为 DB 渲染；`meta` 由 DB 字段重建（`createdAt` 用 DB 时间近似）。
- 移除 `/summary-files/*` 静态挂载及其前端引用。
- **段 ↔ 截图结构化映射（审计 B3）**：`AnalysisEngine` 对外输出 `segments[].screenshotFiles`（现仅暴露扁平 `screenshotFiles`），内联发布按结构上传 COS 并记录 `screenshot_url`，不再从本地 md 反解。
- `POST /api/summary-tasks/:id/rebuild` 语义收窄为 **"重试截图"**（NAS 作业）：从本地视频按已存时间戳重截、上传 COS、回写 `screenshot_url`，不重跑分析、不重调 LLM；`/retrigger`（重跑分析）与 `POST /api/summary-tasks/integrity-check`（及其 status）语义改为作业投递 + 轮询 DB 状态。
- `QwenClient`：新增 URL 直连模式，保留经代理模式。
- **云端 LLM 客户端**：引入 `openai` Node.js SDK 作为云端 LLM 调用通道，指向同一端点的 OpenAI 兼容面；模型 / 端点 / 配置不变。需确认兼容基址路径（现原生基址为 `.../api/v1`）、处理 DashScope 专有参数 `enable_thinking` 与 `response_format` 的差异、保留 Base64 禁用约束。
- **NAS 视频路径不适用 OpenAI SDK**：本地视频不受支持，NAS 分析继续经 vision-proxy。
- **配置拆分（仅当需要时）**：`app_settings` 当前仅 `llm.apiKey` / `llm.modelName`；若云端与 NAS 共用同一端点与模型，则无需拆分。
- 部署：server 与 worker 的镜像 / 入口 / 环境变量拆分（保护区）。

## Edge Cases

- NAS 离线：作业保持 `queued`，UI 按 heartbeat 显示"等待 NAS 上线"。
- NAS 崩溃 / 租约超时：作业可被重新认领；重建非破坏且幂等，完整性检查只读，重跑安全。
- 截图上传失败 / COS 未配置：**不影响 `completed`**；记录 `screenshot_url` 为空（可派生"部分 / 全部缺失"状态），用户可手动重试截图补齐（不重跑分析）。
- 历史存量：未在 COS 的本地截图需回填；回填完成前不得删除本地文件。
- 双写漂移：`ai_summary_task.raw_response` 与 `summary.raw_response` 需明确权威，避免不一致。
- 相对路径歧义：云端不得解析媒体相对路径，防止不同主机同名路径指向不同内容。
- 多 worker：认领 + 租约保证单次执行；内存互斥失效问题由 DB 作业取代。
- 签名 URL 过期：多模态直连要求 COS URL 在模型抓取时仍可访问。

## Open Questions

阻塞实施与否如下（需人工裁决）：

1. ~~COS 成功是否为分析完成的必要条件？~~ 已修订：`completed` = **内容完备**（分析文本入云 DB），截图入 COS 不阻塞完成且可独立手动重试（见 Q1）。
2. ~~远端流截图：移除还是保留兜底？~~ 已确认：**保留为兜底**（见 Q2）。
3. **作业载体**：新建通用 `job` 表，还是扩展现有 `task` / `analysis_sub_task`？租约 / 心跳字段如何设计？
4. **raw_response 权威表**：以 `summary` 为准，`ai_summary_task` 仅存状态与原始返回？是否合并？
5. **完整性检查新语义的精确判据与报告格式**（检查项、verdict 取值、是否允许自动/定时）。
6. **角色拆分形态**：同一镜像以 `ROLE` 环境变量区分，还是拆为独立镜像 / 包？
7. **轮询间隔与是否引入 MQ**（实时性要求）。
8. **未发布 / 失败总结在云端是否必须可读**（影响 DB 渲染兜底范围）。
9. **历史回填范围与时机**（存量总结数量、截图回填窗口）。
10. **删除 / 重总结级联**：COS 截图是否随记录删除；`summary_segment` 与向量的级联。
11. **对外访问鉴权 / 限流**（受保护区域，若公开运营需另立需求）。
12. ~~云端 LLM 提供方 / 模型~~ 已确认：**仅换调用方式（OpenAI Node SDK），模型 / 端点 / 配置不变**。剩余细节：该端点的 OpenAI 兼容基址路径（现原生基址为 `.../api/v1`），以及 `enable_thinking` / `response_format` 在新 SDK 下的替代与语义。
13. ~~NAS 视频分析是否迁离 DashScope~~ 已定（技术必然）：本地视频不属 OpenAI SDK 能力范围，NAS 分析继续经 vision-proxy。
14. ~~Embedding 是否更换~~ 已定：embedding 本就走独立的 OpenAI 兼容客户端（`EmbeddingClient`，`embedding.service.ts:58-63`），本次**不动**，无向量重算。

## 建议答案（AI 提案，待人工裁决）

> 以下为 AI 建议，**不构成裁决**；涉及数据模型、契约、删除、部署的项需人工确认后才能进入计划。

**Q1. `completed` 的定义？截图是否阻塞完成？—— 已确认（2026-09-17 修订）。**
- 裁决：`completed` 表示**分析任务结束，且最终分析结果（文本内容）已完整、正确地存储到云 DB**（`summary` + `summary_segment` 文本与元数据齐全）。**截图是否进入 COS 不阻塞 `completed`**，作为独立、可手动重试的事项。
- 修订说明：此条**取代**先前"图文必须完备硬门"的说法——完成门槛是**内容完备**，不是图文完备。`COS 必需配置` 的结论一并撤销。
- 截图缺失处理：提供独立的**"重试截图"**动作（NAS 作业）：从本地视频按已存 `timestampSeconds` 重新截图、上传 COS、回写 `summary_segment.screenshot_url`，**不重跑分析、不重调 LLM**。`screenshot_url` 允许暂时为空。
- 既有代码需改：失败路径把 `raw_response` 写成错误信息的问题仍需修正（`analysis-trigger.service.ts:529-536`），保证分析内容不因后续步骤失败而丢失。

**Q2. 远端流截图：移除还是保留兜底？—— 已确认：保留为兜底。**
- 裁决（用户，2026-09-17）：远端接图可作为兜底项。
- 建议采集顺序：**本地已下载高清 → （缺失时）NAS 下载高清 → （仍不可得时）远端流截图兜底**；每次降级在结果与日志中显式标记原因。
- 成本提示：为截图而重下高清体积较大；若"仅分析、未下载"的资源较多，可再评估是否把远端兜底提前或主要依赖远端兜底（待观察）。

**Q3. 作业载体：新表还是扩展现有表？**
- 建议：**新增通用 `worker_job` 表作为执行队列**（`kind`、`ref_type`/`ref_id`、`status`、`attempts`、`lease_owner`、`lease_expires_at`、`payload`、`result`、`error`、时间戳）；`task` / `analysis_sub_task` 等继续作为**业务状态真源**，不搬移语义。
- 理由：统一认领/租约/心跳一个入口；`rebuild`/`integrity`/`retrigger` 本无归属表；避免把业务状态复制进队列造成双写。
- 备选（最小改动）：仅给大作业（rebuild/integrity）建 job 表，下载继续用 `claimNextCreatedTask`；代价是两套触发语义。

**Q4. `raw_response` 权威表？**
- 建议：**双表并存、职责分离**：`ai_summary_task.raw_response` = 恢复 / 重建源（不用于渲染）；`summary` + `summary_segment` = 面向消费与 RAG 的权威内容源。
- 理由：`summary_segment` 本就是检索必需；`ai_summary_task` 承载生命周期与完整性列。避免第三份拷贝。
- 风险：两处 raw_response 可能漂移；需由管线在同一事务/同一步骤写入并由计划定义校验。

**Q5. 完整性检查新判据与报告格式？**
- 建议：范围 = 全部 `completed` 的 `ai_summary_task`；分三类检查并分别报告：
  1. **内容**（云）：`summary` + 至少一条 `summary_segment`（或 raw_response 可解析）；
  2. **截图**（COS）：各 `screenshot_url` 可达（HEAD 200）；
  3. **视频**（NAS）：按 `task.outputFile` 相对锚点在本机存在。
- 报告：沿用 `integrity_status`（`complete`/`missing`）+ `integrity_detail`（按类别列出缺失）+ `integrity_checked_at`；**视频缺失单列为告警类别**，避免把"用户有意删除视频"误判为损坏。
- 执行：由 NAS worker 认领作业执行（需读本机文件），云端只展示 DB 结果。
- 注意：这是契约级变更（旧判据是"本地 md/截图"），需更新 owner doc 与测试。

**Q6. 角色拆分形态？**
- 建议：**同代码库、两个镜像入口**：`server-api`（云端：Node，无 ffmpeg / 无 Python）与 `server-worker`（NAS：Node + ffmpeg + vision-proxy）。
- 理由：云端镜像瘦身、减少不必要依赖与攻击面；NAS 保留媒体能力。沿用既有双 Dockerfile 模式。
- 备选：同一镜像以 `ROLE=worker|api|all` 切换，运维更简单，但会把 ffmpeg/Python 带进云端镜像。

**Q7. 轮询间隔与是否引入 MQ？**
- 建议：**先 DB 轮询，3–5 秒，带退避；不引入 MQ。** 可选升级：用 PostgreSQL `LISTEN/NOTIFY`（NAS 出站长连）做近实时唤醒，不新增基础设施。
- 理由：单用户、低作业量；`SKIP LOCKED` / 守卫型 UPDATE 已能保证并发正确；MQ 在此规模是过度设计。

**Q8. 未发布 / 失败总结在云端是否可读？**
- 建议：**仅 `completed` 可读（维持现状 409 语义）**。新总结 `completed` 仅保证**内容完备**；图片可能缺失，缺失时前端缺省展示并提供"重试截图"入口。
- 历史存量：回填完成前可能只有文本、无 COS 图，此时渲染正文、图片缺省；回填后补齐（是否加"图片回填中"占位实现时定）。
- 理由：保持现有错误语义与前端契约；避免为失败态设计额外展示分支。

**Q9. 历史回填范围与时机？**
- 建议：回填全部 `completed` 且 `raw_response` 非空、截图尚未入 COS 的记录；**先计数后执行**，校验 COS 可达与 segment 入库；**回填验证通过前不删除本地文件**（本地只读备份）。
- 时机：Phase 1 内作为门控项，不阻塞开发但阻塞"下线本地文件"。

**Q10. 删除 / 重总结级联？（含术语解释）**
- **级联删除**：删除一条 `summary` 时，其关联的多行 `summary_segment` 必须一并删除，否则会变成孤儿行并**继续被 RAG 检索命中**（即被删内容"复活"）。契约中 `summary_segment → summary` 已是 `onDelete: Cascade`（`contract.prisma:162`），DB 层自动生效；问题在于 `DELETE /api/summary-tasks/:id` 目前**只删 `ai_summary_task`，不删对应 `summary`**（两条记录按 `(bvid,cid)` 各自独立），所以需要在删除路径上补"同时删除对应知识记录（其 segments 随之级联）"。
- **异步清 COS 前缀**：COS 是对象存储，**没有关系级联**；截图按固定前缀 `summary/<bvid>-<cid>/screenshots/...` 存放（`knowledge-publisher.service.ts:137`）。删除总结时要**枚举并删除该前缀下的全部对象**。因为对象可能很多、涉及多次网络调用，且重总结后可能残留不再被 `screenshot_url` 引用的旧图，所以采用**后台清理作业异步、幂等执行**，不阻塞 API 请求。
- 建议：删除 `summary`（`summary_segment` 随之级联）+ 投递 COS 前缀清理作业。
- **重总结改为"原地更新"（已认可）**：按 `(summary_id, seq)` upsert（复用唯一键 `summary_segment_summary_id_seq_key`），并删除 `seq >= 新段数` 的多余尾行；不再整体"删旧插新"。理由：① 减少写入与索引抖动；② 与既有"按归一化文本复用向量"逻辑天然契合（文本未变沿用向量，文本变则重算）。**注意**：目前无任何持久化消费方引用 `summary_segment.id`（`reply_sources` 不含 segmentId），故"稳定 ID"仅为前瞻性收益，不作为主要理由。
- `seq` 为位置语义，更新时须整体覆盖 `title/content/timestamp/frame_description/screenshot_url`。
- **向量失效要求（审计 B2）**：文本已变但第二步跳过 / 失败的行必须显式 `embedding = NULL`，否则会保留旧向量，造成文本与向量不匹配并被 pgvector 静默命中。
- COS key 按真实文件名 `segment-{segIdx}-frame-0.jpg`（`ffmpeg-screenshot.ts:91`），未变段无需重传；多余旧 key 交由清理作业回收。COS 层当前**无 list / delete 能力**（`cos-store.service.ts` 仅 `upload`/`uploadBuffer`/`publicUrl`），清理作业需新增封装。
- 注意：这是行为变更 + 数据删除保护区，需人工批准与测试。另需决定：引用该总结的历史 QA 消息来源链接在删除后应表现为 404（当前"无记录即报错、不兜底"语义可复用）。

**Q11. 对外访问鉴权 / 限流？**
- 建议：**最小可行 = 全部写操作（触发下载/分析/重建/删除）必须鉴权**，读操作可后续收紧；先在反代层做共享令牌 / Basic Auth + 限流，再评估正式账号体系。
- 理由：无鉴权公开写接口会导致 LLM 费用被滥用、磁盘被填满。
- 备注：鉴权属保护区域，需独立 owner doc + 测试；本草案不定义具体方案。

## Acceptance Criteria

> 每 Phase 的验收在各自计划中细化；以下为总体可测方向。

- [ ] 云端在**无 NAS 文件系统访问**的前提下，可返回总结列表、总结正文（图片为 COS URL）与 QA 来源整页。
- [ ] 总结内容唯一真源为云 DB + COS；本地不再写入 / 依赖 md 与截图作为对外读取源。
- [ ] `/summary-files` 静态挂载已移除，前端无引用残留。
- [ ] 下载、分析、重建、完整性检查均以 DB 作业形式触发；NAS 离线时作业排队且状态可见。
- [ ] 进程内互斥 / 回调不再承担跨主机触发；租约超时可恢复。
- [ ] NAS 仅出站：可在无端口映射、无 DDNS 条件下运行。
- [ ] NAS 侧 vision-proxy 保留；云端多模态以 URL 直连，不强制要求 `QWEN_VISION_PROXY_URL`。
- [ ] 截图源为本地高清优先；缺失时经 NAS 下载作业补足后再截图。
- [ ] `pnpm typecheck`、`pnpm build` 通过；数据层测试与新增作业测试通过。
- [ ] 部署与数据模型变更经人工批准；相关 owner docs 同步更新。

## Phasing Note

本草案跨越部署、数据模型与多模块边界，**不应作为单一计划实施**。建议：人工确认后将 Phase 1（读取侧 + 单一真源）先行拆为独立需求与计划；Phase 2/3 作为架构需求另行评审；Phase 4 为清理切片。任何涉及部署与列删除的步骤须走保护区流程。
