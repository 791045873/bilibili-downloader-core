# Module Boundaries

## Purpose

Define the main code ownership boundaries for `bilibili-downloader-core`.

## Package Boundaries

### `packages/core/`

- Responsibility: 下载领域模型、用例编排、Ports 接口定义、领域事件
- Allowed dependencies: 无（不依赖其他包，仅依赖 TypeScript 标准库和通用工具库）
- Forbidden dependencies: Vue, NestJS, CLI 框架, Express, B站 API 特定类型
- Owner docs: `docs/architecture/system-baseline.md`

### `packages/adapters/`

- Responsibility: Core 中所有 Ports 的具体实现
  - `bilibili/` — B站资源解析、视频详情 API、播放流 API
  - `transport/` — HTTP 下载器实现
  - `ffmpeg/` — 音视频合并与视频截图（`FfmpegMerger` / `FfmpegScreenshot`）
  - `fs/` — 文件系统操作、输出目录管理
  - `llm/` — Qwen 客户端（`QwenClient`，经 vision-proxy 读本地媒体）
  - `cos/` — 腾讯云 COS 客户端（`CosClient`，Phase 3 下沉，cloud/nas 各自薄 wrapper 引用）
- Allowed dependencies: `packages/core/`（仅使用其 Ports 接口和领域模型）、外部库（bilibili-api-sdk、cos-nodejs-sdk-v5 等）
- Forbidden dependencies: `packages/frontend/`, `packages/cloud-server/`, `packages/nas-worker/`, `packages/server-common/`
- Owner docs: `docs/architecture/system-baseline.md`
- Error boundary: 默认向上抛出带安全上下文的错误，不承担最终请求级、任务级或编排级错误日志职责。
- Diagnostic exception: 只有当 adapter 内部吞错、静默降级或 fallback 且上层无法感知该失败信号时，才允许在 adapter 内记录少量 `debug`/`warn` 诊断日志。
- Logging constraint: adapters 不得依赖 Nest Logger 或后端应用（cloud-server / nas-worker / server-common）的日志实现。

### `packages/server-common/`

- Responsibility: 后端共享内核，供 cloud-server 与 nas-worker 复用：DB/Prisma 契约（`src/prisma/contract.*`）+ `database.service.ts` 门面、日志（RequestLoggingInterceptor / FileConsoleLogger / safe log allowlist）、`worker_job`/`worker_heartbeat` 仓储 + `WorkerService` 类（`src/worker/worker.service.ts`）、作业契约（`src/worker/job-kinds.ts`）、path 锚点纯函数（`src/paths/path-anchor.ts`）、内建提示词；`scripts/` 内含 `ensure-pgvector.mjs` 与 `one-off-migrations/`。
- Allowed dependencies: 仅外部库（`@prisma/orm-postgres`、`pg`、`rotating-file-stream` 等），**不依赖** core/adapters/任何 workspace 包。
- Forbidden dependencies: `packages/core/`、`packages/adapters/`、`packages/cloud-server/`、`packages/nas-worker/`、`packages/frontend/`
- Owner docs: `docs/architecture/system-baseline.md`
- Note: `WorkerService` 为**类**，由 nas-worker（消费端）在运行时注册 handler 并驱动轮询；cloud-server 不实例化消费循环。

### `packages/cloud-server/`

- Responsibility: 云端对外 HTTP API（NestJS）——parse、download（创建/读取/停止/恢复/删除/配置）、video、B站扫码 auth（`src/auth`）、analysis 触发与查询（`analysis-job-producer.service.ts` 入队 / `ai-summary-query.service.ts` / `ai-summary-task.view.ts`）、prompt、chat-RAG、knowledge-search、user-auth（`APP_GUARD` 全局守卫）、settings（经 `api/analysis/config` 等端点）、worker-controller（只读 DB），以及全部后台作业的**生产**（入队 `worker_job`）。
- Allowed dependencies: `packages/core/`, `packages/adapters/`, `packages/server-common/`
- Forbidden dependencies: `packages/frontend/`, `packages/nas-worker/`
- Owner docs: `docs/design/app-overview.md`
- 物理隔离: **不含** ffmpeg / 分析执行引擎 / PathsService / 媒体路径 join / SMTP 出站（唯一出站例外：chat-RAG 多模态经 `openai` SDK 连 `QWEN_VISION_PROXY_URL`，见下方依赖图；Stage C 已由 `QwenClient` 换为 `openai` SDK，baseURL = 去 `/chat/completions` 后缀，端点/模型/配置不变）；B站 cookie 真源为 `app_settings`（`bili.cookie`/`bili.cookie.version`，版本刷新），cache 目录仍经 `src/config/bili-cache.ts` env 配置。
- Logging ownership: cloud-server 负责对外请求的高语义日志与错误语义（经 server-common 日志实现）。
- Async job boundary（生产者侧）：触发方（controller / 分析编排生产者）只负责入队 `worker_job`，不直接调用执行服务；`worker-controller` 仅只读查询，不 provide `WorkerService`。并发/去重由 `worker_job.dedup_key` 的 active-unique 索引在库层强制。

### `packages/nas-worker/`

- Responsibility: NAS 侧作业消费与执行（NestJS 应用上下文，**无对外 HTTP**）——`WorkerService` 消费端 + 注册 download/analyze/low_res_download/screenshot_retry/integrity_check handler、下载执行（`download-executor.service.ts`）、分析执行（`analysis-executor.service.ts`）、AnalysisEngine、Ffmpeg 截图/合并、screenshot-retry、summary-integrity、analysis-video-resolver、knowledge-publisher、notification（SMTP）、PathsService + path 锚点、QwenClient / vision-proxy 客户端。
- Allowed dependencies: `packages/core/`, `packages/adapters/`, `packages/server-common/`
- Forbidden dependencies: `packages/frontend/`, `packages/cloud-server/`
- Owner docs: `docs/design/app-overview.md`
- 物理隔离: 承载媒体路径与本地文件能力（PathsService、ffmpeg、本地视频存在性检查），这些能力云端不含。
- Async job boundary（消费者侧）：拥有 `worker_job`/`worker_heartbeat` 的 claim（SKIP LOCKED 守卫型原子 UPDATE）、租约续期（`lease_expires_at` 心跳）、`lease_owner` fencing 写终态与 reaper 重置过期租约；handler 在构造器注册、先于轮询。
  - 已移除的进程内调度机制：`DownloadScheduler` 低清队列、`AnalysisTriggerService.rebuildingIds`/`tryStartRebuild`、`SummaryIntegrityService` 的内存互斥；并发/去重改由 `worker_job.dedup_key` active-unique 强制。
  - download 作业：高清 `download` 自 Stage B-4 起已接通 `download` 作业 kind（cloud 入队、nas `download-job-handler` 认领执行）。

### `packages/vision-proxy/`

- Responsibility: 可选 Python 视觉薄代理，仅将 Node 指定的本地媒体路径/URL 转换为 DashScope 多模态请求并返回 OpenAI 风格响应；不加入任何业务语义（无编排、无任务管理、无数据库）。
- Allowed dependencies: 仅 Python 第三方库（`dashscope`、`python-dotenv`，经 `pyproject.toml` 锁定）；不依赖任何 pnpm workspace 包。
- Forbidden dependencies: 不依赖 `packages/core/`、`packages/cloud-server/`、`packages/nas-worker/`、`packages/server-common/`、`packages/adapters/` 等 Node 包；不通过代码导入 Node 侧实现。
- Owner docs: `docs/architecture/2026-07-06-video-analysis-baseline.md`
- 运行边界: 独立容器 `vision-proxy`（compose 网络内 `0.0.0.0:8765`，不发布宿主机端口）；宿主开发模式由 `scripts/start-vision-proxy.mjs` 经 `packages/vision-proxy/.venv` 拉起；开发模式密钥读 `packages/vision-proxy/.env`，容器模式密钥经 compose 注入。
- 通信边界: 与调用方（分析执行在 nas-worker；chat 多模态在 cloud-server）之间仅经 HTTP 契约（`/v1/chat/completions`、`/healthz`），共享 `/download` 文件系统保证本地媒体可读（本地媒体读取由承载 PathsService 的 nas-worker 侧使用）。

### `packages/frontend/`

- Responsibility: React 19 Web 前端，视频输入界面、下载列表、AI 总结、穿搭问答、设置页、用户管理
- Allowed dependencies: `packages/cloud-server/`（仅通过 HTTP API 通信，不直接导入）
- Forbidden dependencies: `packages/core/`（Core 模型不应直接暴露给前端）, `packages/adapters/`
- Owner docs: `docs/design/app-overview.md`

### `packages/docker/`

- Responsibility: Dockerfile 与构建脚本及 compose 编排。**当前仍为拆分前的旧单体布局**（`Dockerfile.server` 仍 COPY 已删除的 `packages/server/`，`pnpm docker:build` 失效）；三镜像（cloud-server / nas-worker / vision-proxy）接线属 **Stage D 保护区**，待人工批准后统一改造。
- Allowed dependencies: `packages/cloud-server/`, `packages/nas-worker/`, `packages/frontend/`, `packages/vision-proxy/`（仅通过构建流程，不通过代码导入）
- Forbidden dependencies: 不包含业务代码
- Owner docs: `docs/architecture/system-baseline.md`

## Dependency Direction

```
frontend ──(HTTP)──→ cloud-server
cloud-server / nas-worker ──→ adapters ──→ core
cloud-server / nas-worker ──→ server-common
nas-worker ──(HTTP)──→ vision-proxy   # 分析执行读本地媒体
cloud-server ──(HTTP)──→ vision-proxy  # chat 多模态
cloud-server ──(enqueue worker_job)──→ [DB] ──(consume)──→ nas-worker
docker ──(build)──→ cloud-server + nas-worker + frontend | vision-proxy
```

- Core 是最内层，不依赖任何其他包
- Adapters 依赖 Core（实现其 Ports）；COS 客户端 `CosClient` 位于 adapters
- server-common 仅依赖外部库，不依赖 core/adapters，供 cloud-server 与 nas-worker 共用
- cloud-server / nas-worker 并列依赖 core + adapters + server-common（非线性链）
- cloud-server 是唯一对外 HTTP 入口；nas-worker 无对外 HTTP，经 `worker_job` 表与 cloud-server 跨主机解耦（部署分离待 Stage D）
- Frontend 通过 HTTP 与 cloud-server 通信，不直接导入任何内部包
- Docker 仅作为构建打包层（当前为旧单体布局，待 Stage D 改造）

## Test Ownership

- 数据层/日志/作业队列行为测试在 `packages/server-common/tests/`（vitest + 真实 PostgreSQL）
- cloud-server / nas-worker 各有包内测试（`packages/cloud-server/tests/`、`packages/nas-worker/tests/`）
- core / adapters / frontend 暂无统一自动化测试（未来按包划分：core 单元、adapters 集成 mock、frontend 组件 + E2E）

## Rule

If a recurring design argument depends on module ownership, write the answer here instead of re-litigating it in chat.

For adapter failures specifically: prefer upward propagation with safe context; use adapter-local diagnostics only for hidden failures or hidden degradation that upper layers cannot otherwise observe.
