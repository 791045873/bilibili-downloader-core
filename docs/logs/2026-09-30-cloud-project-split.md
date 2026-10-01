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


## Stage B-2 — 作业契约下沉 + 纯 DB 去重

### 作业契约下沉（N6）

新增 `packages/server-common/src/worker/job-kinds.ts`（经 barrel 导出）：`JOB_KIND` 常量、各作业 payload 类型、dedupKey 构造器（`downloadDedupKey`/`analyzeDedupKey`/`analyzeContinuationDedupKey`/`lowResDownloadDedupKey`/`screenshotRetryDedupKey` + `INTEGRITY_CHECK_DEDUP_KEY`）。替换全仓 **9 处手写 dedupKey 副本**：`analysis-trigger.service.ts`(analyze + analyze:cont)、`analysis.controller.ts`(analyze + lowres)、`analysis-video-resolver.ts`(lowres)、`analysis-task.controller.ts`(analyze×2 + integrity_check + screenshot_retry)。拆分后 cloud/nas 共引一处，消除跨包静默漂移。

### N2 纯 DB 去重（已改写 AC3）

`create-dedup.ts`：`CreateDedupInput` 去掉 `completedOutputFile`/`fileExists`，改为 `completedTaskExists: boolean`；`download.service.ts` 的 `evaluateCreateDedup` 去掉 `fileExists` 磁盘判定与 `resolveFromDownloadRoot` import，改为「active 存在 或 已有 success 任务则拦截」。行为变化：DB 有 success 记录但盘上文件已删时由放行重下改为 409 拦截——需求 `docs/requirements/2026-09-09-download-create-dedup.md` 需求项 4 / AC3 已按人工批准改写。

### 验证

- 全仓 `typecheck` / `build` 绿。
- server **17 files / 140 tests**（`create-dedup.test.ts` 由 5 → 4 用例，按新 AC3 重写：active 拦截、success 拦截、**文件已删仍拦截**、无记录放行）；server-common **11 files / 75 tests**，其中 `worker-job.test.ts` **零改动仍绿**（dedupKey 下沉未改作业仓储行为）。
- 计数：216 → **215**（create-dedup 少 1 用例，符合 AC3 收窄预期，非回归）。
- 断言：`rg 'dedupKey:\s*`' packages/*/src` → 0 命中（全部改为构造器调用）。


## Stage B-3 — WorkerService per-kind 并发上限（裁决 B3）

- `claimNextJob(queue, owner, ttl, excludeKinds=[])`：SQL 增 `AND ($4::text[] IS NULL OR kind <> ALL($4::text[]))`，空数组退化为旧行为。
- `worker.service.ts`：新增 `runningByKind` per-kind 运行计数、`perKindLimit(kind)`（`WORKER_MAX_CONCURRENT_<KIND>` → download 兼容旧 `MAX_CONCURRENT_DOWNLOADS` → 缺省全局 `WORKER_MAX_CONCURRENT`）、`saturatedKinds()`；`pollOnce` 把已达 per-kind 上限的 kind 透传给 `claimNextJob` 排除。
- 解决 B3：高清 `download` 迁 worker_job 后不再因 `MAX_CONCURRENT_DOWNLOADS` 失效而与长耗时 `analyze` 抢同一全局 2 槽；缺省（无 per-kind env）行为与 Phase 2 完全一致。
- 验证：`worker-loop.test.ts` 原 6 用例零改动仍绿（向后兼容证明）+ 新增 2 用例；server-common 11/77、server 17/140 全绿；typecheck/build 绿。


## Stage B-4 — 接通 download 作业 kind（单体内）

### server-common
- 新增 `claimCreatedTaskById(id)`：单条守卫 `UPDATE task SET status='downloading' WHERE id=$1 AND status='created' RETURNING`，0 行返回 undefined——跨进程原子，取代非原子的 `claimNextCreatedTask`（已删除）。
- 新增 `findActiveDownloadJobByTask(taskId)`：按 `kind='download' AND ref_id AND status IN (queued/leased/running)` 取活跃作业，供 stop/delete 取消。

### DownloadService（去 taskCache）
- 删 `taskCache` / `onTaskFinished` / `restoreTaskCacheFromDatabase` / `TaskEntry`。
- `executeTask` 开头原子认领（`claimCreatedTaskById`），非 created 直接 return（不抛，避免作业重试风暴）；状态门收紧为**仅 created**；进度/完成/失败只写 DB。
- `stopTask`/`resumeTask` 改读 DB 守卫；`deleteTask`/`clearTasks` 去缓存。

### DownloadScheduler（生产者 + handler 宿主）
- 注入 `WorkerService`，注册 `download` handler；删 `runningSet`/`tryScheduleNext`，高清并发交 B-3 per-kind（`WORKER_MAX_CONCURRENT_DOWNLOAD` 回退 `MAX_CONCURRENT_DOWNLOADS`）。
- `createDownload`/`resumeTask` → `enqueueDownloadJob`（dedupKey 幂等）；`stopTask`/`deleteTask` → `cancelActiveDownloadJob`（delete 先取消）。
- handler：`payload.taskId` → `getTaskById`（无则跳过）→ `executeTask` → `onAnalysisTrigger?.`（analyze 的 success 校验照旧 gate）。
- B6 兜底：`onModuleInit` 为所有 created 任务补入队；`downloading→failed` 启动对账保留，注明 B-5 归 nas-worker。

### 验证
- 全仓 typecheck/build 绿；server **17 files / 138 tests**（删 2 条过时 claimNextCreatedTask 用例）、server-common **12 files / 80 tests**（新增 download-job.test 3 例）。
- 五链路手测留待部署前人工确认（见 plan Note）。
