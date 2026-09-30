# Codebase Map

## Purpose

This file gives AI agents a compact map of the live repository so they do not rediscover the structure by repeatedly searching imports and directories.

Keep it current enough to route common work. Do not turn it into a full architecture document.

## Entry Points

| Area         | Path                          | Notes                                          | Last Verified | Confidence |
| ------------ | ----------------------------- | ---------------------------------------------- | ------------- | ---------- |
| Core         | `packages/core/src/`          | 下载领域模型、用例编排、ports 接口                | 2026-06-02    | high       |
| Bilibili SDK | `packages/bilibili-api-sdk/`  | B站非官方 REST API SDK（workspace 包，含 vitest 测试；内建接口级缓存 MemoryCacheStore/FileCacheStore 与 -412 自动重试） | 2026-08-12    | high       |
| Adapters     | `packages/adapters/src/`      | B站 API 适配（基于 bilibili-api-sdk）、HTTP 下载器、FFmpeg、文件系统 | 2026-08-07    | high       |
| Server       | `packages/server/src/`        | NestJS 后端 API，下载任务管理、视频分析编排、全局请求日志；磁盘路径单一来源 `src/paths/`（全局 `PathsService`，getter 语义；消费方构造器注入，测试/脚本可 `new PathsService()` 直连使用，禁止直读 `OUTPUT_DIR` 自行推导；DB 中所有磁盘相对路径锚点约定：一律相对 `DOWNLOAD_ROOT`，读取 `join(DOWNLOAD_ROOT, value)`，无例外）；PostgreSQL schema 由 Prisma 8 管理（`src/prisma/contract.*`，变更后 `prisma:emit`；fresh=`db init`、存量=`db sign`、演进=`migration plan`+`db migrate`），启动流程为哨兵检查 + 幂等播种（`database.service.ts` 无 DDL）；数据访问全量 Prisma 走 `database.service.ts` 门面（守卫型 claim 保留 raw SQL），`scripts/one-off-migrations/` 为已归档历史迁移；数据层行为测试在 `packages/server/tests/`（vitest，需 `TEST_DATABASE_URL`，globalSetup 自动 `db init`）；知识发布管道在 `packages/server/src/knowledge/`（`KnowledgePublisherService.publishInline` 分析完成即内联写 `summary`/`summary_segment` + 直传 COS 截图（完成门槛=内容入库、best-effort 截图/向量、不读本地 md、不写 knowledge_status），`CosStoreService` 封装 `cos-nodejs-sdk-v5`；`embedding.service`+`knowledge-search.controller` 为 Phase 2 向量检索（pgvector，`GET /api/knowledge/search`，raw SQL `<=>`）；`summary-integrity.service.ts` 为本地原始内容完整性一键检查（`POST /api/summary-tasks/integrity-check`，只读磁盘、结果写 `ai_summary_task.integrity_*` 三列，运行改由 `integrity_check` worker_job 驱动，内存互斥已移除）））；RAG 问答在 `packages/server/src/chat/`（ChatModule：`conversation`/`message` 表 + 会话 CRUD/照片上传/消息发送 API（`/api/chat/*`）；照片经 sharp 压缩存 COS `user-photos/<conversationId>/` 专属目录；每轮 query 重写→照片分析→pgvector 检索→多模态生成→三段式拼装，模型复用设置页 `llm.modelName` 经 vision proxy；来源注脚含 `bvid/cid`，前端路由 `/qa`；`GET /api/summary-tasks/by-resource/:bvid/:cid/markdown` 按视频资源返回完整总结供 QA 来源"AI 总结"整页（2026-09-28 Phase 1a 起两 markdown 端点改为云 DB 渲染，纯函数在 `analysis/summary-render.ts`，读侧不触盘）；会话删除为软删除（`conversation.deleted_at`，消息数据保留供后续分析，列表/读取排除已删除）） | 2026-09-15    | high       |
| Worker（作业队列） | `packages/server/src/worker/` | 进程内 worker 循环 `WorkerService`（`worker.module.ts`/`worker.controller.ts`/`worker.service.ts`，2026-09 Phase 2）：轮询 `worker_job` 表并以 SKIP LOCKED 守卫型原子 UPDATE claim、心跳续租 `lease_expires_at`、`lease_owner` fencing 写终态、reaper 把过期租约重置为 `queued`（`attempts++`），`worker_heartbeat` 记 worker 存活；本阶段仍与 server 同进程（未拆部署）。作业类型 `analyze`/`low_res_download`/`screenshot_retry`/`integrity_check`/`retrigger`（经 analyze 路由）+ 预留 `cos_cleanup`（Phase 4 生产者）。触发方改为入队 `worker_job` 而非直调服务；对外 API 见 `worker.controller.ts`（`GET /api/worker-jobs`、`GET /api/worker-jobs/:id`、`POST /api/worker-jobs/:id/cancel`）。**已移除**：`DownloadScheduler` 低清队列（`lowResQueue`/`lowResRunningSet`/`lowResRunningResources`/`scheduleLowResDownload`/`tryScheduleLowRes`/`onLowResFinished`）、`AnalysisTriggerService.rebuildingIds`/`tryStartRebuild`、`SummaryIntegrityService` 的 `running`/`tryStart`/`isRunning` 内存互斥；并发/去重改由 `worker_job.dedup_key` active-unique 索引强制。高清 `download` 仍走 `download-scheduler.ts` 的 `claimNextCreatedTask`，未迁移到 `worker_job` | 2026-09-30    | high       |
| User Auth（用户系统与鉴权） | `packages/server/src/user-auth/` | 小用户系统与写操作鉴权（2026-09-30）：`auth.constants.ts`（cookie 名 `bdl_session`、角色 admin/user、AuthUser）、`cookie.util.ts`（手动解析 Cookie 头，无 cookie-parser）、`password.util.ts`（Node `crypto.scrypt` + `timingSafeEqual`）、`auth.service.ts`（会话签发/解析/吊销、IP 登录失败锁定）、`auth.guard.ts` + `auth.decorators.ts`（`APP_GUARD` 全局守卫，fail-closed 默认仅 admin；`@Public()`/`@Roles()`/`@CurrentUser()`）、`user-auth.controller.ts`（`api/auth` 的 login/logout/me）、`users.controller.ts`（`api/users` admin 用户管理）、`user-seed.service.ts`（admin 幂等播种 + `conversation.user_id` 存量回填）。数据模型 `user`/`user_session`/`conversation.user_id` 在 `src/prisma/contract.prisma`；注意 `src/auth/` 是 **B站扫码登录**，与本模块只共享 `api/auth` 路径前缀 | 2026-09-30 | high |
| Server Logging | `packages/server/src/logging/` | RequestLoggingInterceptor、safe log allowlist、请求体安全裁剪；`FileConsoleLogger`（`LOG_DIR` 开启终端+文件双写，`rotating-file-stream` 按天轮转，`LOG_MAX_FILES` 保留数） | 2026-08-13 | high |
| Vision Proxy | `packages/vision-proxy/`     | 可选 Python 薄代理，仅负责 DashScope 本地视觉文件调用（pyproject.toml 锁定依赖 + .venv 于包目录下；body 上限/socket 超时/并发上限/healthz）。容器部署时作为独立 `vision-proxy` 容器运行；宿主开发模式经 `start-vision-proxy` 自动重启，开发模式读 `packages/vision-proxy/.env` 的 HOST/PORT；密钥经 `Authorization` 头由 Node 透传（DB 来源），SDK 基址代码写死 | 2026-08-20    | high     |
| Frontend     | `packages/frontend/src/`      | React 19 SPA，视频输入、下载列表、AI 总结任务、设置（react-router 7 + Zustand + antd 6 + TanStack Query + Tailwind 4）；移动端响应式：`App.tsx` 顶栏窄屏折叠为汉堡 + Drawer 并暴露 `--app-header-h`/`--vvh`，`pages/QaChat.tsx` 窄屏单列 + 会话抽屉 + 底部输入区避让键盘/安全区，助手示例图=缩略图条 + 全屏左右滑动/按钮/键盘切换；QA 来源条目含"AI 总结"入口，`pages/SummaryDetail.tsx` 为 `/summary/:bvid/:cid` 整页总结视图；应用登录态在 `stores/session.ts`（不持久化，启动查 `/api/auth/me`）+ `pages/SignIn.tsx`（`/sign-in`）+ `pages/AppUsers.tsx`（`/users`，admin-only 用户管理），`App.tsx` 做导航 `adminOnly` 过滤与路径级门禁，`api/index.ts` 的 `request()` 带 `credentials: "include"` 并在 401 广播 `bdl:unauthorized`；**命名隔离**：B站扫码登录仍是 `/login` + `stores/auth.ts` | 2026-09-30    | high       |
| Docker       | `packages/docker/`            | 两个独立 Dockerfile（`Dockerfile.server` / `Dockerfile.vision-proxy`）分别构建两个相互独立的镜像（`bilibili-downloader:{version}` / `bilibili-downloader:vision-proxy-{version}`）、docker-compose.yml 双容器编排、`.env.example` 与构建脚本（compose.mjs 派发 docker:build / docker:build:server / docker:build:vision-proxy / docker:save* / docker:run / docker:down / docker:logs）；镜像 tag 取对应包 version（server ↔ `packages/server/package.json`，vision-proxy ↔ `packages/vision-proxy/package.json`），`SERVER_VERSION`/`VISION_PROXY_VERSION` 可覆盖 | 2026-08-24    | high       |
| Config       | `tsconfig.base.json`, `pnpm-workspace.yaml`, `package.json` | 项目配置                          | 2026-06-02    | high       |
| Tests        | 无统一测试目录                    | 当前无自动化测试                                  | 2026-06-02    | low        |

## Common Change Routes

| Task Type           | Start Here                    | Then Check                                | Verification                    | Last Verified | Confidence |
| ------------------- | ----------------------------- | ----------------------------------------- | ------------------------------- | ------------- | ---------- |
| 新增下载能力         | `packages/core/src/`          | `packages/adapters/src/`                  | `pnpm typecheck`                | 2026-06-02    | high       |
| 新增 API 端点        | `packages/server/src/`        | `packages/core/src/` (usecase)            | `pnpm typecheck`                | 2026-06-02    | high       |
| 修改 server 可观测性 | `packages/server/src/logging/` | `packages/server/src/download/`, `packages/server/src/analysis/`, `docs/testing/2026/` | `pnpm --filter @bilibili-downloader/server typecheck`, `pnpm typecheck`, `pnpm build` | 2026-08-02 | high |
| 修改视频分析能力      | `packages/server/src/analysis/` | `packages/adapters/src/llm/`, `packages/adapters/src/ffmpeg/`, `packages/vision-proxy/` | `pnpm typecheck`, `pnpm build` | 2026-08-21    | high       |
| 修改作业队列/触发链路 | `packages/server/src/worker/` | `packages/server/src/analysis/`（触发入队）, `packages/server/src/download/`, `src/prisma/contract.prisma`（`worker_job`/`worker_heartbeat`） | `pnpm --filter @bilibili-downloader/server typecheck`, `pnpm typecheck`, `pnpm build` | 2026-09-30 | high |
| 修改鉴权/权限映射     | `packages/server/src/user-auth/` | `packages/server/src/chat/`、`packages/server/src/analysis/analysis-task.controller.ts`（`@Roles` 放开点）, `packages/frontend/src/App.tsx`（导航与路径门禁）, `src/prisma/contract.prisma`（`user`/`user_session`） | `pnpm --filter @bilibili-downloader/server typecheck`, `pnpm typecheck`, `pnpm build`, `pnpm --filter @bilibili-downloader/server test` | 2026-09-30 | high |
| 新增 UI 页面         | `packages/frontend/src/`      | `packages/server/src/` (API)              | `pnpm typecheck`                | 2026-06-02    | high       |
| 修改下载器行为        | `packages/adapters/src/`      | `packages/core/src/` (ports)              | `pnpm typecheck`                | 2026-06-02    | high       |
| 修改 B站 API 适配     | `packages/adapters/src/bilibili/` | `packages/bilibili-api-sdk/` (底层接口), `packages/core/src/` (domain models) | `pnpm typecheck`, `pnpm --filter bilibili-api-sdk test`, `pnpm --filter @bilibili-downloader/server typecheck` | 2026-08-12    | high       |
| 修改部署配置          | `packages/docker/`            | `package.json` (scripts)                  | `pnpm docker:build`, `pnpm docker:build:server`, `pnpm docker:build:vision-proxy`, `docker compose config`（经 `node compose.mjs config`） | 2026-08-24    | high       |

## Large Or Fragile Files

| Path                                  | Risk                               | Preferred Approach                                     |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| `packages/core/src/`                  | 核心编排逻辑，改动需谨慎             | 优先阅读现有 usecase 和 port 接口，理解领域模型后再修改    |
| `packages/adapters/src/bilibili/`     | B站 API 适配，外部 API 变更敏感      | 底层接口调用统一走 bilibili-api-sdk，新增/修改接口优先改 SDK 并补测试 |
| `packages/server/src/`                | NestJS 模块装配，依赖注入复杂度高     | 新增 API 遵循现有 controller/service 模式               |
| `packages/server/src/user-auth/`      | 权限映射漂移会直接放开写/管理接口         | 守卫默认仅 admin（fail-closed）；放开新端点须显式 `@Roles`/`@Public()` 并同步 `docs/design/app-overview.md` 权限矩阵 |
| `packages/server/src/logging/`        | 安全字段 allowlist 漂移会直接影响敏感信息暴露 | 修改时优先保持 allowlist 思路，再用 route matrix + testing 文档验证 |
| `packages/server/src/analysis/`       | 视频分析编排横跨 LLM、字幕、截图、文档生成 | 保持 Node.js 作为业务编排主体，Python 只做本地视觉文件薄代理 |
| `packages/vision-proxy/`          | Python 依赖与本地文件路径能力，容易和 Node 编排漂移 | 仅透传 Node 指定的多模态请求，不加入业务语义；Node 编排与代理间仅经 HTTP 契约耦合 |

## Project-Specific Search Hints

- Use file patterns: `packages/*/src/**/*.ts`
- Use content anchors: `DownloadRequest`, `DownloadUseCase`, `ResourceParser`, `MediaDownloader`, `FFmpegMerger`
- Avoid editing generated files: `node_modules/`, `dist/`, `*.d.ts`（非手写的类型声明）

## Update Rule

Update this file when a change creates a new major entry point, moves common code, adds a new test location, or repeatedly causes agents to rediscover the same path.

If a listed path is missing, placeholders remain, or live imports contradict this map, do not treat the map as authority. Verify with the live repo, then update the map or mark the row low confidence before implementation.

If `Last Verified` is old for the project's pace, predates major structural changes, or the task touches a listed route's boundary, verify the live repo before relying on the row. Low-confidence rows do not block low-risk work after live verification, but protected-area, migration, or cross-module work should update the row before implementation.
