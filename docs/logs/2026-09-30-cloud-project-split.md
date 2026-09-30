# 2026-09-30 Phase 3 拆分（cloud-server / nas-worker）

## Stage A — server-common 抽离（纯重构，零行为变更）

### 新包

`packages/server-common`（`@bilibili-downloader/server-common`）：dist 直引（比照 `adapters`）、`tsc -b` 构建 + `scripts/copy-contract-artifacts.mjs`（tsc 不把输入声明文件 `contract.d.ts` 发到 dist，而 dist 内 `.d.ts` 仍引用它，故构建后复制 contract 三件套）。typecheck 用独立 `tsconfig.typecheck.json` 覆盖 `src` + `tests`（build 配置只 include `src`，受 `rootDir` 约束）。

### 迁入内容（git mv，保留历史）

- `src/prisma/`（contract.prisma + emit 产物 contract.d.ts/json）、`src/database/`（DatabaseService 2333 行 + PrismaService + 两个 module）、`src/logging/`（server-log.util / file-logger / request-logging.interceptor）
- `src/paths/path-anchor.ts`（纯函数；`PathsService` 留在 server，后续归 nas-worker）
- `src/analysis/prompt-template.ts` → `src/prompt/builtin-prompt.ts`（B1：消除 `DatabaseService → analysis` 反向边）
- `src/worker/worker.service.ts`（generic 轮询循环属基础设施；`worker.controller.ts`/`worker.module.ts` 留在 server）
- 出口为单一 barrel `src/index.ts`（`export *`），server 侧 30 个文件的 44 处 import 统一改为 `@bilibili-downloader/server-common`

### B2：DOWNLOAD_ROOT 由字符串注入

`DatabaseService` 不再 import `PathsService`；构造签名 `(prisma?, downloadRoot?)`，并以 **getter** 求值（未注入时 `resolve(process.env.OUTPUT_DIR ?? cwd/downloads)`）——与原 `PathsService.DOWNLOAD_ROOT` 同源同时机，避免构造期固化。4 处 `toRelativeDownloadRootPath(..., this.downloadRoot)` 行为不变。

### prisma 工作流

contract 真源随 DB 层落 server-common，`prisma:emit` 脚本改由 server-common 拥有；`server/prisma.config.ts` **保留**并把 contract 指向 `../server-common/src/prisma/contract.prisma`，使部署链与 vitest globalSetup 仍可从 server 包执行 `prisma db init`（本阶段不碰部署脚本）。`scripts/seed.mjs` 改从包名导入 DatabaseService。

### 测试归属

迁入 server-common 11 文件 / 75 用例（database 的 ai-prompt、chat、knowledge、settings、summary-render-read、type-semantics、user-auth、worker-job + prisma-service + path-anchor + worker-loop）。`task`/`analysis-sub-task`/`ai-summary-task`/`summary-integrity`/`screenshot-retry` 仍 import `analysis/*` 与 `PathsService`，留在 server 以免形成 `server-common → server` 反向边。server-common 的 globalSetup 复用 server 包的 `ensure-pgvector.mjs`（该脚本被容器启动链引用，属 Stage D 保护区，本阶段不迁）。

顺带修正：`task.test.ts` 一处失效 import（`../src/database/...`——server 的 `tsc --noEmit` 只 include `src`，tests 从未被类型检查，故长期未暴露）；`chat.test.ts` 一处 `unknown` 索引类型错误（仅断言写法）。

### 验证

- `pnpm typecheck`（8 包）、`pnpm build`（含 `nest build`）全绿。
- **计数守恒**：迁移前 28 files / 216 tests ⇒ server 17/141 + server-common 11/75 = 28/216，全绿，零行为变更。

### 已知破坏（须在 Stage D 修复，已记入 plan Deferred）

`pnpm docker:build` 自本阶段起失效：`Dockerfile.server` 仍按单体布局 `COPY packages/server/...` 且从 `/app/packages/server/src/prisma/` 取 contract（已迁走），运行镜像内 `prisma.config.ts` 的相对路径也不再成立。计划前置门要求 Stage A–C 不改部署、部署文件变更须人工批准，故本阶段不擅自改 Dockerfile；本地开发/测试/构建不受影响。

## Stage B-1 — 清理死代码 + 删除 POST /api/analysis/run

### 删除项（均先核实全仓无调用方）

- 5 处死注入：`analysis.controller.ts` 的 `AnalysisTriggerService`、`analysis-video-resolver.ts` 的 `DownloadScheduler`、`analysis-task.controller.ts` 的 `SummaryIntegrityService`（完整性检查已改走 `enqueueJob`），以及随 `/analysis/run` 一并失效的 `AnalysisVideoResolver` + `PromptService`
- `DownloadService.getTasks`（controller 走 `getTasksPaginated`，此方法全仓无调用；注意与 live 的 `DatabaseService.getTasks` 同名但无关）
- `abortControllers` + `abortTask`：全仓**无任何 `.set()`**，`abortTask` 实为 no-op；`download-scheduler.deleteTask` 里的调用一并删除，注释改为「运行中的下载无法真正中止」
- `download.dto.ts` 的 `SingleDownloadDto`（零引用）
- `POST /api/analysis/run` 及连带死码：`AnalysisRequest` 接口、`validateRequest`（59 行）、`node:path` 与 `AnalysisEngine`/`AnalysisInput` import、`prompt.service.ts` 的 `resolveForRun`（唯一调用方就是该端点）

### 为什么删端点

该端点在 controller 里直接 `new AnalysisEngine(...)` 并跑本地绝对路径，`AnalysisEngine` 链带 `FfmpegScreenshot`/`QwenClient` —— 与需求「云端项目不得依赖 ffmpeg / 分析执行 / vision-proxy」硬规则互斥，而「所有对外 HTTP 由 cloud-server 提供」又要求它留在 cloud。前端全文无调用方，用户裁决删除。

**收益**：`analysis.controller.ts` 的 ctor 现只剩 `DatabaseService` + `DownloadScheduler` + `DownloadService`，cloud 侧再无通向 `AnalysisEngine`/`AnalysisVideoResolver` 的 import 路径 —— 物理隔离从此可用一条 grep 断言证明。

保留 `getLlmConfig`（删 `runAnalyze` 后暂无引用）并加注「Stage C 将改为 openai SDK，故保留」，避免 Stage B 删掉、Stage C 找不到。

### 验证

- 全仓 `typecheck` / `build` 绿；server 17 files / 141 tests、server-common 11 files / 75 tests 全绿（**216 计数不变**，本片未动任何测试）。
- 断言：`rg "AnalysisEngine|AnalysisVideoResolver|PromptService|AnalysisTriggerService" analysis.controller.ts` → 0 命中；`rg "abortTask|SingleDownloadDto|resolveForRun|abortControllers|analysis/run" packages/*/src` → 0 命中（仅剩 `db.getTasks()` 这一无关同名方法）。
