# Codebase Map

## Purpose

This file gives AI agents a compact map of the live repository so they do not rediscover the structure by repeatedly searching imports and directories.

Keep it current enough to route common work. Do not turn it into a full architecture document.

## Entry Points

| Area         | Path                          | Notes                                          | Last Verified | Confidence |
| ------------ | ----------------------------- | ---------------------------------------------- | ------------- | ---------- |
| Core         | `packages/core/src/`          | 下载领域模型、用例编排、ports 接口                | 2026-06-02    | high       |
| Bilibili SDK | `packages/bilibili-api-sdk/`  | B站非官方 REST API SDK（workspace 包，含 vitest 测试；内建接口级缓存 MemoryCacheStore/FileCacheStore 与 -412 自动重试） | 2026-08-12    | high       |
| Adapters     | `packages/adapters/src/`      | B站 API 适配（基于 bilibili-api-sdk）、HTTP 下载器、FFmpeg（`ffmpeg/` 合并 + 截图）、文件系统、`llm/`（`QwenClient`）、`cos/`（`CosClient`，Phase 3 下沉；cloud/nas 各以薄 wrapper `knowledge/cos-store.service.ts` 引用） | 2026-09-30    | high       |
| Cloud Server（对外 HTTP） | `packages/cloud-server/src/` | NestJS 对外 HTTP API（Phase 3 拆分，退役单体 `packages/server`）：parse、download（创建/读取/停止/恢复/删除/配置，生产者 `download-scheduler.ts` 入队/取消）、video、analysis 触发与查询（`analysis.controller.ts`/`analysis-task.controller.ts` + `analysis-job-producer.service.ts` 入队、`ai-summary-query.service.ts`、`ai-summary-task.view.ts`、`summary-render.ts` 云 DB 渲染）、prompt、knowledge-search（`GET /api/knowledge/search`）、chat-RAG（`chat/`，`/api/chat/*`，照片 sharp 压缩存 COS、query 重写→检索→多模态→三段式）、user-auth（见 User Auth 行）、settings（经 `api/analysis/config`、`api/download/config`，无独立 settings 模块）、worker-controller（只读 `GET/POST /api/worker-jobs*`）、全部作业**生产**。B站扫码 auth 在 `src/auth/`（含手动粘贴 cookie 入口 `POST /api/auth/cookie`，受全局 AuthGuard 保护）。B站 cookie 真源为 `app_settings`（`bili.cookie`/`bili.cookie.version`，版本刷新；含 ParseService 客户端刷新），cache 目录仍经 `src/config/bili-cache.ts` env 配置；`prisma.config.ts` + `scripts/seed.mjs` 在此。**物理不含** ffmpeg/分析执行引擎/PathsService（唯一出站例外：chat-RAG 多模态经 `openai` SDK（`chat/openai-vision-client.ts`）连 `QWEN_VISION_PROXY_URL`，Stage C 已由 QwenClient 换为 openai SDK） | 2026-09-30 | high |
| NAS Worker（作业执行） | `packages/nas-worker/src/` | NestJS 应用上下文、**无对外 HTTP**（`main.ts` 建 context，`onModuleInit` 驱动轮询）：`WorkerService` 消费端 + 构造器注册 download/analyze/low_res_download/screenshot_retry/integrity_check handler（`download/download-job-handler.service.ts`、`analysis/analysis-job-handlers.service.ts`，先于轮询）；下载执行 `download/download-executor.service.ts`；分析执行 `analysis/analysis-executor.service.ts`（claimAiSummaryTask/runAnalysis/reconcileStaleAnalysisState）、`analysis-engine.ts`、`screenshot-retry.service.ts`、`summary-integrity.service.ts`、`analysis-video-resolver.ts`；`knowledge/knowledge-publisher.service.ts`（内联写 `summary`/`summary_segment` + 直传 COS 截图）；`notification/`（SMTP，nodemailer）；`paths/paths.service.ts`（`PathsService` + DB 相对路径锚点，一律相对 `DOWNLOAD_ROOT`）；QwenClient/vision-proxy 客户端（`analysis/llm-config.ts`，`QWEN_VISION_PROXY_URL`） | 2026-09-30 | high |
| Server Common（后端共享内核） | `packages/server-common/src/` | 供 cloud-server 与 nas-worker 复用、无 workspace 依赖：`database/database.service.ts` 门面（全量 Prisma 8，守卫型 claim 保留 raw SQL + `pg`）、`prisma/contract.*`（PostgreSQL schema 由 Prisma 8 管理，变更后 `pnpm --filter @bilibili-downloader/server-common prisma:emit`；fresh=`db init`/存量=`db sign`/演进=`migration plan`+`db migrate`，启动哨兵 + 幂等播种无 DDL）、`logging/`（RequestLoggingInterceptor、safe log allowlist、`FileConsoleLogger`）、`worker/worker.service.ts`（`WorkerService` 类）+ `worker/job-kinds.ts`（作业契约）、`paths/path-anchor.ts`（锚点纯函数）、`prompt/builtin-prompt.ts`；`scripts/ensure-pgvector.mjs` 与 `scripts/one-off-migrations/`（历史迁移）；数据层行为测试在 `packages/server-common/tests/`（vitest，需 `TEST_DATABASE_URL`，globalSetup 自动 `db init`） | 2026-09-30 | high |
| Worker（作业队列） | `packages/server-common/src/worker/`（类）+ `packages/nas-worker/src/worker/`（消费）+ `packages/cloud-server/src/worker/`（生产/只读 controller） | `WorkerService` 类下沉 server-common（`worker.service.ts` + `job-kinds.ts` 契约）；**消费端**仅在 nas-worker 运行（轮询 `worker_job`、SKIP LOCKED 守卫型原子 UPDATE claim、心跳续租 `lease_expires_at`、`lease_owner` fencing 写终态、reaper 把过期租约重置 `queued` `attempts++`，`worker_heartbeat` 记存活；handler 构造器注册先于轮询）；**生产端**在 cloud-server（触发方入队 + `worker.controller.ts` 只读 `GET /api/worker-jobs`、`GET /api/worker-jobs/:id`、`POST /api/worker-jobs/:id/cancel`，不 provide WorkerService）。作业类型 `download`/`analyze`/`low_res_download`/`screenshot_retry`/`integrity_check`/`retrigger`（经 analyze 路由）+ 预留 `cos_cleanup`（Phase 4）。并发：全局 `WORKER_MAX_CONCURRENT` + per-kind `WORKER_MAX_CONCURRENT_<KIND>`（download 回退 `MAX_CONCURRENT_DOWNLOADS`）。**已移除**旧进程内调度/内存互斥（低清队列、`rebuildingIds`、integrity `running`），并发/去重由 `worker_job.dedup_key` active-unique 索引强制。高清 `download` 自 Stage B-4 起已接通 `download` 作业 kind（cloud 入队、nas `download-job-handler` 认领）。部署分离待 Stage D | 2026-09-30    | high       |
| User Auth（用户系统与鉴权） | `packages/cloud-server/src/user-auth/` | 小用户系统与写操作鉴权（cloud-server 承载，对外 HTTP 入口）：`auth.constants.ts`（cookie 名 `bdl_session`、角色 admin/user、AuthUser）、`cookie.util.ts`（手动解析 Cookie 头，无 cookie-parser）、`password.util.ts`（Node `crypto.scrypt` + `timingSafeEqual`）、`auth.service.ts`（会话签发/解析/吊销、IP 登录失败锁定）、`auth.guard.ts` + `auth.decorators.ts`（`APP_GUARD` 全局守卫，fail-closed 默认仅 admin；`@Public()`/`@Roles()`/`@CurrentUser()`）、`user-auth.controller.ts`（`api/auth` 的 login/logout/me）、`users.controller.ts`（`api/users` admin 用户管理）、`user-seed.service.ts`（admin 幂等播种 + `conversation.user_id` 存量回填）。数据模型 `user`/`user_session`/`conversation.user_id` 在 `packages/server-common/src/prisma/contract.prisma`；注意 `packages/cloud-server/src/auth/` 是 **B站扫码登录**，与本模块只共享 `api/auth` 路径前缀 | 2026-09-30 | high |
| Server Logging | `packages/server-common/src/logging/` | RequestLoggingInterceptor、safe log allowlist、请求体安全裁剪；`FileConsoleLogger`（`LOG_DIR` 开启终端+文件双写，`rotating-file-stream` 按天轮转，`LOG_MAX_FILES` 保留数）；cloud-server 与 nas-worker 共用 | 2026-09-30 | high |
| Vision Proxy | `packages/vision-proxy/`     | 可选 Python 薄代理，仅负责 DashScope 本地视觉文件调用（pyproject.toml 锁定依赖 + .venv 于包目录下；body 上限/socket 超时/并发上限/healthz）。容器部署时作为独立 `vision-proxy` 容器运行；宿主开发模式经 `start-vision-proxy` 自动重启，开发模式读 `packages/vision-proxy/.env` 的 HOST/PORT；密钥经 `Authorization` 头由 Node 透传（DB 来源），SDK 基址代码写死 | 2026-08-20    | high     |
| Frontend     | `packages/frontend/src/`      | React 19 SPA，视频输入、下载列表、AI 总结任务、设置（react-router 7 + Zustand + antd 6 + TanStack Query + Tailwind 4）；移动端响应式：`App.tsx` 顶栏窄屏折叠为汉堡 + Drawer 并暴露 `--app-header-h`/`--vvh`，`pages/QaChat.tsx` 窄屏单列 + 会话抽屉 + 底部输入区避让键盘/安全区，助手示例图=缩略图条 + 全屏左右滑动/按钮/键盘切换；QA 来源条目含"AI 总结"入口，`pages/SummaryDetail.tsx` 为 `/summary/:bvid/:cid` 整页总结视图；应用登录态在 `stores/session.ts`（不持久化，启动查 `/api/auth/me`）+ `pages/SignIn.tsx`（`/sign-in`）+ `pages/AppUsers.tsx`（`/users`，admin-only 用户管理），`App.tsx` 做导航 `adminOnly` 过滤与路径级门禁，`api/index.ts` 的 `request()` 带 `credentials: "include"` 并在 401 广播 `bdl:unauthorized`；**命名隔离**：B站扫码登录仍是 `/login` + `stores/auth.ts` | 2026-09-30    | high       |
| Docker       | `packages/docker/`            | **当前为拆分前旧单体布局，`pnpm docker:build` 失效（`Dockerfile.server` 仍 COPY 已删除的 `packages/server/`）；三镜像接线属 Stage D 保护区待人工批准**。既有：`Dockerfile.server` / `Dockerfile.vision-proxy` 两独立 Dockerfile、docker-compose.yml、`.env.example` 与构建脚本（compose.mjs 派发 docker:build / docker:build:server / docker:build:vision-proxy / docker:save* / docker:run / docker:down / docker:logs）；镜像 tag 取包 version（`SERVER_VERSION`/`VISION_PROXY_VERSION` 可覆盖） | 2026-09-30    | high       |
| Config       | `tsconfig.base.json`, `pnpm-workspace.yaml`, `package.json` | 项目配置                          | 2026-06-02    | high       |
| Tests        | 无统一测试目录                    | 当前无自动化测试                                  | 2026-06-02    | low        |

## Common Change Routes

| Task Type           | Start Here                    | Then Check                                | Verification                    | Last Verified | Confidence |
| ------------------- | ----------------------------- | ----------------------------------------- | ------------------------------- | ------------- | ---------- |
| 新增下载能力         | `packages/core/src/`          | `packages/adapters/src/`                  | `pnpm typecheck`                | 2026-06-02    | high       |
| 新增 API 端点        | `packages/cloud-server/src/`  | `packages/core/src/` (usecase)、`packages/server-common/src/`（DB/契约） | `pnpm typecheck`                | 2026-09-30    | high       |
| 修改可观测性（日志）  | `packages/server-common/src/logging/` | `packages/cloud-server/src/`, `packages/nas-worker/src/`, `docs/testing/2026/` | `pnpm typecheck`, `pnpm build` | 2026-09-30 | high |
| 修改视频分析能力      | 执行侧 `packages/nas-worker/src/analysis/`；生产/查询侧 `packages/cloud-server/src/analysis/` | `packages/adapters/src/llm/`, `packages/adapters/src/ffmpeg/`, `packages/vision-proxy/` | `pnpm typecheck`, `pnpm build` | 2026-09-30    | high       |
| 修改作业队列/触发链路 | `WorkerService` 类 `packages/server-common/src/worker/`；消费 `packages/nas-worker/src/`（download/analysis handler + executor）；生产 `packages/cloud-server/src/`（analysis/download 入队、worker.controller 只读） | `packages/server-common/src/prisma/contract.prisma`（`worker_job`/`worker_heartbeat`） | `pnpm typecheck`, `pnpm build`, 三包 `test`（见 project-context 验证命令） | 2026-09-30 | high |
| 修改鉴权/权限映射     | `packages/cloud-server/src/user-auth/` | `packages/cloud-server/src/chat/`、`packages/cloud-server/src/analysis/analysis-task.controller.ts`（`@Roles` 放开点）, `packages/frontend/src/App.tsx`（导航与路径门禁）, `packages/server-common/src/prisma/contract.prisma`（`user`/`user_session`） | `pnpm typecheck`, `pnpm build`, `pnpm --filter @bilibili-downloader/cloud-server test` | 2026-09-30 | high |
| 新增 UI 页面         | `packages/frontend/src/`      | `packages/cloud-server/src/` (API)        | `pnpm typecheck`                | 2026-09-30    | high       |
| 修改下载器行为        | `packages/adapters/src/`      | `packages/core/src/` (ports)              | `pnpm typecheck`                | 2026-06-02    | high       |
| 修改 B站 API 适配     | `packages/adapters/src/bilibili/` | `packages/bilibili-api-sdk/` (底层接口), `packages/core/src/` (domain models) | `pnpm typecheck`, `pnpm --filter bilibili-api-sdk test` | 2026-09-30    | high       |
| 修改部署配置          | `packages/docker/`            | `package.json` (scripts)                  | **Stage D 保护区：三镜像接线待人工批准，当前 `pnpm docker:build` 失效** | 2026-09-30    | high       |

## Large Or Fragile Files

| Path                                  | Risk                               | Preferred Approach                                     |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| `packages/core/src/`                  | 核心编排逻辑，改动需谨慎             | 优先阅读现有 usecase 和 port 接口，理解领域模型后再修改    |
| `packages/adapters/src/bilibili/`     | B站 API 适配，外部 API 变更敏感      | 底层接口调用统一走 bilibili-api-sdk，新增/修改接口优先改 SDK 并补测试 |
| `packages/cloud-server/src/` 与 `packages/nas-worker/src/` | NestJS 模块装配，依赖注入复杂度高；cloud/nas 物理隔离边界易漂移 | 新增 API 遵循现有 controller/service 模式；执行能力（ffmpeg/引擎/PathsService）只放 nas，cloud 仅生产/查询 |
| `packages/cloud-server/src/user-auth/`      | 权限映射漂移会直接放开写/管理接口         | 守卫默认仅 admin（fail-closed）；放开新端点须显式 `@Roles`/`@Public()` 并同步 `docs/design/app-overview.md` 权限矩阵 |
| `packages/server-common/src/logging/`        | 安全字段 allowlist 漂移会直接影响敏感信息暴露 | 修改时优先保持 allowlist 思路，再用 route matrix + testing 文档验证 |
| 分析编排：`packages/nas-worker/src/analysis/`（执行）+ `packages/cloud-server/src/analysis/`（生产/查询） | 视频分析编排横跨 LLM、字幕、截图、文档生成 | 保持 Node.js 作为业务编排主体，Python 只做本地视觉文件薄代理；执行与生产分属 nas/cloud |
| `packages/vision-proxy/`          | Python 依赖与本地文件路径能力，容易和 Node 编排漂移 | 仅透传 Node 指定的多模态请求，不加入业务语义；Node 编排与代理间仅经 HTTP 契约耦合 |

## Project-Specific Search Hints

- Use file patterns: `packages/*/src/**/*.ts`
- Use content anchors: `DownloadRequest`, `DownloadUseCase`, `ResourceParser`, `MediaDownloader`, `FFmpegMerger`
- Avoid editing generated files: `node_modules/`, `dist/`, `*.d.ts`（非手写的类型声明）

## Update Rule

Update this file when a change creates a new major entry point, moves common code, adds a new test location, or repeatedly causes agents to rediscover the same path.

If a listed path is missing, placeholders remain, or live imports contradict this map, do not treat the map as authority. Verify with the live repo, then update the map or mark the row low confidence before implementation.

If `Last Verified` is old for the project's pace, predates major structural changes, or the task touches a listed route's boundary, verify the live repo before relying on the row. Low-confidence rows do not block low-risk work after live verification, but protected-area, migration, or cross-module work should update the row before implementation.
