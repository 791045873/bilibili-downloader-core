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

- 当前“下载列表”页面已切换为服务端分页任务列表，不再以浏览器本地已保存任务 ID 作为页面主数据源。
- 页面支持按下载状态过滤现有任务，并移除了“清空已完成”这种本地隐藏语义。
- 页面轮询仅覆盖当前页中的非终态任务；翻页、切换过滤和切换每页条数时会释放旧轮询集合。
- 删除语义：`DELETE /api/tasks/:id` 删除下载任务及其下载子任务记录；`DELETE /api/summary-tasks/:id` 删除 AI 总结记录。两者都只删数据库记录、不删除磁盘上的媒体文件/总结输出文件，且互不联动；AI 总结记录处于 `pending`/`analyzing` 时禁止删除（返回 409）。

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
| PostgreSQL | 下载任务、AI 总结、设置、提示词持久化（经 `DATABASE_URL` 连接，本地与云端统一使用） | `packages/server/src/database/database.service.ts` |
| POST /api/tasks/check | 按 bvid + cid 批量查询任务状态（入队去重） | `packages/server/src/download/download.controller.ts` |
| POST /api/download | 创建下载任务，必填字段缺失或 outputPath 为空时返回 HTTP 400（BadRequestException）；`outputPath` 表示下载根目录下的相对子目录 | `packages/server/src/download/download.controller.ts` |
| GET /api/download/config | 返回当前服务端下载根目录及来源（环境变量或默认目录） | `packages/server/src/download/download.controller.ts` |
| GET /api/tasks | 返回服务端分页下载任务列表，支持 `page`、`pageSize`、`statusGroup` 查询参数 | `packages/server/src/download/download.controller.ts` |
| DELETE /api/tasks/:id | 删除下载任务记录（含 `analysis_sub_task`）；仅删数据库、不动磁盘、不联动删 AI 总结记录 | `packages/server/src/download/download.controller.ts` |
| POST /api/tasks/:id/summary | 对已完成下载任务直接触发 AI 总结，body 可带 `{ promptId? }`（透传触发链路，不覆盖任务创建时设定的 prompt_id）；任务不存在返回 HTTP 404，非已完成任务返回 HTTP 409 | `packages/server/src/analysis/analysis-task.controller.ts` |
| GET /api/summary-tasks | 返回服务端分页 AI 总结任务列表，支持 `page`、`pageSize`、`status`（all/pending/analyzing/failed/completed）、`search`（标题模糊匹配）、`updatedFrom`/`updatedTo`（更新时间闭区间）查询参数；每条记录含 `modelName`（本次使用模型，模型成功返回时写入）与 `promptId`（本次实际使用提示词），不含 `rawResponse`（原始返回仅入库） | `packages/server/src/analysis/analysis-task.controller.ts` |
| GET /api/summary-tasks/:id/raw-response | 按 id 返回该记录本次模型交互记录 `{ rawResponse: string \| null }`（成功=模型返回 content 原文；失败=错误信息）；非法 id 返回 400，不存在返回 404 | `packages/server/src/analysis/analysis-task.controller.ts` |
| POST /api/summary-tasks/:id/retrigger | 对 AI 总结记录按资源重新触发总结（全管线重跑，重新调用 LLM，复用该记录 `prompt_id` 作为显式提示词）；非法 id 返回 400，不存在返回 404，`pending`/`analyzing` 返回 409，无对应成功下载任务返回 409；复用 `AnalysisTriggerService.trigger` 链路 | `packages/server/src/analysis/analysis-task.controller.ts` |
| POST /api/summary-tasks/:id/rebuild | 对已完成的 AI 总结记录用已存储的大模型返回内容（`raw_response`）重建总结报告与截图，**不调用 LLM**；仅 `completed` 且 `raw_response` 非空可触发，非法 id 返回 400，不存在返回 404，非 completed 返回 409，raw 为空返回 409，并发重建返回 409；异步执行，失败不改写记录状态 | `packages/server/src/analysis/analysis-task.controller.ts` |
| GET /api/summary-tasks/:id/markdown | 按 id 读取该记录 `summary_output` 指向的 Markdown 总结文档并返回 `{ content, meta }`：`content` 为剥离 YAML frontmatter 后的正文，相对图片链接已统一重写为 `/summary-files/…` 同源静态路径（绝对链接/根相对/锚点原样保留，`../` 越界不重写，HTML `<img>` 不处理）；`meta` 含 `title/videoUrl/model/createdAt`（frontmatter 缺失或畸形时为空对象，正文原样透传）；非法 id 返回 400，不存在返回 404，非 `completed` 或 `summary_output` 为空返回 409，文件缺失返回 404 | `packages/server/src/analysis/analysis-task.controller.ts` |
| DELETE /api/summary-tasks/:id | 删除 AI 总结任务记录（仅删数据库、不动磁盘）；非法 id 返回 400，不存在返回 404，`pending`/`analyzing` 返回 409 | `packages/server/src/analysis/analysis-task.controller.ts` |
| POST /api/analysis/run | 视频内容分析正式接口，接收 `AnalysisRequest`（videoPath、subtitlePath?、videoTitle、metadata、screenshotVideoPath?、promptId?），按 metadata.type 校验，调用 AnalysisEngine 生成总结文档；未传 promptId 时按系统默认提示词解析 | `packages/server/src/analysis/analysis.controller.ts` |
| GET/POST/PUT/DELETE /api/analysis/prompts | AI 总结提示词管理：列表（内置排首）、创建、编辑、删除；系统内置不可编辑/删除（409），删除默认（非内置）后默认自动回落内置；`PUT /:id/default` 设为系统默认 | `packages/server/src/analysis/prompt.controller.ts` |
| GET /api/analysis/prompts/format-snippet | 返回 JSON 格式要求片段 `{ snippet }`（服务端单一来源，前端编辑提示词时"一键插入"） | `packages/server/src/analysis/prompt.controller.ts` |
| GET/PUT/DELETE /api/analysis/prompts/creator | 创作者绑定：GET ?mid 查询 `{ mid, promptId } | null`；PUT body `{ mid, promptId }` upsert（后写覆盖）；DELETE ?mid 解绑（幂等） | `packages/server/src/analysis/prompt.controller.ts` |
| POST /api/analysis/trigger | 对 bvid/cid 触发 AI 总结，body 可带 `promptId?`：无任务时创建下载任务并写入 `task.prompt_id`（下载完成后自动总结使用），有任务时透传触发 | `packages/server/src/analysis/analysis.controller.ts` |
| GET /summary-files/* | 摘要文档根目录（`cwd/summaryDir`）静态挂载，供前端预览 md 内相对插图；本地 dev 由 Vite 代理 `/summary-files` 转发，容器内与前端同源 | `packages/server/src/main.ts` |
| POST /api/download | 创建下载任务，body 可带 `promptId?` 写入 `task.prompt_id`；必填字段缺失或 outputPath 为空时返回 HTTP 400（BadRequestException）；`outputPath` 表示下载根目录下的相对子目录 | `packages/server/src/download/download.controller.ts` |

## Rule

Keep this file current. If a feature changes the supported app baseline, update this file or a narrower owner doc in the same change.

This file owns current app behavior, surfaces, roles, and workflows.

Do not duplicate long-term product vision from `docs/architecture/project-vision.md` or current milestone scope from `docs/requirements/product-scope.md`.
