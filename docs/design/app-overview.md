# App Overview

## Purpose

Describe the current supported app-level baseline for `bilibili-downloader-core`.

## Main Surfaces

| Surface | Description | Runtime |
| --- | --- | --- |
| Web Frontend | 登录、视频链接输入、Section 选择器、视频解析、下载列表查看、AI 总结任务列表、穿搭问答、设置管理、用户管理（admin） | React 19 SPA（浏览器） |
| Docker | 容器化部署（Stage D 三镜像已于 2026-10-01 人工批准实施）：Phase 3 后端代码拆分为 `cloud-server`（对外 HTTP + 前端静态 + 作业生产）、`nas-worker`（无对外 HTTP、作业消费执行 + FFmpeg + 本地媒体）与 `vision-proxy`（Python 视觉薄代理，**仅 NAS 侧**读本地视频文件），`packages/docker/` 已落地三镜像布局：`Dockerfile.cloud-server` / `Dockerfile.nas-worker` / `Dockerfile.vision-proxy` 经 `docker-compose.yml` 编排，**`pnpm docker:build` 三镜像构建通过、`docker compose config` 校验通过**。运行约定：外部仅暴露 cloud-server 的 `PORT=3000`；cloud-server 多模态问答经 openai SDK 直连 DashScope compatible-mode（baseURL=`QWEN_API_BASE`，**不依赖 vision-proxy**）；nas-worker 经 compose 网络服务名 `vision-proxy:8765` 调用本地代理（`QWEN_VISION_PROXY_URL`，监听 `0.0.0.0` 但不发布宿主机端口）；nas-worker 无对外端口；共享宿主机 volume（`/download`），`OUTPUT_DIR=/download`、`LOG_DIR=/download/logs`，日志按天轮转保留最近 7 天。**真实 `docker compose up` / 公网暴露属运维上线动作**（公网暴露前须 TLS/反代 + 播种 `ADMIN_INITIAL_PASSWORD` + HTTPS 下 `SESSION_COOKIE_SECURE=true`） | Docker 容器 |

## Primary Navigation Model

- Web 前端：单页应用（SPA），使用 react-router 7 管理页面路由
- 未登录访问任意页面统一跳转登录页 `/sign-in`；顶栏导航项按角色过滤，非 admin 另有路径级门禁（仅 `/qa` 与 `/summary/:bvid/:cid`，其余重定向 `/qa`）
- 顶栏导航响应式：桌面端（≥768px）为横向 logo + 导航项 + 当前用户/退出（admin 另有 B站账号入口）；窄屏（<768px）折叠为汉堡按钮 + 右侧抽屉，抽屉内含全部可见导航项与账号区，选中后关闭
- 壳层以 CSS 变量 `--app-header-h`（顶栏实测高度，含顶部安全区）与 `--vvh`（动态可视视口高度）向页面暴露移动端布局所需的高度信息；需要底部锚定的页面（当前为穿搭问答）自行消费，其余页面保持文档级滚动

## Main User Roles

两级角色，账号由 admin 创建（无自助注册）；内置 `admin` 在服务端启动时按 `ADMIN_INITIAL_PASSWORD` 幂等播种，缺失该配置时不创建任何默认凭据。

- `admin` — 全部功能与写/管理操作（下载、解析、AI 总结与提示词、设置、B站扫码登录、后台作业、用户管理）
- `user` — 仅穿搭问答（会话按本人隔离）与来源视频 AI 总结整页

### 权限矩阵

| 能力面 | admin | user |
| --- | --- | --- |
| 登录 / 登出 / 当前用户（`/api/auth/login`、`/logout`、`/me`） | 公开（无需登录） | 公开（无需登录） |
| 穿搭问答会话与消息（`/api/chat/*`，页面 `/qa`） | 仅本人会话 | 仅本人会话 |
| 来源视频 AI 总结整页（`GET /api/summary-tasks/by-resource/:bvid/:cid/markdown`，页面 `/summary/:bvid/:cid`） | 可用 | 可用 |
| 下载与解析、AI 总结任务与提示词、后台作业、设置、按 id 读总结/原始返回、B站扫码登录 | 可用 | 不可用 |
| 用户管理（`/api/users`、`/api/users/:id/disable`，页面 `/users`） | 可用 | 不可用 |

- 未在上表显式放开的接口一律仅 admin 可用（服务端默认拒绝，技术形态见 `docs/architecture/system-baseline.md`）。
- 未登录返回 401、角色不足返回 403；他人或不存在的问答会话统一返回 404（抗 id 枚举）。
- 既有 `GET /api/auth/qrcode`、`/qrcode/status`、`/user` 属 **B站扫码登录**，与本用户系统只共享路径前缀，现为 admin-only。

## Core Workflows

### 登录与账号（Web）

1. 未登录用户访问任意页面被带到 `/sign-in`，输入 admin 分配的用户名与密码登录；登录失败只提示"用户名或密码不正确"（不区分用户名不存在/密码错/已禁用），同一 IP 连续失败过多时临时拒绝登录并提示稍后再试
2. 登录成功后回跳登录前的路径（无来源时 admin 落首页、`user` 落 `/qa`）
3. 应用启动查 `GET /api/auth/me` 建立会话态；任一接口返回 401 即本地置为未登录并跳登录页（会话过期、被登出或被禁用时同样生效）
4. 顶栏展示当前用户名与"退出"；退出后服务端会话立即失效
5. admin 在"用户管理"页（`/users`）创建用户（用户名 3-32 位字母/数字/`. _ -`，初始密码 8-200 位，角色 `admin`/`user`）、查看用户列表与状态、禁用用户；禁用即吊销该用户全部会话，且不允许禁用自己或最后一个可用 admin

### 单视频下载（Web）

1. 用户在输入区域粘贴 B站视频链接（BV/AV/URL）
2. 跳转到视频解析页面，通过 Section 选择器胶囊按钮切换合集/分P
3. 点击"解析当前页所有视频"一键解析当前 section 内所有视频的清晰度和编码
4. 选择视频清晰度和编码，勾选分P
5. 点击"加入下载队列"，弹出下载子目录确认/修改弹框，确认后加入下载队列，停留在当前页面不跳转
6. 下载任务在队列中依次执行：下载音频流 + 视频流 → FFmpeg 合并 → 输出到服务端下载根目录下的相对子目录
7. 输出文件名可在设置页配置全局模板（占位符 `{title}` `{bvid}` `{cid}` `{quality}` `{codec}`，留空用默认模板）；默认模板 `{title}-{bvid}-{cid}-q{quality}` 保证同名视频互不冲突，同一视频重复入队命中"文件已存在即跳过"
8. 用户可在下载列表中按服务端分页查看下载任务，使用状态过滤缩小当前结果集，查看进度、结果和完成任务的实际输出文件路径，并可对已完成任务直接触发 AI 总结（弹窗中可选择提示词、设为默认或绑定到该创作者）
9. 用户可进入 AI 总结任务列表页，手动刷新查看各资源的 AI 总结状态、本次使用的模型，支持按状态筛选、按视频标题搜索、按更新时间筛选并分页浏览；对 `completed` 记录可点击"查看总结"在弹窗中预览渲染后的 Markdown 总结文档（弹窗顶部展示元数据条：B站原视频链接/模型/生成时间；正文含文字 + 截图插图，插图经 COS 公网 URL 加载、点击可查看大图，弹窗支持全屏切换），并可对失败/已完成的总结记录直接"重新总结"（复用该记录上次使用提示词）、"查看原始"查看模型原始返回
10. 用户可在提示词管理页（AI 提示词）创建/编辑/删除/设为默认 AI 总结提示词，编辑时可一键插入 JSON 格式要求片段；系统内置提示词只读
11. 用户可在下载任务列表页删除下载任务记录，在 AI 总结任务列表页删除 AI 总结记录；删除仅作用于数据库记录，不删除磁盘内容，两条删除路径相互独立

当前基线说明：

- 首页解析成功后会在浏览器 localStorage 记录"最近解析"卡片（仅存入口信息：标题/封面/类型/时间/跳转参数，上限 12 条，去重置顶，可单卡删除）；点击卡片直达对应 `/parse-result/list` 列表页并实时拉取数据，无需重新粘贴链接（`video` 非合集路径会执行 1 次 parseLink）。localStorage 不可用或损坏时静默降级，不影响解析流程。
- 当前“下载列表”页面已切换为服务端分页任务列表，不再以浏览器本地已保存任务 ID 作为页面主数据源。
- 页面支持按下载状态过滤现有任务，并移除了“清空已完成”这种本地隐藏语义。
- 页面轮询仅覆盖当前页中的非终态任务；翻页、切换过滤和切换每页条数时会释放旧轮询集合。
- 删除语义：`DELETE /api/tasks/:id` 删除下载任务及其下载子任务记录；`DELETE /api/summary-tasks/:id` 删除 AI 总结记录。两者都只删数据库记录、不删除磁盘上的媒体文件/总结输出文件，且互不联动；AI 总结记录处于 `pending`/`analyzing` 时禁止删除（返回 409）。
- AI 总结记录的完整性（`integrity_status`: `complete`/`partial`/`missing`、`integrity_detail`、`integrity_checked_at`，NULL=未检查）由用户手动触发的一键检查（`POST /api/summary-tasks/integrity-check`）入队 `integrity_check` 作业写入，**以云端为真源**判定三类（2026-09-30「完整性检查重定义」起，不再读本地 md）：内容（云 DB `summary`+`summary_segment` 完整性：无 summary 头→`contentMissing` "summary"，零 segment→"segments"）、截图（各 `summary_segment.screenshot_url` 非空，缺失收集 seq）、视频（NAS 本地视频文件存在性，task outputFile join `DOWNLOAD_ROOT` 后 node-fs 检查）。定级：内容缺失→`missing`；否则截图缺失→`partial`；否则 `complete`；视频缺失仅告警（记入明细，不单独降级，除非内容也缺失）。`integrity_detail` 为结构化 JSON 文本 `{contentMissing:string[], screenshotMissing:number[], videoMissing:string[]}`；复用既有三列、无 schema 变更，仅写这三列不动 `updated_at`；记录被重新触发/重新构建总结后重置为未检查。AI 总结任务表格"本地文件"列结构化展示（内容/截图 seq/视频告警）、`partial` 显示徽标，旧自由文本值回退原样显示；检查进行中按钮禁用，结束后刷新列表可见最新结果。
- DB 相对路径锚点约定（无例外）：DB 中所有磁盘路径（`task.outputFile`、`analysis_sub_task.output_file`、`ai_summary_task.summary_output` 等）一律相对下载根目录 `DOWNLOAD_ROOT` 存储，读取时 `join(DOWNLOAD_ROOT, value)`，`summary_output` 值自带 `summary/` 段；读侧恒按相对锚点 join，不透传绝对值（2026-09-09 起语义收敛，`/abc` 等根相对形态同样按根拼接；遗留绝对值须由迁移脚本/人工清理）。`SUMMARY_BASE_DIR` 等派生目录仅用于运行时定位/静态挂载，不是 DB 值的锚点。写侧锚点 helper 统一在 `packages/server-common/src/paths/path-anchor.ts`（summary_output 的 summary-dir 同名函数为其委托）。
- 总结内容真源（Phase 1b，2026-09-28 起）：分析成功后**内联**写云 DB（`summary`+`summary_segment`）+ 截图直传 COS；`completed` = 内容入库成功（截图/向量为入库后 best-effort，失败不阻塞完成、`screenshot_url` 可暂空）。**不再写本地 md**、不再写 `summary_output`；`/summary-files` 静态挂载与 `publish`/`backfill`/`repair` 端点已下线；`raw_response` 仅存模型输出（失败不写入，H4）。
- 作业队列驱动的触发链路（Phase 2，2026-09 起；Phase 3 起生产者在 cloud-server、消费执行在 nas-worker）：AI 分析等后台工作改由持久化 `worker_job` 表 + worker 循环执行，触发方一律**入队作业**而非直接调用服务（技术形态见 `docs/architecture/system-baseline.md`）：
  - 高清下载完成 → `onAnalysisTrigger` 钩子入队 `analyze`（`promptId` 于触发时解析并写入 payload）。
  - 一键总结 / 重新总结（retrigger）端点 → 入队 `analyze`。
  - 重试截图（rebuild 端点，语义自 2026-09-30 收窄为纯补截图）→ 入队 `screenshot_retry`。
  - 完整性检查（integrity-check）端点 → 入队 `integrity_check`。
  - 分析需要低清视频时 → `AnalysisVideoResolver` 入队 `low_res_download`（去重键 `lowres:{bvid}:{cid}`）；完成后入队一个跳过 `ai_summary_task` claim 的续跑 `analyze`。
  - 并发/去重由 `worker_job.dedup_key` active-unique 在库层强制，旧的进程内低清队列与内存互斥已移除。
  - 前端状态轮询：作业状态经 `GET /api/worker-jobs`、`GET /api/worker-jobs/:id` 查询；`GET /api/summary-tasks/integrity-check/status` 改为读取 DB 中最新 `integrity_check` 作业状态（不再是内存标志）。
  - 高清 `download` 自 Phase 3（Stage B-4）起已接通 `download` 作业 kind：cloud-server 的下载调度器入队/取消 `worker_job`，nas-worker 的 `download-job-handler` 认领执行（去重键 `download:{bvid}:{cid}`）。
- 说明（2026-09-30「完整性检查重定义」起）：`integrity_check` 执行体已解除 Phase 2 的 gated 状态，经 `SummaryIntegrityService.run()` 执行上述云端为真源的三类判据（内容/截图/视频），不再读取本地 md。

### 穿搭问答（Web）

1. 用户进入"穿搭问答"页（`/qa`）：左侧为会话列表（按最近更新倒序，含历史会话），可新建会话、删除会话（二次确认）；旧会话完整保留，可随时点开回看全部历史并继续讨论（query 重写保证省略式追问与中断前的上下文连续）
2. 场景二（文本）：输入穿搭期望（如"小个子怎么穿显高"）发送 → 服务端向量检索知识库 → 返回带 `[n]` 引用标记的建议正文
3. 场景一（照片）：选择本地穿搭照片（≤3 张）发送 → 服务端压缩一次后存 COS 专属目录 → 多模态模型分析照片产出穿搭描述 → 结合知识库给出针对性建议
4. 回答三段式渲染：正文（Markdown，含 [n] 引用）→ 图片示例区（命中技巧的截图）→ 底部视频注脚（来源视频标题 + B 站 `?t=` 时刻跳转链接 + 每条来源的"AI 总结"入口）；示例图以横向并排缩略图条展示（缩略图不带文字），点击后进入全屏查看大图，可左右滑动或使用内置左右按钮/键盘方向键切换同组图片，全屏时展示该图的技巧标题与说明（单张时无切换）
5. 兜底：知识库无相关内容时回答"知识库暂无相关内容"，无图片与视频注脚，不编造
6. 会话与消息持久化在云端数据库，server 重启后历史完整可回看；发送失败可重试
7. 响应式布局：桌面端为左侧会话列表 + 右侧聊天区双栏；窄屏（<768px）为单列，会话列表收进"会话列表"抽屉（可新建/切换/删除，选中后抽屉关闭，当前会话高亮），底部输入区避让软键盘与设备安全区，照片/发送控件在窄屏以图标呈现（触屏下回车换行、按钮发送；鼠标下回车发送、Shift+回车换行）
8. 来源视频"AI 总结"：每条来源注脚（按 source 条目去重）在保留 B 站链接与技巧标题的同时，追加"AI 总结"整页入口；点击跳转 `/summary/:bvid/:cid`，整页展示该视频完整 AI 总结 Markdown（顶部元数据条 + 正文 + 截图，插图经 COS 公网 URL）。总结按 `(bvid,cid)` 唯一定位 `ai_summary_task`；无记录/未完成/内容不可用时页面只报错，不做兜底或跳转。历史消息来源缺 `bvid/cid` 时不渲染该入口
9. 会话删除为**软删除**：`DELETE /api/chat/conversations/:id` 仅写 `conversation.deleted_at`，不删除任何 `message`（全部保留供后续分析）；已删除会话从会话列表隐藏、对既有接口表现为不存在（404），不提供恢复入口。该会话的消息数据本次仅能通过直接查库读取，不提供分析读取接口
10. 会话按登录用户隔离：列表与读写均按会话归属过滤（admin 同样只见自己的会话，存量会话归内置 admin）；访问他人或不存在的会话统一返回 404

## Key Domain Objects

- `DownloadRequest` — 用户发起的下载请求，包含资源标识和偏好设置
- `VideoResource` — 解析后的视频资源信息（标题、分P、清晰度列表等）
- `Stream` — 视频流或音频流的播放地址和编码信息
- `DownloadArtifact` — 下载完成后的产物（文件路径、大小等）
- `DownloadTask` — 下载任务的状态、进度和结果
- `WorkerJob` — 持久化后台作业（analyze/low_res_download/screenshot_retry/integrity_check/retrigger，预留 cos_cleanup），含 `dedup_key`、`status`、`lease_*`、`attempts` 等，由进程内 worker 领取执行
- `AppUser` — 应用用户（用户名、角色 `admin`/`user`、禁用状态）；问答会话按用户归属隔离

## Integration Points

> 后端自 Phase 3 拆分（2026-09-30）：下表所有对外 HTTP 控制器均由 `cloud-server` 承载（API 路由路径不变，仅宿主由单体 `server` 变为 `cloud-server`）；作业执行侧服务（如 `summary-integrity.service.ts`、AnalysisEngine、ffmpeg 截图、knowledge-publisher、SMTP 通知）在 `nas-worker`；DB 门面 `database.service.ts`、日志与 `WorkerService` 类在 `server-common`；COS 客户端 `CosClient` 在 `adapters`。权威文件路由见 `docs/context/codebase-map.md`，模块边界见 `docs/architecture/module-boundaries.md`。

| Integration | Purpose | Location |
| --- | --- | --- |
| Bilibili API | 获取视频信息、播放流地址 | `packages/adapters/src/bilibili/` |
| FFmpeg | 音视频合并 | 系统依赖（容器内置或宿主机安装） |
| PostgreSQL | 下载任务、AI 总结、设置、提示词持久化（经 `DATABASE_URL` 连接，本地与云端统一使用）；知识库 `summary`/`summary_segment` 同库；后台作业 `worker_job`/`worker_heartbeat` 同库 | `packages/server-common/src/database/database.service.ts` |
| 腾讯云 COS | AI 总结截图对象存储（知识发布管道上传，公网 URL 供 md 预览；经 `TENCENT_COS_*` 配置） | COS 客户端 `CosClient` 在 `packages/adapters/src/cos/`；cloud/nas 各以薄 wrapper `knowledge/cos-store.service.ts` 引用（如 `packages/cloud-server/src/knowledge/cos-store.service.ts`） |
| POST /api/tasks/check | 按 bvid + cid 批量查询任务状态（入队去重） | `packages/cloud-server/src/download/download.controller.ts` |
| POST /api/download | 创建下载任务，必填字段缺失或 outputPath 为空时返回 HTTP 400（BadRequestException）；同 (bvid,cid) 存在排队中/下载中任务或已成功下载且磁盘文件存在时拒绝创建并返回 HTTP 409（ConflictException，中文提示，不落库；2026-09-09 创建层去重，有意推翻 2026-08-10"创建层不去重"决策）；`outputPath` 表示下载根目录下的相对子目录 | `packages/cloud-server/src/download/download.controller.ts`、`packages/cloud-server/src/download/create-dedup.ts` |
| GET /api/download/config | 返回当前服务端下载根目录及来源（环境变量或默认目录） | `packages/cloud-server/src/download/download.controller.ts` |
| GET /api/tasks | 返回服务端分页下载任务列表，支持 `page`、`pageSize`、`statusGroup` 查询参数 | `packages/cloud-server/src/download/download.controller.ts` |
| DELETE /api/tasks/:id | 删除下载任务记录（含 `analysis_sub_task`）；仅删数据库、不动磁盘、不联动删 AI 总结记录 | `packages/cloud-server/src/download/download.controller.ts` |
| POST /api/tasks/:id/summary | 对已完成下载任务直接触发 AI 总结（入队 `analyze` 作业），body 可带 `{ promptId? }`（`promptId` 于触发时解析并写入作业 payload，不覆盖任务创建时设定的 prompt_id）；任务不存在返回 HTTP 404，非已完成任务返回 HTTP 409 | `packages/cloud-server/src/analysis/analysis-task.controller.ts` |
| GET /api/summary-tasks | 返回服务端分页 AI 总结任务列表，支持 `page`、`pageSize`、`status`（all/pending/analyzing/failed/completed）、`search`（标题模糊匹配）、`updatedFrom`/`updatedTo`（更新时间闭区间）查询参数；每条记录含 `modelName`（本次使用模型，模型成功返回时写入）与 `promptId`（本次实际使用提示词），不含 `rawResponse`（原始返回仅入库） | `packages/cloud-server/src/analysis/analysis-task.controller.ts` |
| GET /api/summary-tasks/:id/raw-response | 按 id 返回该记录本次模型交互记录 `{ rawResponse: string \| null }`（成功=模型返回 content 原文；失败=错误信息）；非法 id 返回 400，不存在返回 404 | `packages/cloud-server/src/analysis/analysis-task.controller.ts` |
| POST /api/summary-tasks/:id/retrigger | 对 AI 总结记录按资源重新触发总结（入队 `analyze` 作业，全管线重跑，重新调用 LLM，复用该记录 `prompt_id` 作为显式提示词）；非法 id 返回 400，不存在返回 404，`pending`/`analyzing` 返回 409，无对应成功下载任务返回 409 | `packages/cloud-server/src/analysis/analysis-task.controller.ts` |
| POST /api/summary-tasks/:id/rebuild | 对已完成的 AI 总结记录**重试截图**（入队 `screenshot_retry` 作业；端点路径不变，语义自 2026-09-30 收窄为纯补截图）：仅对 `summary_segment.screenshot_url` 为空且 `timestampSeconds` 已设置的段批量补截图（幂等，已有截图的段不重拍），截图源本地高清视频优先（经该资源最近一次已完成下载），缺失时回退共享 `AnalysisVideoResolver.resolve` 链，ffmpeg 按存储时间戳抽帧后直传 COS（确定性 key `summary/{bvid}-{cid}/screenshots/segment-{seq}-frame-0.jpg`），仅回写 `summary_segment.screenshot_url`；**不调用 LLM**、不改动总结正文/段落内容/向量、不改 `ai_summary_task` 状态；缺视频/缺时间戳/COS 未配置/抽帧或上传失败均安全跳过（记日志、不使整个作业失败），无 schema 变更。触发前置不变：仅 `completed` 且 `raw_response` 非空可触发，非法 id 返回 400，不存在返回 404，非 completed 返回 409，raw 为空返回 409；并发/去重由 `worker_job.dedup_key` active-unique 强制（旧的 `rebuildingIds` 内存互斥已移除）；异步执行，失败不改写记录状态 | `packages/cloud-server/src/analysis/analysis-task.controller.ts` |
| GET /api/summary-tasks/:id/markdown | 按 id 从**云 DB 渲染**该记录的 Markdown 总结文档并返回 `{ content, meta }`（2026-09-28 Phase 1a 起数据来源由本地 md 文件改为 DB，读侧不触盘、不 join 媒体路径）：优先 `summary` + `summary_segment`（按 `seq` 升序），无 `summary` 行时回退 `ai_summary_task.raw_response`；`content` 为剥离 frontmatter 后的正文，图片用 `summary_segment.screenshot_url`（COS 公网 URL），无该 URL 的段不出图、不输出 timestamp；`meta` 含 `title/videoUrl/model/createdAt`，按取值链从 DB 重建（`createdAt` 取 `last_completed_at`/`created_at`，不信任 md 内文）；`summary` 与 `raw_response` 段数漂移时以 `summary` 展示并记非阻塞 warn；非法 id 返回 400，不存在返回 404，非 `completed` 返回 409，内容不可用（无 summary 且 raw_response 空/非法/空数组）返回 409（**有意移除**“文件缺失 404”与“`summary_output` 空 409”两分支） | `packages/cloud-server/src/analysis/analysis-task.controller.ts`、`packages/cloud-server/src/analysis/summary-render.ts` |
| GET /api/summary-tasks/by-resource/:bvid/:cid/markdown | 按视频资源 `(bvid,cid)` 定位 `ai_summary_task` 并从**云 DB 渲染**完整总结 Markdown `{ content, meta }`（语义与按 id 的 markdown 接口一致，供 QA 来源视频"AI 总结"整页消费）；`bvid` 为空或 `cid` 非正整数返回 400，无记录返回 404，非 `completed` 返回 409，内容不可用返回 409；读侧不触盘、不做降级兜底 | `packages/cloud-server/src/analysis/analysis-task.controller.ts`、`packages/cloud-server/src/analysis/summary-render.ts` |
| DELETE /api/summary-tasks/:id | 删除 AI 总结任务记录（仅删数据库、不动磁盘）；非法 id 返回 400，不存在返回 404，`pending`/`analyzing` 返回 409 | `packages/cloud-server/src/analysis/analysis-task.controller.ts` |
| POST /api/summary-tasks/integrity-check | 手动触发一键完整性检查：入队 `integrity_check` 作业，遍历全部 `completed` 的 AI 总结记录，**以云端为真源**逐条判定三类——内容（云 DB `summary`+`summary_segment` 完整性）、截图（各 `summary_segment.screenshot_url` 非空，缺失收集 seq）、视频（NAS 本地视频文件存在性，task outputFile join `DOWNLOAD_ROOT` 后 node-fs 检查）；定级 `integrity_status`：内容缺失→`missing`，否则截图缺失→`partial`，否则 `complete`（视频缺失仅告警、不单独降级）；`integrity_detail` 写结构化 JSON `{contentMissing,screenshotMissing,videoMissing}`；结果（含 `integrity_checked_at`）逐条写回 `ai_summary_task`（不触碰 `updated_at`，复用既有三列、无 schema 变更）；并发/去重由 `worker_job.dedup_key` active-unique 强制；仅手动触发、无自动/定时路径；不读本地 md，截图仅按 `screenshot_url` 非空判定（不做 COS HEAD 探活），视频用 node-fs 检查本地文件；自动修复（screenshot_retry/视频下载）与删本地为后续阶段范围外 | `packages/cloud-server/src/analysis/analysis-task.controller.ts`、`packages/nas-worker/src/analysis/summary-integrity.service.ts` |
| GET /api/summary-tasks/integrity-check/status | 查询完整性检查运行状态 `{ running: boolean }`（供前端轮询），读取 DB 中最新 `integrity_check` 作业状态判定（不再是内存标志） | `packages/cloud-server/src/analysis/analysis-task.controller.ts` |
| GET /api/worker-jobs | 返回 `worker_job` 作业列表（供前端查询后台作业状态） | `packages/cloud-server/src/worker/worker.controller.ts` |
| GET /api/worker-jobs/:id | 按 id 返回单个 `worker_job` 作业状态 | `packages/cloud-server/src/worker/worker.controller.ts` |
| POST /api/worker-jobs/:id/cancel | 取消指定 `worker_job` 作业 | `packages/cloud-server/src/worker/worker.controller.ts` |
| GET/POST/PUT/DELETE /api/analysis/prompts | AI 总结提示词管理：列表（内置排首）、创建、编辑、删除；系统内置不可编辑/删除（409），删除默认（非内置）后默认自动回落内置；`PUT /:id/default` 设为系统默认 | `packages/cloud-server/src/analysis/prompt.controller.ts` |
| GET /api/analysis/prompts/format-snippet | 返回 JSON 格式要求片段 `{ snippet }`（服务端单一来源，前端编辑提示词时"一键插入"） | `packages/cloud-server/src/analysis/prompt.controller.ts` |
| GET/PUT/DELETE /api/analysis/prompts/creator | 创作者绑定：GET ?mid 查询 `{ mid, promptId } | null`；PUT body `{ mid, promptId }` upsert（后写覆盖）；DELETE ?mid 解绑（幂等） | `packages/cloud-server/src/analysis/prompt.controller.ts` |
| POST /api/analysis/trigger | 对 bvid/cid 触发 AI 总结（入队 `analyze` 作业），body 可带 `promptId?`：无任务时创建下载任务并写入 `task.prompt_id`（下载完成后自动总结使用），有任务时透传触发 | `packages/cloud-server/src/analysis/analysis.controller.ts` |
| GET /api/knowledge/search?q=&k= | 向量检索：q 归一化后经 DashScope embedding，pgvector 余弦 top-k（k 缺省 10、限 1–50）；返回 `[{ segmentId, title, content, score, screenshotUrl, frameDescription, videoTitle, videoUrl, timestampSeconds, bvid, cid }]`（`bvid/cid` 为 2026-09-15 新增，供 QA 来源"AI 总结"定位）；q 空或 k 非法返回 400，缺 embedding 配置/调用失败返回 503（不降级关键词搜索）；仅 `embedding_model` 与当前配置一致的 segment 参与 | `packages/cloud-server/src/knowledge/knowledge-search.controller.ts` |
| POST /api/chat/conversations | 创建空问答会话，返回 `{ conversationId }` | `packages/cloud-server/src/chat/chat.controller.ts` |
| GET /api/chat/conversations | 会话列表（按 `updated_at` 倒序，`{ conversations: [{ id, title?, createdAt, updatedAt }] }`） | `packages/cloud-server/src/chat/chat.controller.ts` |
| GET /api/chat/conversations/:id/messages | 会话历史消息（含 user 照片 URL 与 assistant 三段式回答 JSONB）；会话不存在返回 404 | `packages/cloud-server/src/chat/chat.controller.ts` |
| POST /api/chat/conversations/:id/photos | 上传用户穿搭照片（multipart，字段 `photos`，单次 ≤ `PHOTO_MAX_PER_MESSAGE`）：校验格式（jpeg/png/webp）与大小（`PHOTO_MAX_UPLOAD_MB`）→ sharp 压缩（最长边 `PHOTO_MAX_EDGE`、JPEG 质量 `PHOTO_JPEG_QUALITY`、EXIF 方向修正）→ COS 专属目录 `user-photos/<conversationId>/`，返回公网 URL 列表；会话不存在 404，格式/大小非法 400，COS 未配置或上传失败 503 | `packages/cloud-server/src/chat/chat.controller.ts`、`packages/cloud-server/src/chat/chat-photo.service.ts` |
| POST /api/chat/conversations/:id/messages | 发送提问并同步返回回答（非流式）：每轮执行 query 重写（多轮）→ 照片分析（本轮带照片时，失败不降级直接报错）→ pgvector 向量检索（`CHAT_RETRIEVAL_K`，score=余弦相似度 ≥ `CHAT_HIT_THRESHOLD` 判命中）→ 多模态生成（模型=设置页 `llm.modelName`，视觉输入默认开启可 `CHAT_VISUAL_INPUT=false` 关闭）→ 三段式拼装（`{ userMessageId, assistantMessageId, reply: { text（含 [n] 引用）, images, sources } }`）；命中为空时服务端直接回答"知识库暂无相关内容"（不调用生成、不编造）；content 与 photoUrls 同时为空返回 400，缺模型端点/embedding 配置返回 503；生成失败时 assistant 消息落失败态可回看重试；user/assistant 消息均持久化，首条消息自动生成会话标题 | `packages/cloud-server/src/chat/chat.controller.ts`、`packages/cloud-server/src/chat/chat.service.ts` |
| DELETE /api/chat/conversations/:id | 删除会话（级联删消息，前端二次确认）；COS 照片文件不即时删除（统一经 `user-photos/` 专属前缀目录后续清理）；会话不存在返回 404 | `packages/cloud-server/src/chat/chat.controller.ts` |
| POST /api/download | 创建下载任务，body 可带 `promptId?` 写入 `task.prompt_id`；必填字段缺失或 outputPath 为空时返回 HTTP 400（BadRequestException）；同 (bvid,cid) 已有排队中/下载中任务或已下载且磁盘文件存在时返回 HTTP 409；`outputPath` 表示下载根目录下的相对子目录 | `packages/cloud-server/src/download/download.controller.ts` |
| POST /api/auth/login | 用户名口令登录：成功下发会话 cookie 并返回 `{ user }`；凭据无效或用户已禁用统一返回 401（通用文案），同 IP 连续失败达阈值返回 429 + `Retry-After` | `packages/cloud-server/src/user-auth/user-auth.controller.ts` |
| POST /api/auth/logout | 吊销当前会话并清除会话 cookie；无会话时同样返回成功（幂等） | `packages/cloud-server/src/user-auth/user-auth.controller.ts` |
| GET /api/auth/me | 返回当前登录用户 `{ user }`（id/用户名/角色）；未登录返回 401 | `packages/cloud-server/src/user-auth/user-auth.controller.ts` |
| POST /api/users | admin 创建用户（`username`/`password`/`role?`，`role` 缺省 `user`）；用户名或密码不合规返回 400，角色非 admin/user 返回 400，用户名重复返回 409；响应不含口令哈希 | `packages/cloud-server/src/user-auth/users.controller.ts` |
| GET /api/users | admin 查看用户列表（用户名、角色、创建时间、禁用时间） | `packages/cloud-server/src/user-auth/users.controller.ts` |
| POST /api/users/:id/disable | admin 禁用用户并吊销其全部会话（幂等，返回吊销数）；用户不存在返回 404，禁用自己或最后一个可用 admin 返回 403 | `packages/cloud-server/src/user-auth/users.controller.ts` |

## Rule

Keep this file current. If a feature changes the supported app baseline, update this file or a narrower owner doc in the same change.

This file owns current app behavior, surfaces, roles, and workflows.

Do not duplicate long-term product vision from `docs/architecture/project-vision.md` or current milestone scope from `docs/requirements/product-scope.md`.
