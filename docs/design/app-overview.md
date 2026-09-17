# App Overview

## Purpose

Describe the current supported app-level baseline for `bilibili-downloader-core`.

## Main Surfaces

| Surface | Description | Runtime |
| --- | --- | --- |
| Web Frontend | 视频链接输入、Section 选择器、视频解析、下载列表查看、AI 总结任务列表、设置管理 | React 19 SPA（浏览器） |
| Docker | 容器化部署，docker compose 双容器：`server`（Node + 前端静态 + FFmpeg）与 `vision-proxy`（Python 视觉薄代理）各自独立容器并 `restart: unless-stopped`，任一崩溃由 Docker 自动单独重启；两个镜像由独立 Dockerfile（`Dockerfile.server` / `Dockerfile.vision-proxy`）分别构建、相互独立；外部仅暴露 `PORT=3000`，代理经 compose 网络服务名 `vision-proxy:8765` 供 server 调用（URL 经 `QWEN_VISION_PROXY_URL` 环境变量可完全自定义）、监听 `0.0.0.0` 但不发布宿主机端口；两容器共享同一宿主机 volume（`/download`），`OUTPUT_DIR=/download`、`LOG_DIR=/download/logs`，日志按天轮转保留最近 7 天 | Docker 容器 |

## Primary Navigation Model

- Web 前端：单页应用（SPA），使用 react-router 7 管理页面路由
- 顶栏导航响应式：桌面端（≥768px）为横向 logo + 导航项 + 登录入口；窄屏（<768px）折叠为汉堡按钮 + 右侧抽屉，抽屉内含全部导航项与登录入口，选中后关闭
- 壳层以 CSS 变量 `--app-header-h`（顶栏实测高度，含顶部安全区）与 `--vvh`（动态可视视口高度）向页面暴露移动端布局所需的高度信息；需要底部锚定的页面（当前为穿搭问答）自行消费，其余页面保持文档级滚动

## Main User Roles

- 无角色区分（当前为单用户工具，无登录/权限系统）

## Core Workflows

### 单视频下载（Web）

1. 用户在输入区域粘贴 B站视频链接（BV/AV/URL）
2. 跳转到视频解析页面，通过 Section 选择器胶囊按钮切换合集/分P
3. 点击"解析当前页所有视频"一键解析当前 section 内所有视频的清晰度和编码
4. 选择视频清晰度和编码，勾选分P
5. 点击"加入下载队列"，弹出下载子目录确认/修改弹框，确认后加入下载队列，停留在当前页面不跳转
6. 下载任务在队列中依次执行：下载音频流 + 视频流 → FFmpeg 合并 → 输出到服务端下载根目录下的相对子目录
7. 输出文件名可在设置页配置全局模板（占位符 `{title}` `{bvid}` `{cid}` `{quality}` `{codec}`，留空用默认模板）；默认模板 `{title}-{bvid}-{cid}-q{quality}` 保证同名视频互不冲突，同一视频重复入队命中"文件已存在即跳过"
8. 用户可在下载列表中按服务端分页查看下载任务，使用状态过滤缩小当前结果集，查看进度、结果和完成任务的实际输出文件路径，并可对已完成任务直接触发 AI 总结（弹窗中可选择提示词、设为默认或绑定到该创作者）
9. 用户可进入 AI 总结任务列表页，手动刷新查看各资源的 AI 总结状态、本次使用的模型，支持按状态筛选、按视频标题搜索、按更新时间筛选并分页浏览；对 `completed` 记录可点击"查看总结"在弹窗中预览渲染后的 Markdown 总结文档（弹窗顶部展示元数据条：B站原视频链接/模型/生成时间；正文含文字 + 截图插图，插图经 `/summary-files` 静态前缀加载、点击可查看大图，弹窗支持全屏切换），并可对失败/已完成的总结记录直接"重新总结"（复用该记录上次使用提示词）、"查看原始"查看模型原始返回
10. 用户可在提示词管理页（AI 提示词）创建/编辑/删除/设为默认 AI 总结提示词，编辑时可一键插入 JSON 格式要求片段；系统内置提示词只读
11. 用户可在下载任务列表页删除下载任务记录，在 AI 总结任务列表页删除 AI 总结记录；删除仅作用于数据库记录，不删除磁盘内容，两条删除路径相互独立

当前基线说明：

- 首页解析成功后会在浏览器 localStorage 记录"最近解析"卡片（仅存入口信息：标题/封面/类型/时间/跳转参数，上限 12 条，去重置顶，可单卡删除）；点击卡片直达对应 `/parse-result/list` 列表页并实时拉取数据，无需重新粘贴链接（`video` 非合集路径会执行 1 次 parseLink）。localStorage 不可用或损坏时静默降级，不影响解析流程。
- 当前“下载列表”页面已切换为服务端分页任务列表，不再以浏览器本地已保存任务 ID 作为页面主数据源。
- 页面支持按下载状态过滤现有任务，并移除了“清空已完成”这种本地隐藏语义。
- 页面轮询仅覆盖当前页中的非终态任务；翻页、切换过滤和切换每页条数时会释放旧轮询集合。
- 删除语义：`DELETE /api/tasks/:id` 删除下载任务及其下载子任务记录；`DELETE /api/summary-tasks/:id` 删除 AI 总结记录。两者都只删数据库记录、不删除磁盘上的媒体文件/总结输出文件，且互不联动；AI 总结记录处于 `pending`/`analyzing` 时禁止删除（返回 409）。
- AI 总结记录的本地原始内容完整性（`integrity_status`: `complete`/`missing`、`integrity_detail`、`integrity_checked_at`，NULL=未检查）仅由用户手动触发的一键检查（`POST /api/summary-tasks/integrity-check`）写入：只读磁盘判定 md 与相对截图是否存在于当前环境，只读不改文件；记录被重新触发/重新构建总结后重置为未检查。AI 总结任务表格展示"本地文件"列（完整/缺失/未检查，缺失 tooltip 含明细与检查时间），检查进行中按钮禁用，结束后刷新列表可见最新结果。
- DB 相对路径锚点约定（无例外）：DB 中所有磁盘路径（`task.outputFile`、`analysis_sub_task.output_file`、`ai_summary_task.summary_output` 等）一律相对下载根目录 `DOWNLOAD_ROOT` 存储，读取时 `join(DOWNLOAD_ROOT, value)`，`summary_output` 值自带 `summary/` 段；读侧恒按相对锚点 join，不透传绝对值（2026-09-09 起语义收敛，`/abc` 等根相对形态同样按根拼接；遗留绝对值须由迁移脚本/人工清理）。`SUMMARY_BASE_DIR` 等派生目录仅用于运行时定位/静态挂载，不是 DB 值的锚点。写侧锚点 helper 统一在 `packages/server/src/paths/path-anchor.ts`（summary_output 的 summary-dir 同名函数为其委托）。

### 穿搭问答（Web）

1. 用户进入"穿搭问答"页（`/qa`）：左侧为会话列表（按最近更新倒序，含历史会话），可新建会话、删除会话（二次确认）；旧会话完整保留，可随时点开回看全部历史并继续讨论（query 重写保证省略式追问与中断前的上下文连续）
2. 场景二（文本）：输入穿搭期望（如"小个子怎么穿显高"）发送 → 服务端向量检索知识库 → 返回带 `[n]` 引用标记的建议正文
3. 场景一（照片）：选择本地穿搭照片（≤3 张）发送 → 服务端压缩一次后存 COS 专属目录 → 多模态模型分析照片产出穿搭描述 → 结合知识库给出针对性建议
4. 回答三段式渲染：正文（Markdown，含 [n] 引用）→ 图片示例区（命中技巧的截图）→ 底部视频注脚（来源视频标题 + B 站 `?t=` 时刻跳转链接 + 每条来源的"AI 总结"入口）；示例图以横向并排缩略图条展示（缩略图不带文字），点击后进入全屏查看大图，可左右滑动或使用内置左右按钮/键盘方向键切换同组图片，全屏时展示该图的技巧标题与说明（单张时无切换）
5. 兜底：知识库无相关内容时回答"知识库暂无相关内容"，无图片与视频注脚，不编造
6. 会话与消息持久化在云端数据库，server 重启后历史完整可回看；发送失败可重试
7. 响应式布局：桌面端为左侧会话列表 + 右侧聊天区双栏；窄屏（<768px）为单列，会话列表收进"会话列表"抽屉（可新建/切换/删除，选中后抽屉关闭，当前会话高亮），底部输入区避让软键盘与设备安全区，照片/发送控件在窄屏以图标呈现（触屏下回车换行、按钮发送；鼠标下回车发送、Shift+回车换行）
8. 来源视频"AI 总结"：每条来源注脚（按 source 条目去重）在保留 B 站链接与技巧标题的同时，追加"AI 总结"整页入口；点击跳转 `/summary/:bvid/:cid`，整页展示该视频完整 AI 总结 Markdown（顶部元数据条 + 正文 + 截图，插图经 `/summary-files` 静态前缀）。总结按 `(bvid,cid)` 唯一定位 `ai_summary_task`；无记录/未完成/无输出文档/文件缺失时页面只报错，不做兜底或跳转。历史消息来源缺 `bvid/cid` 时不渲染该入口
9. 会话删除为**软删除**：`DELETE /api/chat/conversations/:id` 仅写 `conversation.deleted_at`，不删除任何 `message`（全部保留供后续分析）；已删除会话从会话列表隐藏、对既有接口表现为不存在（404），不提供恢复入口。该会话的消息数据本次仅能通过直接查库读取，不提供分析读取接口

## Key Domain Objects

- `DownloadRequest` — 用户发起的下载请求，包含资源标识和偏好设置
- `VideoResource` — 解析后的视频资源信息（标题、分P、清晰度列表等）
- `Stream` — 视频流或音频流的播放地址和编码信息
- `DownloadArtifact` — 下载完成后的产物（文件路径、大小等）
- `DownloadTask` — 下载任务的状态、进度和结果

## Integration Points

| Integration | Purpose | Location |
| --- | --- | --- |
| Bilibili API | 获取视频信息、播放流地址 | `packages/adapters/src/bilibili/` |
| FFmpeg | 音视频合并 | 系统依赖（容器内置或宿主机安装） |
| PostgreSQL | 下载任务、AI 总结、设置、提示词持久化（经 `DATABASE_URL` 连接，本地与云端统一使用）；知识库 `summary`/`summary_segment` 同库 | `packages/server/src/database/database.service.ts` |
| 腾讯云 COS | AI 总结截图对象存储（知识发布管道上传，公网 URL 供 md 预览；经 `TENCENT_COS_*` 配置） | `packages/server/src/knowledge/cos-store.service.ts` |
| POST /api/tasks/check | 按 bvid + cid 批量查询任务状态（入队去重） | `packages/server/src/download/download.controller.ts` |
| POST /api/download | 创建下载任务，必填字段缺失或 outputPath 为空时返回 HTTP 400（BadRequestException）；同 (bvid,cid) 存在排队中/下载中任务或已成功下载且磁盘文件存在时拒绝创建并返回 HTTP 409（ConflictException，中文提示，不落库；2026-09-09 创建层去重，有意推翻 2026-08-10"创建层不去重"决策）；`outputPath` 表示下载根目录下的相对子目录 | `packages/server/src/download/download.controller.ts`、`packages/server/src/download/create-dedup.ts` |
| GET /api/download/config | 返回当前服务端下载根目录及来源（环境变量或默认目录） | `packages/server/src/download/download.controller.ts` |
| GET /api/tasks | 返回服务端分页下载任务列表，支持 `page`、`pageSize`、`statusGroup` 查询参数 | `packages/server/src/download/download.controller.ts` |
| DELETE /api/tasks/:id | 删除下载任务记录（含 `analysis_sub_task`）；仅删数据库、不动磁盘、不联动删 AI 总结记录 | `packages/server/src/download/download.controller.ts` |
| POST /api/tasks/:id/summary | 对已完成下载任务直接触发 AI 总结，body 可带 `{ promptId? }`（透传触发链路，不覆盖任务创建时设定的 prompt_id）；任务不存在返回 HTTP 404，非已完成任务返回 HTTP 409 | `packages/server/src/analysis/analysis-task.controller.ts` |
| GET /api/summary-tasks | 返回服务端分页 AI 总结任务列表，支持 `page`、`pageSize`、`status`（all/pending/analyzing/failed/completed）、`search`（标题模糊匹配）、`updatedFrom`/`updatedTo`（更新时间闭区间）查询参数；每条记录含 `modelName`（本次使用模型，模型成功返回时写入）与 `promptId`（本次实际使用提示词），不含 `rawResponse`（原始返回仅入库） | `packages/server/src/analysis/analysis-task.controller.ts` |
| GET /api/summary-tasks/:id/raw-response | 按 id 返回该记录本次模型交互记录 `{ rawResponse: string \| null }`（成功=模型返回 content 原文；失败=错误信息）；非法 id 返回 400，不存在返回 404 | `packages/server/src/analysis/analysis-task.controller.ts` |
| POST /api/summary-tasks/:id/retrigger | 对 AI 总结记录按资源重新触发总结（全管线重跑，重新调用 LLM，复用该记录 `prompt_id` 作为显式提示词）；非法 id 返回 400，不存在返回 404，`pending`/`analyzing` 返回 409，无对应成功下载任务返回 409；复用 `AnalysisTriggerService.trigger` 链路 | `packages/server/src/analysis/analysis-task.controller.ts` |
| POST /api/summary-tasks/:id/rebuild | 对已完成的 AI 总结记录用已存储的大模型返回内容（`raw_response`）重建总结报告与截图，**不调用 LLM**；仅 `completed` 且 `raw_response` 非空可触发，非法 id 返回 400，不存在返回 404，非 completed 返回 409，raw 为空返回 409，并发重建返回 409；异步执行，失败不改写记录状态 | `packages/server/src/analysis/analysis-task.controller.ts` |
| GET /api/summary-tasks/:id/markdown | 按 id 读取该记录 `summary_output` 指向的 Markdown 总结文档并返回 `{ content, meta }`；`summary_output` 存相对下载根目录（`DOWNLOAD_ROOT`）的相对路径（POSIX 分隔符；读侧恒按根拼接，2026-09-09 起不再容错透传绝对值），读取时按当前环境根目录拼接：`content` 为剥离 YAML frontmatter 后的正文，相对图片链接已统一重写为 `/summary-files/…` 同源静态路径（绝对链接/根相对/锚点原样保留，`../` 越界不重写，HTML `<img>` 不处理）；`meta` 含 `title/videoUrl/model/createdAt`（frontmatter 缺失或畸形时为空对象，正文原样透传）；非法 id 返回 400，不存在返回 404，非 `completed` 或 `summary_output` 为空返回 409，文件缺失返回 404 | `packages/server/src/analysis/analysis-task.controller.ts` |
| GET /api/summary-tasks/by-resource/:bvid/:cid/markdown | 按视频资源 `(bvid,cid)` 定位 `ai_summary_task` 并返回完整总结 Markdown `{ content, meta }`（语义与按 id 的 markdown 接口一致，供 QA 来源视频"AI 总结"整页消费）；`bvid` 为空或 `cid` 非正整数返回 400，无记录返回 404，非 `completed` 返回 409，`summary_output` 为空返回 409，文件缺失返回 404；不做降级兜底 | `packages/server/src/analysis/analysis-task.controller.ts` |
| DELETE /api/summary-tasks/:id | 删除 AI 总结任务记录（仅删数据库、不动磁盘）；非法 id 返回 400，不存在返回 404，`pending`/`analyzing` 返回 409 | `packages/server/src/analysis/analysis-task.controller.ts` |
| POST /api/summary-tasks/integrity-check | 手动触发一键本地原始内容完整性检查：遍历全部 `completed` 的 AI 总结记录，逐条判定 `summary_output` 指向的 md 与 md 内引用的本地相对截图是否存在于当前环境磁盘，结果（`integrity_status`：`complete`/`missing`、`integrity_detail`：缺失明细（>40 项截断并保留总计数）、`integrity_checked_at`）逐条写回 `ai_summary_task`（不触碰 `updated_at`）；进程内全局互斥，运行中重复触发返回 409；异步执行，仅手动触发、无自动/定时路径；只读磁盘不改文件 | `packages/server/src/analysis/analysis-task.controller.ts`、`packages/server/src/analysis/summary-integrity.service.ts` |
| GET /api/summary-tasks/integrity-check/status | 查询完整性检查运行状态 `{ running: boolean }`（供前端轮询） | `packages/server/src/analysis/analysis-task.controller.ts` |
| POST /api/analysis/run | 视频内容分析正式接口，接收 `AnalysisRequest`（videoPath、subtitlePath?、videoTitle、metadata、screenshotVideoPath?、promptId?），按 metadata.type 校验，调用 AnalysisEngine 生成总结文档；未传 promptId 时按系统默认提示词解析 | `packages/server/src/analysis/analysis.controller.ts` |
| GET/POST/PUT/DELETE /api/analysis/prompts | AI 总结提示词管理：列表（内置排首）、创建、编辑、删除；系统内置不可编辑/删除（409），删除默认（非内置）后默认自动回落内置；`PUT /:id/default` 设为系统默认 | `packages/server/src/analysis/prompt.controller.ts` |
| GET /api/analysis/prompts/format-snippet | 返回 JSON 格式要求片段 `{ snippet }`（服务端单一来源，前端编辑提示词时"一键插入"） | `packages/server/src/analysis/prompt.controller.ts` |
| GET/PUT/DELETE /api/analysis/prompts/creator | 创作者绑定：GET ?mid 查询 `{ mid, promptId } | null`；PUT body `{ mid, promptId }` upsert（后写覆盖）；DELETE ?mid 解绑（幂等） | `packages/server/src/analysis/prompt.controller.ts` |
| POST /api/analysis/trigger | 对 bvid/cid 触发 AI 总结，body 可带 `promptId?`：无任务时创建下载任务并写入 `task.prompt_id`（下载完成后自动总结使用），有任务时透传触发 | `packages/server/src/analysis/analysis.controller.ts` |
| POST /api/knowledge/backfill | 手动触发一次历史总结知识回填：后台批量（并发 2）把 `completed` + `raw_response` 非空 + 非 synced 的总结逐条经发布管道入库；无可回填返回 `{ total: 0 }`，否则返回 `{ message, total }` 并立即返回（fire-and-forget）；运行中重复触发返回 409 | `packages/server/src/knowledge/knowledge-backfill.controller.ts` |
| GET /api/knowledge/backfill | 查询回填批次进度：`{ running, total, synced, skipped, failed, failures[{ summaryTaskId, error }] }`；批次完成后回到 idle 且计数保留到下次触发 | `packages/server/src/knowledge/knowledge-backfill.controller.ts` |
| GET /api/knowledge/search?q=&k= | 向量检索：q 归一化后经 DashScope embedding，pgvector 余弦 top-k（k 缺省 10、限 1–50）；返回 `[{ segmentId, title, content, score, screenshotUrl, frameDescription, videoTitle, videoUrl, timestampSeconds, bvid, cid }]`（`bvid/cid` 为 2026-09-15 新增，供 QA 来源"AI 总结"定位）；q 空或 k 非法返回 400，缺 embedding 配置/调用失败返回 503（不降级关键词搜索）；仅 `embedding_model` 与当前配置一致的 segment 参与 | `packages/server/src/knowledge/knowledge-search.controller.ts` |
| POST /api/chat/conversations | 创建空问答会话，返回 `{ conversationId }` | `packages/server/src/chat/chat.controller.ts` |
| GET /api/chat/conversations | 会话列表（按 `updated_at` 倒序，`{ conversations: [{ id, title?, createdAt, updatedAt }] }`） | `packages/server/src/chat/chat.controller.ts` |
| GET /api/chat/conversations/:id/messages | 会话历史消息（含 user 照片 URL 与 assistant 三段式回答 JSONB）；会话不存在返回 404 | `packages/server/src/chat/chat.controller.ts` |
| POST /api/chat/conversations/:id/photos | 上传用户穿搭照片（multipart，字段 `photos`，单次 ≤ `PHOTO_MAX_PER_MESSAGE`）：校验格式（jpeg/png/webp）与大小（`PHOTO_MAX_UPLOAD_MB`）→ sharp 压缩（最长边 `PHOTO_MAX_EDGE`、JPEG 质量 `PHOTO_JPEG_QUALITY`、EXIF 方向修正）→ COS 专属目录 `user-photos/<conversationId>/`，返回公网 URL 列表；会话不存在 404，格式/大小非法 400，COS 未配置或上传失败 503 | `packages/server/src/chat/chat.controller.ts`、`packages/server/src/chat/chat-photo.service.ts` |
| POST /api/chat/conversations/:id/messages | 发送提问并同步返回回答（非流式）：每轮执行 query 重写（多轮）→ 照片分析（本轮带照片时，失败不降级直接报错）→ pgvector 向量检索（`CHAT_RETRIEVAL_K`，score=余弦相似度 ≥ `CHAT_HIT_THRESHOLD` 判命中）→ 多模态生成（模型=设置页 `llm.modelName`，视觉输入默认开启可 `CHAT_VISUAL_INPUT=false` 关闭）→ 三段式拼装（`{ userMessageId, assistantMessageId, reply: { text（含 [n] 引用）, images, sources } }`）；命中为空时服务端直接回答"知识库暂无相关内容"（不调用生成、不编造）；content 与 photoUrls 同时为空返回 400，缺 LLM/embedding/vision-proxy 配置返回 503；生成失败时 assistant 消息落失败态可回看重试；user/assistant 消息均持久化，首条消息自动生成会话标题 | `packages/server/src/chat/chat.controller.ts`、`packages/server/src/chat/chat.service.ts` |
| DELETE /api/chat/conversations/:id | 删除会话（级联删消息，前端二次确认）；COS 照片文件不即时删除（统一经 `user-photos/` 专属前缀目录后续清理）；会话不存在返回 404 | `packages/server/src/chat/chat.controller.ts` |
| GET /summary-files/* | 摘要文档根目录（下载根目录 `OUTPUT_DIR` 下的 `summary/` 子目录，随下载目录一起持久化）静态挂载，供前端预览 md 内相对插图；本地 dev 由 Vite 代理 `/summary-files` 转发，容器内与前端同源 | `packages/server/src/main.ts` |
| POST /api/download | 创建下载任务，body 可带 `promptId?` 写入 `task.prompt_id`；必填字段缺失或 outputPath 为空时返回 HTTP 400（BadRequestException）；同 (bvid,cid) 已有排队中/下载中任务或已下载且磁盘文件存在时返回 HTTP 409；`outputPath` 表示下载根目录下的相对子目录 | `packages/server/src/download/download.controller.ts` |

## Rule

Keep this file current. If a feature changes the supported app baseline, update this file or a narrower owner doc in the same change.

This file owns current app behavior, surfaces, roles, and workflows.

Do not duplicate long-term product vision from `docs/architecture/project-vision.md` or current milestone scope from `docs/requirements/product-scope.md`.
