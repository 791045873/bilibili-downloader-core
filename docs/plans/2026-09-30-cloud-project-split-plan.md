# 2026-09-30 Phase 3 — 拆分 cloud-server / nas-worker（server-common 前置 + 项目拆分 + 部署[gated]）

> Plan Status: done（Stage A–E 全部完成并过独立 closure 评审；Stage D 部署三镜像经人工批准 2026-10-01 实施，`pnpm docker:build` 三镜像构建通过、`docker compose config` 校验通过。真实 compose up/公网暴露/端到端五链路属运维上线动作）
> Last Reviewed: 2026-09-30
> Source: `docs/requirements/2026-09-17-cloud-project-split.md`
> Related: 上游 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（Phase 3）；前置 Phase 1a/1b/2（已闭合）、完整性检查重定义、重试截图（已闭合）
> Audit: required（多模块 + 部署保护区 + LLM 客户端替换；reviewer availability=none → 独立子代理或 cold-replay 留证；**部署子阶段与公网暴露另需人工批准**）
> Testing: `docs/testing/2026/09-30-cloud-project-split-testing.md`

## 前置门（硬约束，人工裁决 2026-09-23）

- **auth 先行（阻塞公网暴露）**：本阶段将 HTTP 收敛到 `cloud-server` 并计划公网暴露；需求前置门要求 **auth 须在公网暴露前完成**（`docs/requirements/2026-09-17-user-auth.md`）。故本计划的**部署/公网暴露子阶段（Stage D）在 auth 未完成前保持 blocked**；Stage A–C（纯代码重构，不改部署、不公网暴露）可先行。
- **server-common 抽离为独立前置子阶段**（Stage A），不与项目拆分/镜像并为单切片。
- **部署细节需人工批准**（部署保护区，reviewer=none）：Stage D 的 Dockerfile/compose/DB 角色变更须经用户显式批准后方可实施。
- LLM 客户端：云端多模态由 `QwenClient` 换 `openai` SDK 连接**所配置的 `QWEN_VISION_PROXY_URL`**（模型/端点/配置不变）；NAS 侧仍用 `QwenClient`/vision-proxy。

## Current Baseline

- 单体 `packages/server`（NestJS）承载全部：parse/download/analysis/chat/RAG/knowledge/prompt/settings + worker 执行（下载/分析引擎/截图/screenshot_retry/完整性检查）+ 进程内 `WorkerService` 轮询（Phase 2）。
- 依赖：`server` → `adapters` → `core`；`vision-proxy`（Python）独立；`frontend` 独立；`bilibili-api-sdk`。
- `DatabaseService`（约 1800 行）+ logging + `worker_job` 仓储 + settings/cookie 读写 + 共享类型均在 `server`，云端与 worker 都要用。
- Phase 2 已提供跨主机作业机制（worker_job + 租约/心跳/reaper），worker 循环当前与 api 同进程；Phase 3 将其拆到独立 `nas-worker` 进程/镜像。

## Goals

- 三包结构：`packages/server-common`（DB/Prisma、logging、worker_job 仓储、settings/cookie、共享类型/配置）、`packages/cloud-server`（对外 HTTP api）、`packages/nas-worker`（作业消费 + 执行，无公网 HTTP）。依赖：cloud-server/nas-worker → server-common → adapters → core。
- 模块归属：云端=parse/download(创建读取)/analysis(触发查询)/chat-RAG/knowledge/prompt/settings/作业生产；NAS=下载执行/分析引擎/截图/screenshot_retry/完整性检查/vision-proxy 客户端/作业消费/PathsService+媒体锚点。
- 物理隔离：cloud-server 不含 ffmpeg/分析执行/vision-proxy 代码；NAS 仅出站。
- 云端多模态换 `openai` SDK（连 `QWEN_VISION_PROXY_URL`）；云端 `FileCacheStore`、NAS 内存缓存。Cookie `app_settings` 物化 + 版本刷新。
- 三镜像（cloud-server 无 ffmpeg/Python；nas-worker 含 ffmpeg + compose 内 vision-proxy；vision-proxy 独立），worker 独立最小权限 DB 角色（**Stage D，人工批准 + auth 前置**）。

## Non-Goals

- 用户系统/auth（独立需求；本阶段仅将其列为公网暴露前置）。
- 完整性判据/报告结构变更；download 迁 worker_job（Phase 2 已完成）；删除本地文件（Phase 4）。

## Execution Plan

### Stage A - server-common 抽离（纯重构，无行为变更）

Status: done
Targets: 新增 `packages/server-common`；从 `packages/server` 迁出 DB/Prisma、logging、worker_job 仓储、settings/cookie、共享类型/配置；`server` 改依赖 `server-common`
- Item Types: `Add | Fix`
- Prereqs: 无（不改部署/不公网暴露）
- [x] `Add`：建 `@bilibili-downloader/server-common` 包（tsconfig/exports 比照 `adapters`）。迁入 `DatabaseService`/`PrismaService`/contract 访问、`server-log.util`、worker_job 仓储、settings/cookie 读写、共享 record 类型。
- [x] `Fix`（B1 反向依赖）：`DatabaseService` 现 import `../analysis/prompt-template.js`（builtin 提示词播种，`database.service.ts:14-17,219-220`）——将 `prompt-template.ts` 的 builtin 常量迁入 server-common，`analysis` 改从 server-common 引用；消除 `server-common → analysis` 反向边。
- [x] `Fix`（B2 路径耦合）：`DatabaseService` 现 import `PathsService` + `path-anchor`（`database.service.ts:19-21,175-176`，写规范化 `toRelativeDownloadRootPath(...,DOWNLOAD_ROOT)`）——将纯函数 `path-anchor.ts` 迁入 server-common，并把 `DOWNLOAD_ROOT` 作为**字符串配置**注入 `DatabaseService`（去掉对 `PathsService` 的 import）；`PathsService` 本体保持 nas-worker 专属。运行期不变（读侧返回原始相对值；云端 createTask 不传 outputFile → 规范化为 no-op）。
- [x] `Fix`：`server` 内引用改指向 `server-common`；`prisma:emit` 产物归属与脚本路径对齐（产物随 contract 落 server-common，emit 脚本路径同步）。
- [x] `Fix`（S2 测试/产物归属）：随迁移移动相关测试至 server-common——`tests/database/*`、`tests/prisma/prisma-service.test.ts`、`tests/worker/worker-loop.test.ts`、`tests/database/worker-job.test.ts`、`tests/database/settings.test.ts`、`tests/paths/path-anchor.test.ts`；`TEST_DATABASE_URL`/globalSetup 随包对齐。
- [x] `Proof`：`pnpm typecheck`、`pnpm build`、两包 `test` 全绿（行为不变）。
- [x] `Note`（实施口径）：`DOWNLOAD_ROOT` 注入保留 getter 语义（未注入时每次求值读 `OUTPUT_DIR`），与原 `PathsService.DOWNLOAD_ROOT` 同源同时机，避免构造期固化导致测试/运行差异。
- [x] `Note`（WorkerService 归属）：generic 轮询循环 `worker.service.ts` 随 worker_job 仓储迁入 server-common（Stage B 由 nas-worker 注册 handler 消费）；`worker.controller.ts`/`worker.module.ts` 留在 server（属云端 HTTP 面）。
- [x] `Note`（测试归属细化）：`tests/database/` 中 `task`/`analysis-sub-task`/`ai-summary-task`/`summary-integrity`/`screenshot-retry` 仍 import `analysis/*` 与 `PathsService`，留在 server 以避免 `server-common → server` 反向边；其余 8 个 + prisma/worker/paths 共 11 文件 75 用例迁入 server-common。计数守恒：迁移前 28 files / 216 tests = 迁移后 server 17/141 + server-common 11/75。
- [x] `Note`（prisma 配置双份，刻意）：contract 真源随 DB 层落 `server-common/src/prisma/`；`server/prisma.config.ts` 保留并把 contract 指向 `../server-common/src/prisma/contract.prisma`，使**部署链与 vitest globalSetup 仍能从 server 包执行 `prisma db init`**，本阶段不触碰部署脚本。`prisma:emit` 脚本改由 server-common 拥有。
- [x] `Note`（顺带修正）：`tests/database/task.test.ts` 原有一处失效 import（`../src/database/...`，因 server 的 `tsc --noEmit` 只 include `src` 而从未被类型检查发现）随迁移修正；server-common 的 typecheck 覆盖 `src` + `tests`，并顺带修掉 `chat.test.ts` 一处 `unknown` 索引的类型错误（仅测试断言写法，无行为变化）。
Exit Criteria:
- [x] server-common 独立可编译；server 经其访问 DB/日志/作业仓储；全量测试绿（零行为变更）。
- [x] `docs/logs/` 记录。


### Stage B - 拆分 cloud-server / nas-worker（按二次复审切成 B-1…B-5）

Status: planned（底图 + 二次独立复审 + 三项人工裁决齐备，可按子片顺序开工）
Targets: `packages/server` → `packages/cloud-server` + `packages/nas-worker`
- Prereqs: Stage A
- `Note`（底图）：逐成员归属、构造器依赖、跨侧断点、风险点、测试落位见 `docs/analysis/2026-09-30-phase3-stage-b-split-map.md`。二次复审结论见本文件 Plan Audit 段。
- `Note`（三项人工裁决，2026-09-30）：
  - **N1**：新增 `kind:"download"` 走作业契约（`{taskId}`、`queue:"nas"`、`refType:"task"`、`dedupKey: download:${bvid}:${cid}`），不采用 nas 定时 `claimNextCreatedTask` 轮询。即需求 `2026-09-17-cloud-project-split.md:51` 预留项。
  - **N2**：去重退化为纯 DB 判定。**已按批准改写** `docs/requirements/2026-09-09-download-create-dedup.md`（需求项 4 / AC3 + 2026-09-30 修订段）：DB 有 success 记录但盘上文件已删时由「放行重下」变为 **409 拦截**。
  - **B7**：删除 `POST /api/analysis/run`（前端无调用方），连带死码见底图。
- `Note`（既有隐患，本阶段不修）：`analyze:cont:` 与 `analyze:` 是两个 dedupKey，活跃唯一索引拦不住彼此 → 同资源可并发双跑。Stage B 让触发入口共存增多、概率放大，但不在拆分切片里顺手修，转 Deferred。

#### B-1 清理与删端点

Status: done
- [x] `Fix`：删 5 处死注入（`analysis.controller.ts:18,56`、`analysis-video-resolver.ts:56`、`analysis-task.controller.ts:38`）、`download.service.ts:742-748` `getTasks`、no-op 的 `abortControllers`/`abortTask`（含 `download-scheduler.ts:117`）、`download.dto.ts:23-32` `SingleDownloadDto`、`POST /api/analysis/run`（`analysis.controller.ts:63-101`）及其连带死码（`:13/14/16/27-43/55/60/536-594`、`prompt.service.ts:111-129` `resolveForRun`）。
- [x] `Note`（须与 Stage C 协调）：`analysis.controller.ts:495-517` `getLlmConfig` 在删 `runAnalyze` 后变无引用，而 Stage C 要改它 → 本片保留并**已在代码内加注「待 Stage C 复用」**，Stage C 条目须指向该方法。
- [x] `Proof`：全仓 `typecheck` + `build` 绿；server 17 files/141 tests + server-common 11 files/75 tests（**216 计数不变**）；三条 grep 断言 0 命中；`/api/analysis/run` 已从路由表移除。


#### B-2 作业契约下沉 + N2 纯 DB 去重

Status: done
- [x] `Add`：`server-common/src/worker/job-kinds.ts`（kind 常量 + payload 类型 + dedupKey 构造器），替换 **9 处**手写副本（analysis-trigger ×2、analysis.controller ×2、analysis-task.controller ×4、analysis-video-resolver ×1）。
- [x] `Fix`：`create-dedup.ts` 去 `fileExists`/`completedOutputFile` 改 `completedTaskExists`；`download.service.ts` 的 `evaluateCreateDedup` 去磁盘判定与 `resolveFromDownloadRoot` import。
- [x] `Proof`：`rg 'dedupKey:' packages/*/src` 全部为构造器调用、无模板字面量；`create-dedup.test.ts` 按新 AC3 重写（4 用例，含「文件已删仍拦截」）后绿；`worker-job.test.ts` **零改动仍绿**；全仓 typecheck/build 绿；server 17/140 + server-common 11/75 = 215（create-dedup 少 1 用例，AC3 收窄预期）。

#### B-3 WorkerService per-kind 并发（裁决 B3）

Status: done
- [x] `Fix`：`claimNextJob` 增 `excludeKinds` 过滤（SQL `kind <> ALL($4)`，空数组=旧行为）；`worker.service.ts` 新增 `runningByKind` 计数 + `perKindLimit(kind)`（读 `WORKER_MAX_CONCURRENT_<KIND>`，download 兼容旧 `MAX_CONCURRENT_DOWNLOADS`，缺省退化为全局 `WORKER_MAX_CONCURRENT`）+ `saturatedKinds()`；`pollOnce` 把已达上限的 kind 排除，避免长耗时 analyze 占满全局槽位。
- [x] `Proof`：`tests/worker/worker-loop.test.ts` 原 6 用例**零改动仍绿**（向后兼容）+ 新增 2 用例（claimNextJob 排除指定 kind 且空数组=Phase 2 默认；某 kind 达 per-kind 上限时排除该 kind、其他 kind 仍派发）；server-common 11 files/77 tests、server 17/140 全绿；全仓 typecheck/build 绿。

#### B-4 接通 `download` kind（单体内完成）

Status: done
- [x] `Add`（原子认领）：server-common 新增 `claimCreatedTaskById(id)`（守卫 `UPDATE ... WHERE id AND status='created' RETURNING`，跨进程安全），**删除**非原子的 `claimNextCreatedTask` 及其唯一调用点。
- [x] `Add`（download handler）：`DownloadScheduler` 注入 `WorkerService`，`registerHandler(JOB_KIND.download, handleDownloadJob)`；handler 读 `payload.taskId` → `getTaskById`（无则跳过）→ `executeTask` → `onAnalysisTrigger?.(taskId)`。
- [x] `Fix`（生产者）：`createDownload`/`resumeTask` 成功后 `enqueueJob(download, dedupKey=downloadDedupKey)`；`stopTask`/`deleteTask` 先 `findActiveDownloadJobByTask` → `cancelWorkerJob`（delete 先取消避免 handler 认领后查无 task 重试）。删 `runningSet`/`tryScheduleNext`/`onTaskFinished`；并发交 B-3 的 per-kind（`WORKER_MAX_CONCURRENT_DOWNLOAD` 回退 `MAX_CONCURRENT_DOWNLOADS`）。
- [x] `Fix`（去 taskCache）：`DownloadService` 删 `taskCache`/`onTaskFinished`/`restoreTaskCacheFromDatabase`/`TaskEntry`；`executeTask` 开头原子认领、状态门收紧为仅 `created`；进度/完成/失败只写 DB；`stopTask`/`resumeTask` 改读 DB 守卫。截图兜底同步链（`analysis-video-resolver` 的 `createTask(skipDedup)+executeTask`）仍可用、不触发 analyze。
- [x] `Fix`（B6 入队漏失兜底）：`onModuleInit` 对所有 `created` 任务补入队 download 作业（dedupKey 幂等）；启动 `downloading → failed` 对账保留并注明 B-5 归 nas。
- [x] `Proof`：新增 `server-common/tests/database/download-job.test.ts`（3 例：created 原子认领 / 非 created 返回 undefined / 连续两次仅首次成功）；`task.test.ts` 删 2 条过时的 `claimNextCreatedTask` 用例（随方法删除）。全仓 typecheck/build 绿；server 17 files/138 tests、server-common 12 files/80 tests；无 `claimNextCreatedTask`/`taskCache`/`onTaskFinished`/`restoreTaskCacheFromDatabase` 残留。
- [ ] `Note`（手测待运行级确认，不阻塞代码闭合）：五链路（创建→执行→完成→analyze 入队 / stop 后 job canceled 且任务不跑 / resume 重入队 / delete 无重试日志 / 重启 downloading 回收不误杀）留待部署前人工确认。

#### B-5 建骨架 + 拆类 + 双向搬迁 + 退役 server

- [x] `Add`（已完成，第 2 子步）：`cloud-server`（HTTP，`NestFactory.create`+listen，**不 provide WorkerService**）/ `nas-worker`（无 HTTP，`createApplicationContext`+shutdown hooks）骨架；均依赖 server-common/adapters/core，`tsc -b` 构建，typecheck/build 绿。**待办**：nas 的 `registerHandler` 移到构造器以先于轮询（随 WorkerService 消费端迁入 nas 时做）。
- [x] `Add`（已完成，第 1 子步）：`adapters/src/cos`（框架无关 `CosClient` + `resolvePublicUrlPrefix`，比照 `adapters/src/embedding`）；`cos-store.service` 改薄 wrapper、调用点零改动；`cos-nodejs-sdk-v5` 依赖移至 adapters。typecheck/build/测试绿。**待办**：下沉 `normalizeEmbeddingText` 等 embedding 易漂移项（随 nas 搬迁时做）。不扩 server-common 职责、不改需求。
- [ ] `Fix`：三大类拆分——`AnalysisTriggerService`（903 行）→ cloud `analysis-job-producer.service.ts` + `ai-summary-query.service.ts` / nas `analysis-job-handlers.service.ts` + `analysis-executor.service.ts`（`claimAiSummaryTask` 与执行同侧同窗口；`reconcileStaleAnalysisState` 留 nas）；`DownloadService`（947 行）与 `DownloadScheduler` 按底图拆；`document-generator.ts` 两侧各一份并互标「渲染输出须逐字节一致」。
- [ ] `Fix`（N4 扩大口径）：cloud 侧三处 `PathsService` 残留全部解除——`COOKIE_FILE_PATH`（改 `app_settings` 物化或独立 env）、`BILI_API_CACHE_DIR`（cloud 独立 cache dir 配置）、`main.ts:24-25/32`（删 `SUMMARY_BASE_DIR` mkdir 与 DOWNLOAD_ROOT 日志）。
- [ ] `Fix`：模块图解纠缠——`VideoController`/`AuthController` 随 cloud 迁出 DownloadModule；`KnowledgeSearchController` 移入 cloud 独立 knowledge 模块；`ChatModule` 不再 `imports: [AnalysisModule]`。
- [ ] `Fix`：各包 `package.json` 依赖分配（cloud：`sharp`/COS/`multer`/`@nestjs/platform-express`；nas：COS/`nodemailer`/ffmpeg/`QwenClient`；两侧：`lodash`）；测试按底图第 7 节落位；`packages/server` 退役。
- [ ] `Proof`：每包 `typecheck`/`build`/`test` 独立绿；`rg -n "adapters/ffmpeg|analysis-engine|PathsService" packages/cloud-server/src` → 0 命中（`adapters/llm` 因 chat 暂例外，须登记）；`rg -n "@Controller" packages/nas-worker/src` → 0 命中；nas 启动日志含 worker 轮询、cloud 不含；新增「无 handler 分支不被命中」的启动顺序测试绿；全仓 `pnpm typecheck`/`pnpm build` + 测试计数守恒表入 `docs/logs/`。

Exit Criteria:
- [ ] B-1…B-5 逐片各自验证通过（每片 typecheck/build/test 绿）。
- [ ] 两应用可独立编译；模块归属符合需求表；cloud-server 物理隔离经 grep 断言证明。
- [ ] N1-N6 与二次复审 B1-B7 逐条落地或显式裁决留证。
- [ ] `docs/logs/` 记录 + 测试计数守恒。



### Stage C - LLM 客户端 / 缓存 / Cookie 落位

Status: done（C-1 openai SDK / C-2 缓存 / C-3 cookie 物化，三子片各自验证并过独立 closure 评审）
Targets: cloud-server 多模态改 `openai` SDK；缓存策略；cookie 物化/刷新
- Item Types: `Fix | Add`
- Prereqs: Stage B
- [x] `Fix`（C-1）：云端多模态改 `openai` SDK 连 `QWEN_VISION_PROXY_URL`——新增 `cloud-server/src/chat/openai-vision-client.ts`（baseURL = 去 `/chat/completions` 后缀，端点/模型/配置不变），`chat.service.ts` 三处调用点零改动；删除拆分后无调用方的 `analysis.controller.ts` 私有 `getLlmConfig`。**Q12 已确认**：代理从 body 透传 `enable_thinking`/`response_format`，SDK 原样序列化，单测断言 URL+body+header 等价。`openai` 仅加入 cloud-server 依赖；NAS 保留 `QwenClient`/vision-proxy 不变。
- [x] `Fix`（C-2）：云端 `FileCacheStore`（parse/download-task）保留；NAS `download-executor` 去 `cacheStore` 用 SDK 默认内存缓存。
- [x] `Fix`（C-3）：cookie 真源改 `app_settings`（`bili.cookie`/`bili.cookie.version`）+ 版本刷新（含 ParseService 客户端刷新）+ 云端手动粘贴入口 `POST /api/auth/cookie`（受全局 AuthGuard 保护、不记明文）；NAS 启动物化 + 作业前按版本刷新；DatabaseService 新增 getBiliCookie/getBiliCookieVersion/setBiliCookie。
- [x] `Proof`：`typecheck`/`build` 绿；新增单测（server-common bili-cookie 4、cloud openai-vision-client 7 + cookie-refresh 2、nas cookie-refresh 1）。问答图片路径/分析路径对真实 vision-proxy 的运行期行为属部署前人工验证。
Exit Criteria:
- [x] 云端 SDK 连接配置化 URL；缓存/cookie 策略按需求；行为与 Phase 2 一致（请求契约逐字段等价，运行期连通性待部署前人工确认）。
- [x] `docs/logs/` 记录。

### Stage D - 部署（保护区，人工批准 2026-10-01 实施）

Status: done（人工显式批准后实施；三镜像构建通过、compose 校验通过、容器内物理隔离实证）
Targets: 三 Dockerfile、compose、worker 最小权限 DB 角色
- Item Types: `Fix | Proof`
- Prereqs: Stage A-C + **auth 完成**（已闭合）+ **用户显式批准部署动作**（已批准）
- [x] `Fix`：新增 `Dockerfile.cloud-server`（无 ffmpeg/Python，含前端静态，schema 属主跑 db init）、`Dockerfile.nas-worker`（含 ffmpeg，无前端/Python，不建库），删旧 `Dockerfile.server`；`docker-compose.yml` 三服务（cloud-server HTTP + nas-worker 执行 + vision-proxy，vision-proxy/ nas 不暴露宿主端口）；worker 最小权限 DB 角色经 `DATABASE_URL=${WORKER_DATABASE_URL:-${DATABASE_URL}}` 接线；`compose.mjs`/脚本/`.env.example` 三目标化。
- [x] `Proof`：`pnpm docker:build` 三镜像真实构建成功（cloud-server/nas-worker/vision-proxy）；`docker compose config` 渲染三服务通过、DATABASE_URL fail-closed；容器内实证 cloud 无 ffmpeg/python、contract 在位、/app/public 有，nas 有 ffmpeg、无前端/prisma.config。
Exit Criteria:
- [x] 三镜像构建通过；compose 校验通过；部署变更经人工批准。
- [~] 真实 `docker compose up`、公网暴露、跨主机 DB 连通、端到端五链路：属运维上线动作，待运维执行（见 Closure 的部署期待办）。

### Stage E - 文档与闭合

Status: done
Targets: `docs/architecture/system-baseline.md`、`module-boundaries.md`、`docs/design/app-overview.md`、`feature-inventory.md`、`docs/context/codebase-map.md`、`project-context.md`、`docs/backlog/README.md`、`docs/logs/`
- Item Types: `Fix | Proof`
- Prereqs: Stage A-C（D 视 auth/批准）
- [x] `Fix`：owner docs 全部对齐三应用结构（依赖方向更正为非线性菱形：server-common 无 workspace 依赖、cloud/nas 并列依赖三者）、模块归属、物理隔离、部署形态标注为「代码已拆分、三镜像接线待 Stage D、docker:build 当前失效」。
- [x] `Proof`：独立子代理 closure audit（见 Closure Audit Evidence）；should-fix/nit 已并入（claim 改名、Stage C QwenClient 例外登记、陈旧路径修正）。
Exit Criteria:
- [x] owner docs / backlog / log 一致；closure gates 按部分闭合（Stage D 延后）标注。

## Plan Audit

- Status: passed（with required fixes applied）
- Reviewer / Agent: 独立子代理（General，fresh-eyes cold-replay，reviewer availability=none）
- Evidence: 2026-09-30 独立 plan audit，Verdict=PASS-WITH-REQUIRED-FIXES，逐条对照 live code。分阶段骨架（A server-common→B 拆应用→C LLM/缓存/cookie→D 部署[gated]→E 文档）与部署保护区/auth 先行门均正确。已并入 blocker：B1 迁 prompt-template 常量入 server-common（消除 DatabaseService→analysis 反向边）；B2 迁 path-anchor 入 server-common + DOWNLOAD_ROOT 字符串注入 DatabaseService（PathsService 保持 nas 专属）；B3 沿作业 kind/payload 契约拆分 AnalysisTriggerService（cloud 生产者 / nas 执行者）；B4 拆分 DownloadService 创建vs执行 + AuthController 移出 DownloadModule 归 cloud。should-fix：S1 列举云端 LLM 调用点 + openai 依赖 + Q12 逐点确认；S2 枚举随迁测试与 prisma 产物归属。Stage A 经修正后可安全先行。

### Stage B 范围修订后的二次独立复审（2026-09-30）

- Status: **PASS-WITH-REQUIRED-FIXES —— Stage B 在 B1/B2 未经用户重新裁决前不得开工**
- Reviewer / Agent: 独立子代理（General，fresh-eyes；逐条核对 live code）
- 底图抽查：31 项带行号断言中 26 项完全一致，无「自述与代码相反」；3 处事实偏差（1 处计数错 + 2 处行号口径不统一）、6 处实质漏项（4 条阻塞级）。
- Blockers：
  - **B1**：N2 的降级方向记错且与既有需求 `2026-09-09-download-create-dedup.md` 需求项 4/AC3 正面冲突（详见 Stage B 的 N2 条目）——须用户在正确前提下重新裁决。
  - **B2**：`claimNextCreatedTask`（`server-common/src/database/database.service.ts:623-632`）**跨进程不是原子 claim**——无 `FOR UPDATE SKIP LOCKED`、外层 WHERE 不复核 status，`:620-621` 的「避免并发双抢」注释只在单进程成立。拆分后若残留任何调用点（现唯一调用方 `download-scheduler.ts:128`），会与新 `download` handler 双认领同一 task、两进程同写同一 `outputFile`（`download.service.ts:580-582`）。须二选一：删除调用点并改「守卫式 `updateTaskStatus`（`WHERE id=$ AND status='created'`）+ 0 行则放弃」，或把该方法改成 SKIP LOCKED + 复核 status 且签名改为按 `payload.taskId`。
  - **B3**：`MAX_CONCURRENT_DOWNLOADS`（`download-scheduler.ts:32`，进程内 `runningSet` 实现）迁 worker_job 后**静默失效**；`WorkerService.drain`（`worker.service.ts:88-95`）是**全 kind 共享** `WORKER_MAX_CONCURRENT`（默认 2）单池、无 per-kind 配额 → 两个 `analyze` 在跑就没有下载能开工（可观察吞吐回归）。须裁决：(a) 接受统一池并把 `MAX_CONCURRENT_DOWNLOADS` 标废弃（部署 env/owner doc 同步），或 (b) 给 `WorkerService` 加 per-kind 上限（改 Phase 2 既有行为，须补 `worker-loop.test.ts` 用例并单独留证）。
  - **B4**：N3 范围不足——`executeTask`（`download.service.ts:483-496`）强依赖 `taskCache`，而写入点只有 cloud 侧 `createTask`（`:429`）与 nas 启动的 `restoreTaskCacheFromDatabase`（`:151-180`）→ cloud 运行期创建的任务**必然**走 `:495` 抛错。须把 N3 扩为「`executeTask` 去 `taskCache` 化」：状态门改读 DB、进度只写 DB（`:609` 已在写）、`restoreTaskCacheFromDatabase` 与 `TaskEntry` 一并退役（顺带解掉 `analysis-video-resolver.ts:297→323` 那条同步链的 cache 依赖）。
  - **B5**：stop/resume/delete 与作业状态对齐规则缺失，且 `executeTask` 状态门（`:499-502`）**今天就允许 `Stopped` 进入 `Downloading`**；`download-scheduler.ts:114-121` 的 delete 是底图漏列的第五个触发点（删 task 不取消 job → handler 查不到 task → 抛错 → 默认 5 次重试 5 条错误日志）。须定口径：stop/delete 一律调 `cancelWorkerJob`（`database.service.ts:1693-1701`）、状态门收紧为仅 `created`、resume 后重新入队；并把「运行中下载不可真正中止」（`abortControllers` 全仓无 `.set()`，`abortTask` 为 no-op）写进 owner doc 而非在拆分里顺手修。
  - **B6**：`insertTask`（`:414`）与 `enqueueJob` 不同事务 → 入队失败/job 被人工 cancel 后 task 永久停 `created`（N1 要消灭的失败模式换了触发条件）；且 `download-scheduler.ts:35-47` 的启动恢复（`downloading → failed`）归属未定，与 `reconcileStaleAnalysisState` 同类——放 cloud 会在 cloud 重启时误标 nas 正在跑的下载。须定：「`created` 缺活跃 download job 则补入队」的幂等对账放 cloud 启动（靠 dedupKey 幂等）；「`downloading` 无活跃租约 → failed」放 nas，并写清谁改 task 行（`reapExpiredJobs` 只回收 job、不回写 task）。
  - **B7**：`POST /api/analysis/run`（`analysis.controller.ts:63-101`）在 controller 里直接 `new AnalysisEngine(...)` 并跑本地绝对路径（`:95-100,537`），`AnalysisEngine` 链带 `FfmpegScreenshot`/`QwenClient`（`analysis-engine.ts:19,21`）。需求 `:62`「云端不得依赖 ffmpeg/分析执行/vision-proxy」与 `:78`「所有对外 HTTP 由 cloud-server 提供」对该端点**互斥**。前端无调用方（`frontend/src/api/index.ts` 全文无 `/analysis/run`）→ 复审推荐删除该端点（属公开契约变更，需人工确认）。
- Should-fix（已知，实施时并入）：N6 的副本数应为 **9 处**（补 `analysis-trigger.service.ts:204`、`analysis-task.controller.ts:97`、`analysis.controller.ts:448`）。
- 待补：复审对底图第 4 节「待补」清单（`notification/`、`knowledge/` 三件、若干纯函数文件、`paths/`、`video/`、`parse/`、B站扫码 controller 的归属，以及受影响测试逐文件归属）的补齐内容输出被截断，实施前需取回并并入底图。


## Closure Gates

- [x] in-scope 非部署行为完成（Stage A–C + B-1…B-5）
- [x] relevant docs aligned（system-baseline / module-boundaries / app-overview / feature-inventory / codebase-map / project-context / backlog / log）
- [x] verification has run（全仓 typecheck/build 绿；Stage C 后 server-common 13/84 + cloud-server 14/85 + nas-worker 7/63 = 232）
- [x] no in-scope item downgraded（Stage D 为受控 gate，非静默降级）
- [x] plan audit passed before implementation（+ Stage B 二次复审）
- [x] 部署/公网暴露：auth 已完成；人工批准 2026-10-01 后 Stage D 已实施（三镜像 build 通过、compose config 通过）→ Phase 3 **全量闭合**；真实上线（compose up/公网/E2E）为运维动作，见 Closure 部署期待办
- [x] closure audit independent（PASS-WITH-FIXES，无 Blocker，should-fix 已并入）

## Deferred But Adjudicated

### Stage D 部署与公网暴露 ✅ 已解决（2026-10-01 经人工批准实施，commit `ada1513`；真实上线仍待运维）
- Classification: `protected-area gate`
- Why Not Blocking (A-C) Closure: 代码重构（A-C）不改部署、不公网暴露，可独立验证；部署为保护区，需人工批准且以 auth 完成为前置（**auth 已于 2026-09-30 闭合**，仅余人工批准）。
- Successor Required: `yes`（auth 需求 + 人工批准部署）

### Stage A 已使 `pnpm docker:build` 失效（计划未预见，须在 Stage D 修复） ✅ 已解决（Stage D 三镜像重写，docker:build 恢复通过）
- Classification: `protected-area gate`（部署文件变更需人工批准）
- What Broke: `packages/docker/Dockerfile.server` 仍按单体布局取件——`COPY packages/server/...`（无 server-common）、`COPY --from=builder /app/packages/server/src/prisma/ ./src/prisma/`（contract 已迁至 server-common）、运行镜像内 `prisma.config.ts` 的 contract 相对路径（现为 `../server-common/...`，flatten 后不存在）。容器 CMD 链 `prisma db init` 因此会失败。
- Why Not Fixed Now: 计划前置门规定「Stage A–C 纯代码重构、不改部署」，且部署文件变更须人工显式批准；本阶段不擅自改 Dockerfile/compose。
- Consequence Until Fixed: 本地开发/测试/typecheck/build 全部正常；**仅镜像构建与容器部署不可用**（自 Stage A 起到 Stage D 批准前）。
- Successor Required: `yes`（Stage D：三镜像重写时一并接线 server-common 与 contract 取件路径）

### embedding 常量/`normalizeEmbeddingText` 尚未下沉 adapters
- Classification: `code-hygiene followup`
- What: COS 已下沉 `adapters/src/cos`；embedding 的 `EmbeddingClient` 本就在 adapters，但 `DEFAULT_EMBEDDING_MODEL/DIMENSIONS/BASE_URL` 常量与 `normalizeEmbeddingText`（向量复用键，漂移会静默影响去重/计费）目前仍为 cloud/nas 两份逐字一致 wrapper。
- Why Not Blocking: 两份已加「须逐字一致」注释，当前行为正确；下沉是防漂移加固。
- Successor Required: `yes`（随 Stage C 或独立小切片下沉至 `adapters/src/embedding`）

### 本地 dev 脚本与 server 退役后的运行入口 ✅ 已解决（Stage D：dev:server 改并行 cloud+nas+frontend，cloud/nas 各加 start:dev）
- Classification: `deploy-stage item`
- What: 根 `package.json` 的 `dev:server` 仍引用已删除的 `@bilibili-downloader/server`；cloud-server/nas-worker 仅有 `start:prod`、无 `start:dev`。
- Why Not Blocking: 属本地联调/运行便利，非产品行为、非测试/构建门禁；运行入口接线与部署同属 Stage D。
- Successor Required: `yes`（Stage D：重排 dev/start 脚本为 cloud + nas 双进程）


## Closure

Status Note: **部分闭合（代码完成）**。Stage A（server-common 抽离）、Stage B（B-1 清理+删 /analysis/run、B-2 作业契约下沉+纯 DB 去重、B-3 WorkerService per-kind 并发、B-4 接通 download kind、B-5 COS 下沉 adapters + 建骨架 + 拆三大类 + 双向搬迁 + 退役 server）、Stage E（文档）均完成。`packages/server` 已删，`cloud-server`/`nas-worker`/`server-common` 三应用成立；物理隔离 grep 断言通过（cloud 无 ffmpeg/引擎/PathsService 真实 import；nas 无 @Controller）；测试 218 守恒。**Stage C（云端多模态改 openai SDK）与 Stage D（部署三镜像 + 公网暴露）延后**：Stage D 属部署保护区，须人工显式批准；在此之前 `pnpm docker:build` 失效（见 Deferred）。commit：`583fe0d`(A) … `c2d7937`(B-5 ③④⑤) + 文档。**Stage C 已于 2026-10-01 实现并闭合**：C-1 `545bb61`（openai SDK）、C-2 `acb420c`（NAS 内存缓存）、C-3 `77e66d8`（cookie app_settings 物化+版本刷新）。**Stage D 部署**已于 2026-10-01 经人工批准实施（commit `ada1513`）：三镜像 `pnpm docker:build` 构建通过、`docker compose config` 校验通过、容器内物理隔离实证——Phase 3 **全量闭合**（代码+部署产物）；真实 compose up/公网暴露/端到端五链路为运维上线动作。

Closure Audit Evidence:
- Reviewer / Agent: 独立子代理（General，fresh-eyes，非 cold-replay；Phase 3 邻接部署保护区）
- Evidence: 2026-10-01，Verdict=**PASS-WITH-FIXES，无 Blocker**。实跑 typecheck/build/三包测试全绿（218 守恒）；逐条核验物理隔离（cloud 仅注释提及隔离词、QwenClient 为已登记 Stage C 例外、ffmpeg/引擎/PathsService 真实 import 0 命中；nas `@Controller`/`listen` 0 命中）、作业契约闭环（download 入队/认领、claimAiSummaryTask 与 reconcileStaleAnalysisState 在 nas、handler 构造器注册先于轮询、cloud 未 provide WorkerService）、行为等价（截图兜底同步链可用、document-generator/COS/embedding 两侧仅头注释差异）、Stage D 门禁（docker 零改动、docker:build 失效如实标注、未伪装完成）。should-fix 已并入：system-baseline 的 `claimNextCreatedTask`→`claimCreatedTaskById`；owner doc 登记 Stage C 的 QwenClient→vision-proxy 例外；陈旧路径修正；embedding 常量未下沉 adapters 转后继门（见 Deferred）。
- Stage C 独立 closure audit（General，fresh-eyes）：2026-10-01，Verdict=**PASS-WITH-FIXES，无 Blocker**。实证 openai 端点/参数等价（Q12）、cookie 安全（全链路无明文日志、`POST /api/auth/cookie` 受 fail-closed AuthGuard、空值 400）、物理隔离未破坏、测试条数属实（84/85/63）；should-fix「NAS `COOKIE_FILE_PATH` 死代码」已并入清理。
- Stage D 独立 closure audit（General，fresh-eyes；部署保护区）：2026-10-01，Verdict=**PASS-WITH-FIXES，无 Blocker**。实证三镜像存在、容器内物理隔离（cloud 无 ffmpeg/python + contract 在位 + /app/public 有；nas 有 ffmpeg + 无前端/prisma.config）、`docker compose config` 三服务渲染 + DATABASE_URL fail-closed、最小权限角色接线、env 名逐一对照源码无误、无密钥入库、端口不公网暴露。should-fix 均为上线前运维待办（healthcheck `/` 行为、本地 .env 凭据处置、.env.example/docs 真实基础设施标识泛化、公网暴露前 TLS+admin 播种+cookie secure），不阻断镜像/compose 产物闭合。
