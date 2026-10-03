# System Baseline

## Purpose

Record the current supported implementation baseline for `bilibili-downloader-core`.

## Runtime Shape

TypeScript monorepo，使用 pnpm workspace 管理。后端自 Phase 3（2026-09-30）由单体 `packages/server` 拆分为 cloud-server（对外 HTTP）/ nas-worker（作业执行）/ server-common（共享内核）三应用，`packages/server` 已退役删除：

```
packages/
├── core/             — 下载领域模型、用例编排、Ports 接口
├── adapters/         — B站 API、HTTP 下载器、FFmpeg、文件系统、COS 客户端（实现 core Ports）
├── bilibili-api-sdk/ — B站非官方 REST API SDK（含接口级缓存与 -412 重试）
├── server-common/    — 后端共享内核：DB/Prisma 契约、日志、worker_job 仓储 + WorkerService 类、作业契约、path 锚点纯函数、内建提示词
├── cloud-server/     — 云端对外 HTTP API（NestJS）：parse/download 创建读取/video/analysis 触发查询/chat-RAG/knowledge/prompt/settings/auth/作业生产
├── nas-worker/       — NAS 侧作业消费与执行（NestJS 应用上下文，无对外 HTTP）：下载执行/分析引擎/截图/screenshot_retry/完整性检查/通知(SMTP)/PathsService/vision-proxy 客户端
├── frontend/         — React 19 前端
├── vision-proxy/     — 可选 Python 视觉薄代理（独立容器）
└── docker/           — 三镜像 Dockerfile 与 compose 编排（Stage D 已于 2026-10-01 人工批准实施，`pnpm docker:build` 通过）
```

依赖方向（不可反向，经各包 package.json workspace 依赖核对）：

- `core`：最内层，无任何包依赖
- `adapters` → `core`（另含 bilibili-api-sdk、cos-nodejs-sdk-v5 等外部库）
- `server-common` → 仅外部库（`@prisma/orm-postgres`、`pg`、日志库等），**不依赖** adapters/core/任何 workspace 包
- `cloud-server` / `nas-worker` → `core` + `adapters` + `server-common`（三者并列直接依赖，非线性链）
- `frontend` ──(HTTP)──→ `cloud-server`
- `docker` ──(build)──→ cloud-server + nas-worker + frontend | vision-proxy

## Application Split（cloud-server / nas-worker / server-common）

Phase 3 代码已落地的三应用职责与物理隔离（模块边界与依赖见 `docs/architecture/module-boundaries.md`）：

- `cloud-server`（对外 HTTP）：parse、download（创建/读取/停止/恢复/删除/配置，生产者侧入队/取消作业）、video、B站扫码 auth（`src/auth`）、analysis 触发与查询（controller + `analysis-job-producer.service.ts` 入队、`ai-summary-query.service.ts`、`ai-summary-task.view.ts`）、prompt、chat-RAG、knowledge-search、user-auth（`APP_GUARD` 全局守卫）、settings（经 `api/analysis/config`、`api/download/config` 等端点，无独立 settings 模块）、worker-controller（只读 DB）、全部作业**生产**。**物理不含** ffmpeg / 分析引擎 / PathsService；chat-RAG 多模态经 `openai` SDK 直连 DashScope compatible-mode（出站 HTTP，`chat/openai-vision-client.ts`，baseURL 由容器 env `QWEN_API_BASE` 配置、默认指向 DashScope；云侧不部署 vision-proxy）；B站 cookie 真源为 `app_settings`（`bili.cookie`/`bili.cookie.version`，版本刷新），cache 目录经 env 配置（`src/config/bili-cache.ts`），不依赖 PathsService。
- `nas-worker`（无对外 HTTP，`main.ts` 仅建应用上下文）：WorkerService（消费端）+ 构造器注册 download/analyze/low_res_download/screenshot_retry/integrity_check handler（`download-job-handler.service.ts`、`analysis-job-handlers.service.ts`，先于轮询）、下载执行（`download-executor.service.ts`）、分析执行（`analysis-executor.service.ts`，含 claimAiSummaryTask/runAnalysis/reconcileStaleAnalysisState）、AnalysisEngine、Ffmpeg 截图/合并、screenshot-retry、summary-integrity、analysis-video-resolver、knowledge-publisher、notification（SMTP，nodemailer）、PathsService + path 锚点、QwenClient / vision-proxy 客户端。
- `server-common`（共享内核）：DB/Prisma 契约（`src/prisma/contract.*`）、`database.service.ts` 门面、日志、worker_job 仓储 + `WorkerService` 类（`src/worker/worker.service.ts`）、作业契约（`src/worker/job-kinds.ts`）、path 锚点纯函数（`src/paths/path-anchor.ts`）、内建提示词。无 workspace 依赖，供 cloud/nas 共用。
- COS 下沉：`CosClient` 位于 `packages/adapters/src/cos`，cloud/nas 各自以薄 wrapper `knowledge/cos-store.service.ts` 引用。
- Prisma / 脚本归属：`prisma.config.ts` 在 cloud-server（server-common 另保留一份）；`seed.mjs` 在 `cloud-server/scripts`；`ensure-pgvector.mjs` 与 `one-off-migrations/` 已迁入 `server-common/scripts`。

## Frontend Stack

- React 19 + Vite + TypeScript
- 路由：react-router 7（library 模式，createBrowserRouter + lazy）
- 状态管理：Zustand（客户端状态，localStorage persist）+ TanStack Query（服务端状态）
- 组件库：antd 6 + Tailwind 4（布局工具类）

## Backend Stack

- NestJS + TypeScript
- PostgreSQL 15+（云端 RDS，当前 17.0；Prisma 8 ORM 管理 schema 与数据访问，见 Data Access Approach）
- 可选 Python 薄代理：仅用于 DashScope 视觉模型读取本地图片路径，Node server 保持业务编排主体

## State Management Approach

- 前端：Zustand（设置/B站登录态/下载队列，持久化到 localStorage）+ TanStack Query（列表/详情等服务端数据）；应用用户会话态（`stores/session.ts`）不持久化，启动经 `GET /api/auth/me` 重建，任一 API 收到 401 即广播失效事件置为未登录（`api/index.ts` 的两个请求入口共用同一 401 处理）
- 后端：NestJS service 层管理业务状态，PostgreSQL 持久化

## Data Access Approach

- 数据访问层：`packages/server-common/src/database/database.service.ts` 门面，内部全量走 Prisma 8 client（`@prisma/orm-postgres`，contract 在 `packages/server-common/src/prisma/contract.*`，`pnpm --filter @bilibili-downloader/server-common prisma:emit` 生成）；例外仅两个守卫型原子 claim（`claimAiSummaryTask`/`claimCreatedTaskById`）保留 raw SQL + `pg` Pool
- Schema 所有权：Prisma contract/migration（2026-09-02 P3 起，`initSchema()` 已移除）。`db init` fresh / `db sign` 采纳存量 / `db migrate` 演进；权威校验 `db verify`，启动哨兵做表+关键列快检。`prisma.config.ts` 在 cloud-server（server-common 另保留一份），`seed.mjs` 在 `cloud-server/scripts`，`ensure-pgvector.mjs` 与 `one-off-migrations/` 在 `server-common/scripts`
- 数据层行为测试：`packages/server-common/tests/`（vitest，`TEST_DATABASE_URL`，globalSetup 自动 `db init`）；cloud-server / nas-worker 另有各自包内测试
- 下载任务状态通过数据库记录
- 下载文件通过文件系统管理（输出目录 + 临时目录）

## Async Job Queue (worker_job)

- 持久化作业队列（2026-09 Phase 2 起）：新增 `worker_job`（模型 `WorkerJob`）与 `worker_heartbeat`（模型 `WorkerHeartbeat`）两张表（`packages/server-common/src/prisma/contract.prisma`，additive）。`worker_job` 在 `dedup_key` 上有 partial-unique 索引，条件 `WHERE status IN (queued, leased, running)`，据此在库层强制并发/去重（取代旧的进程内互斥与低清队列）。
- 作业生产与消费拆分（Phase 3 起）：`WorkerService` 类下沉 `packages/server-common/src/worker/worker.service.ts`，作业契约在 `src/worker/job-kinds.ts`。**消费端**仅在 `nas-worker` 运行（`main.ts` 建应用上下文、`onModuleInit` 驱动轮询，构造器注册各 kind handler 先于轮询）；**生产端**在 `cloud-server`（触发方入队、`worker-controller` 只读查询，不 provide WorkerService）。执行环：轮询 `worker_job` → 以带 SKIP LOCKED 的守卫型原子 `UPDATE` claim 作业 → 心跳续租 `lease_expires_at` → 写终态时以 `lease_owner` fencing 防越权覆盖；reaper 周期性把过期租约的作业重置为 `queued`（`attempts++`）。worker 存活写入 `worker_heartbeat`。作业队列即云端生产者与 NAS 消费者的跨主机解耦通道（部署分离已随 Stage D 三镜像落地，2026-10-01）。
- 作业类型：`analyze`、`low_res_download`、`screenshot_retry`、`integrity_check`、`retrigger`（当前经 `analyze` 路由），另有预留 `cos_cleanup`（生产者见 Phase 4）。高清 `download` 自 Stage B-4 起已接通 `download` 作业 kind（cloud 入队、nas `download-job-handler` 认领执行）。
- `integrity_check` 处理体自 2026-09-30「完整性检查重定义」起已解除 Phase 2 的 gated 状态，经 nas-worker 的 `SummaryIntegrityService.run()` 执行以云端为真源的三类判据（内容：云 DB `summary`+`summary_segment`；截图：`summary_segment.screenshot_url` 非空；视频：NAS 本地视频文件存在性），把 `integrity_status`（新增 `partial`）与结构化 JSON 的 `integrity_detail`（`{contentMissing,screenshotMissing,videoMissing}`）写回 `ai_summary_task`，复用既有 `integrity_status`/`integrity_detail`/`integrity_checked_at` 三列、无 schema 变更。
- 配置经环境变量：`WORKER_POLL_INTERVAL_MS`、`WORKER_LEASE_TTL_SEC`、`WORKER_HEARTBEAT_MS`、`WORKER_REAP_INTERVAL_MS`、`WORKER_MAX_CONCURRENT`（全局上限）、`WORKER_QUEUE`、`WORKER_ID`、`WORKER_ENABLED`；per-kind 上限经 `WORKER_MAX_CONCURRENT_<KIND>`（如 `WORKER_MAX_CONCURRENT_DOWNLOAD`，`download` 回退旧 `MAX_CONCURRENT_DOWNLOADS`），未配置则取全局上限、不额外限制。

## Auth (用户会话与权限门禁)

- 模块位置：`packages/cloud-server/src/user-auth/`（与 `packages/cloud-server/src/auth/` 的 B站扫码登录是不同关注点）。角色划分与权限矩阵见 `docs/design/app-overview.md`。守卫与用户系统均在 cloud-server（对外 HTTP 入口），nas-worker 无对外 HTTP、不涉及该守卫。
- 全局守卫：`AuthGuard` 经 `APP_GUARD` 注册，**fail-closed**——未标注的路由默认仅 `admin`，新增端点漏配即为最严；`@Public()` 只放行 login/logout/me，`@Roles(admin, user)` 只用于 chat/QA 控制器全部方法与 `GET /api/summary-tasks/by-resource/:bvid/:cid/markdown`。未登录 401、角色不匹配 403。守卫作用于 Nest 路由，前端静态资源经 `useStaticAssets` 直出、不经守卫。
- 数据形态（contract 为真源，见 `packages/server-common/src/prisma/contract.prisma`）：`user`（`username` 唯一、`password_hash`、`role`、`disabled_at?`）、`user_session`（`token_hash` 唯一、`user_id`、`expires_at`）、`conversation.user_id?`（additive，`onDelete: SetNull`）。
- 可吊销会话：`user_session` 行即会话真源——登出删除当前行、禁用用户删除其全部行、登录时清理过期行；解析会话时若用户不存在或已禁用一律按未登录处理，无需等待过期。
- 凭据存储：口令用 Node 内置 `crypto.scrypt`（随机 salt，存 `scrypt$salt$hash`，校验用 `timingSafeEqual`，格式非法返回 false）；会话 token 为随机 32 字节 base64url，仅入库 sha256 摘要，原始 token 只经 cookie 传输；口令与 token 不入日志。
- Cookie 隔离：浏览器会话 cookie 为 `bdl_session`（HttpOnly + SameSite=Lax + `path=/`，Secure 由 `SESSION_COOKIE_SECURE` **显式开关**控制——本仓不以 `NODE_ENV` 作生产判据，HTTPS 暴露时才置 true，纯 HTTP 下置 true 会导致浏览器不保存 cookie），`Cookie` 头手动解析（未引入 cookie-parser）；B站扫码登录的凭据仍是服务端文件 `.cookies.json`（`COOKIE_FILE_PATH`），两条通道互不影响。
- 启动引导：幂等播种内置 `admin`（`ADMIN_INITIAL_PASSWORD` 缺失仅告警、**不建默认凭据**；已存在则不改口令与角色），随后把 `conversation.user_id` 为空的存量行回填归首个 admin，无 admin 时 no-op。
- 登录防护：同 IP 失败计数为**进程内内存状态**（不跨实例、进程重启即清零，条目数超上限时惰性清扫），达阈值临时封禁并返回 429 + `Retry-After`；登录口令长度超上限直接按凭据无效处理。IP 取 `req.ip`（Express `trust proxy` 未开启，故 `X-Forwarded-For` 无法伪造）——**代价是反向代理后所有客户端塌缩为同一 IP，届时封禁粒度变为全局**，公网暴露（Phase 3）前需重新裁决。
- 配置经环境变量：`ADMIN_INITIAL_PASSWORD`、`SESSION_COOKIE_SECURE`（默认关）、`SESSION_TTL_HOURS`（默认 168）、`LOGIN_MAX_FAILURES`（5）、`LOGIN_FAILURE_WINDOW_MINUTES`（15）、`LOGIN_BLOCK_MINUTES`（15）；容器部署经 `packages/docker/docker-compose.yml` 透传，首次部署未设 `ADMIN_INITIAL_PASSWORD` 会导致无账号可登录（全部 API 401）。

## Testing Stack

- 数据层行为测试：vitest + 真实 PostgreSQL（见上）；其余包暂无

## Build And Package Tools

- pnpm workspace（monorepo 管理）
- Vite（Frontend 打包）
- tsc（core / adapters / server-common / cloud-server / nas-worker 编译）
- Docker（**Stage D 已于 2026-10-01 人工批准实施**）：三镜像构建——`packages/docker/Dockerfile.cloud-server`（Node + 前端静态，无 ffmpeg/Python，schema 属主跑 `db init`，EXPOSE 3000）、`Dockerfile.nas-worker`（Node + ffmpeg，无前端/Python、不建库、无对外端口）、`Dockerfile.vision-proxy`（Python 独立）；旧 `Dockerfile.server` 已删除。经 `packages/docker/docker-compose.yml` 编排、`compose.mjs` 按三包 version 推导镜像 tag `bilibili-downloader:{cloud-server|nas-worker|vision-proxy}-{version}`（`CLOUD_SERVER_VERSION`/`NAS_WORKER_VERSION`/`VISION_PROXY_VERSION` 可覆盖）。`pnpm docker:build` 三镜像构建通过、`docker compose config`（`pnpm docker:config`）校验通过（DATABASE_URL fail-closed）；真实 `docker compose up`/公网暴露仍属运维上线动作

## Deployment Shape

> **部署形态（Stage D 已于 2026-10-01 人工批准实施并闭合）**：Phase 3 代码三应用（cloud-server / nas-worker / server-common）已配套三镜像部署布局——`packages/docker/` 含 `Dockerfile.cloud-server` / `Dockerfile.nas-worker` / `Dockerfile.vision-proxy`（旧 `Dockerfile.server` 已删除），经 `docker-compose.yml` 编排、`compose.mjs` 按三包 version 出 tag（`CLOUD_SERVER_VERSION`/`NAS_WORKER_VERSION`/`VISION_PROXY_VERSION` 可覆盖）。`pnpm docker:build` 三镜像构建通过、`docker compose config` 校验通过（DATABASE_URL fail-closed），独立 closure audit PASS-WITH-FIXES（无 Blocker）。**真实 `docker compose up`、公网暴露、跨主机 RDS 连通、端到端五链路仍属运维上线动作、未执行**；公网暴露前须 TLS/反代 + 播种 `ADMIN_INITIAL_PASSWORD` + HTTPS 下 `SESSION_COOKIE_SECURE=true`。

- Docker compose 三容器部署：`cloud-server`（NestJS 对外 HTTP + 静态托管前端构建产物 + 作业生产 + schema 属主 `db init`，无 ffmpeg/Python、无媒体卷）、`nas-worker`（作业消费与执行 + FFmpeg，无对外 HTTP、不建库、挂载媒体卷）与 `vision-proxy`（Python 视觉薄代理）各自独立容器，镜像以各自包 version 打 tag（见 Build And Package Tools），均配置 `restart: unless-stopped`，任一容器主进程崩溃由 Docker 单独自动重启，不影响健康容器；**对外仅暴露 `cloud-server` 的 3000 端口**，nas-worker 与 vision-proxy 均不向宿主机发布端口。
- cloud-server 多模态经 openai SDK **直连 DashScope compatible-mode**（baseURL 取自容器 env `QWEN_API_BASE`，默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`），**云侧不部署 vision-proxy**。nas-worker 经 compose 默认网络的服务名 `vision-proxy:8765` 调用本地代理（`QWEN_VISION_PROXY_URL` 默认 `http://vision-proxy:8765/v1/chat/completions`）读本地视频文件；vision-proxy 容器内监听 `0.0.0.0:8765` 实现跨容器可达，但不向宿主机发布端口。
- 媒体卷归 nas-worker（与 vision-proxy）：宿主机下载目录挂载到 `/download`（默认 `${DOWNLOAD_HOST_PATH:-${HOME:-$USERPROFILE}/Downloads/bilibili_download}`，Windows 宿主经 `USERPROFILE` 回退），nas-worker `OUTPUT_DIR=/download`、`LOG_DIR=/download/logs`；cloud-server **不挂媒体卷**，仅挂顶层命名卷 `cloud-logs:/app/logs` 存自身日志。
- worker 最小权限 DB 角色：nas-worker 连接串经 `DATABASE_URL=${WORKER_DATABASE_URL:-${DATABASE_URL}}`（ops 配受限角色，缺省回退特权 `DATABASE_URL`）；cloud-server 用特权 `DATABASE_URL` 负责建表 + 幂等播种。大模型密钥由前端设置页存 DB（百炼 API Key）；cloud-server 直连 DashScope 时经 `Authorization: Bearer` 使用，nas-worker 经 `Authorization` 头传给本地 vision-proxy 容器，均不写入镜像、不经 compose env
- NAS 用户通过挂载 volume 将 nas-worker 容器内下载目录映射到宿主机
- **数据库 schema 引导**：`cloud-server` 容器启动命令为 `prisma db init`（幂等）→ 应用主进程。`db init` 覆盖三种状态：fresh 空库建表+签名 / 未签名存量库（schema 匹配）零操作采纳+签名 / 已签名库零操作。镜像内含 `prisma` CLI（prod 依赖）、`prisma.config.ts` 与 `src/prisma/contract.*`；DATABASE_URL 由 compose 注入。schema 演进（如 Phase 2 向量化加列）走"改 contract → emit → migration plan → db migrate"，随后升级镜像即可。启动期 DB 瞬断由 compose `restart: unless-stopped` 退避重试兜底；应用内哨兵（表+关键列）为最后防线

## External Platforms

- Bilibili API：无需登录即可获取视频基本信息、播放流地址
- FFmpeg / ffprobe：音视频合并与视频截图（作为外部依赖，需系统预装或容器内置）
- 阿里云百炼 / DashScope：视频分析总结功能使用 Qwen 文本与视觉理解模型；视觉本地文件输入通过可选 Python 薄代理接入 DashScope Python SDK

## Stable Rules

- Core 不依赖 UI 框架、CLI 框架、HTTP 框架
- Adapters 实现 Core 中定义的 Ports 接口
- cloud-server / nas-worker / Docker 作为运行时入口，只做参数适配和编排，不包含下载细节
- 下载链路：解析 → 获取元信息 → 流选择 → 下载 → 合并 → 产物输出
- 所有 B站 API 调用集中在 adapters/src/bilibili/ 中
- `bilibili-api-sdk` 内建接口级缓存与业务错误码自动重试：GET 读接口默认缓存 24h（内存 `MemoryCacheStore` 或磁盘 `FileCacheStore`，key 含登录身份指纹）；`-412`/HTTP 412 默认指数退避重试、总共最多 5 次请求；两者均经 `ClientOptions.cache` / `ClientOptions.retry` 配置，默认开启
- cloud-server 的 parse/download 创建 SDK client 时注入共用磁盘缓存目录（经 `src/config/bili-cache.ts` 的 env 配置，不依赖 PathsService），实现跨实例与跨重启复用
- adapter 默认通过异常向上暴露失败，并在异常中保留安全摘要上下文；cloud-server / nas-worker 等上层入口负责高语义日志与对外错误语义
- adapter 内部只在吞错、静默降级或 fallback 且上层无法感知失败时记录少量低频 `debug`/`warn` 诊断
- adapter 级错误消息和诊断日志不得暴露 cookie、Authorization、完整 callback URL、完整 headers、完整字幕正文、完整上游响应体或其他非必要敏感内容
