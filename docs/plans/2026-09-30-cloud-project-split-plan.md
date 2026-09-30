# 2026-09-30 Phase 3 — 拆分 cloud-server / nas-worker（server-common 前置 + 项目拆分 + 部署[gated]）

> Plan Status: planned
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


### Stage B - 新建 cloud-server 与 nas-worker 骨架 + 模块搬迁

Status: planned（**拆分底图已产出，须先按下列新发现修订本阶段范围并过一次独立复审，再动手**）
Targets: 新增 `packages/cloud-server`、`packages/nas-worker`；按模块表迁移 provider/controller
- Item Types: `Add | Fix`
- Prereqs: Stage A
- [ ] `Note`（底图）：逐成员归属、构造器依赖、跨侧断点、风险点见 `docs/analysis/2026-09-30-phase3-stage-b-split-map.md`（独立子代理逐行读 live code 产出）。
- [ ] `Fix`（**新发现 N1，阻塞级：`download` kind 缺失**）：`download-scheduler.ts:96` 的 `createDownload → tryScheduleNext` 是同进程直调，且 nas 现只注册 4 个 kind（无 `download`）。拆分后 cloud 创建的任务会**停在 `created` 永不执行**。**裁决（用户 2026-09-30）：新增 `kind:"download"` 走作业契约**（`{taskId}`、`queue:"nas"`、`refType:"task"`、`refId:taskId`、`dedupKey: download:${bvid}:${cid}`），cloud 创建即入队、nas 注册 handler 消费；不采用 nas 侧定时 `claimNextCreatedTask` 轮询（避免下载与其他作业两套机制并存）。本项即需求 `docs/requirements/2026-09-17-cloud-project-split.md:51` 预留的「下载迁移到 worker_job，若 Phase 2 未完成则在本阶段补」。
- [ ] `Fix`（**新发现 N2，行为降级，前次裁决基于错误前提，须重新裁决**）：`evaluateCreateDedup`（`download.service.ts:453-478`）判定链为 `findActiveTaskByBvidAndCid` → `findCompletedTaskByBvidAndCid` → `fileExists`，其中 `fileExists` 跨侧不可得。
  - **更正（独立复审 2026-09-30 指出）**：我先前描述的代价方向是错的。「盘上已有文件但 DB 无记录」**今天就已经会重新下载**（`:461` 查不到 completed 记录 → `create-dedup.ts:31` 条件不成立 → 放行），纯 DB 化对它零影响。真正被改变的是相反分支：`create-dedup.ts:31` 的 `completedOutputFile && fileExists`，在「DB 有 success 记录 + 盘上文件已被删」时今天**放行重下**，纯 DB 化后变成**拦截**（两个入口都 409：`download.controller.ts:46-48`、`analysis.controller.ts:384-386`）。
  - **冲突**：该行为正是既有需求 `docs/requirements/2026-09-09-download-create-dedup.md:18`（需求项 4）与 `:24`（AC3）明文规定的「文件被手动删除后不拦截，正常创建新任务」。纯 DB 化＝AC3 回归，用户可见后果是「手动删了文件就无法从 UI 重下该分 P，只能先删 DB 任务记录」。分析链路不受影响（`analysis-video-resolver.ts:297` 走 `skipDedup:true`）。
  - **待定**：若接受，须改写 `2026-09-09-download-create-dedup.md` 的需求项 4/AC3 并留人工批准痕迹（不能只在本计划记一句）；若不接受，须回到「nas 物化文件存在性到 DB」方案，Stage B 范围相应扩大。


- [ ] `Fix`（新发现 N3）：`taskCache`（`download.service.ts:88`）为进程内共享状态，cloud/nas 各持一份后 `stopTask`/`resumeTask` 的 cache 守卫失效 → 改 `db.getTaskById` + 守卫式 `updateTaskStatus`。
- [ ] `Fix`（新发现 N4）：cloud 侧 cookie 来源当前是 `PathsService.COOKIE_FILE_PATH`，而 Stage A 已判 `PathsService` 为 nas 专属 → Stage B 需先定临时口径（Stage C 的 cookie 物化项部分前移）。
- [ ] `Fix`（新发现 N5）：cloud **不得 provide `WorkerService`**（队列默认 `nas`、`enabled` 默认 true、`@Global`），否则会抢 nas 作业并因无 handler 全判失败；cloud 只保留 `worker.controller.ts`。同时须保证 nas 侧 `registerHandler` 先于 `WorkerService` 轮询启动。
- [ ] `Fix`（新发现 N6）：dedupKey 生成方现有 8 处手写副本，拆后跨包易静默漂移 → 随作业契约下沉到 `server-common`（`job-kinds.ts`）。
- [ ] `Add`：两个 NestJS 应用骨架，均依赖 server-common。
- [ ] `Fix`：云端模块（parse/download 创建读取/analysis 触发查询/chat-RAG/knowledge/prompt/settings/作业生产）迁入 cloud-server；执行类（下载执行/分析引擎/截图/screenshot_retry/完整性检查/WorkerService 消费/PathsService+锚点）迁入 nas-worker。物理隔离校验：cloud-server 无 ffmpeg/分析执行/vision-proxy import。
- [ ] `Fix`（B3 分析触发/执行拆分）：`AnalysisTriggerService`（实际 903 行）按底图拆为 cloud 的 `analysis-job-producer.service.ts` + `ai-summary-query.service.ts` 与 nas 的 `analysis-job-handlers.service.ts` + `analysis-executor.service.ts`；**`claimAiSummaryTask` 必须与执行同侧同窗口**，启动对账 `reconcileStaleAnalysisState` 必须留 nas。
- [ ] `Fix`（B4 下载创建/执行拆分 + Auth 解耦）：`DownloadService`（实际 947 行）按底图拆分；`DownloadScheduler` 是**第三个**拆分对象；`AuthController` 移出 DownloadModule 归 cloud。顺带删除三处死代码（`getTasks`、no-op 的 `abortControllers`、`analysis.controller.ts` 对 `AnalysisTriggerService` 的死注入）。
- [ ] `Proof`：两应用各自 `typecheck`/`build`；迁移的服务测试随包移动并绿。
Exit Criteria:
- [ ] 两应用可独立编译；模块归属符合需求表；cloud-server 物理不含执行/ffmpeg/vision-proxy。
- [ ] N1-N6 逐条落地或显式裁决留证。
- [ ] `docs/logs/` 记录。


### Stage C - LLM 客户端 / 缓存 / Cookie 落位

Status: planned
Targets: cloud-server 多模态改 `openai` SDK；缓存策略；cookie 物化/刷新
- Item Types: `Fix | Add`
- Prereqs: Stage B
- [ ] `Fix`：云端多模态改 `openai` SDK 连 `QWEN_VISION_PROXY_URL`——云端调用点：`chat/chat.service.ts` `createQwenClient()`(:280)、读 URL(:289)、三处 `enable_thinking:false`/`response_format:{type:'json_object'}`(:167-168,202-203,246-247)，以及 `analysis/analysis.controller.ts:499` `getLlmConfig`。**逐点确认** Q12（`enable_thinking` DashScope 专有 / `response_format`）在 `openai` SDK 下的等价与语义；新增 `openai` 为 cloud-server 依赖。NAS 保留 `QwenClient`/vision-proxy（`analysis-engine.ts:21,116,121,179-180`）不变。
- [ ] `Fix`：云端 `FileCacheStore`、NAS 内存缓存；cookie `app_settings` 物化 + 版本刷新（含 ParseService 客户端刷新）+ 云端手动粘贴 cookie 入口。
- [ ] `Proof`：`typecheck`/`build`；问答图片路径与分析路径行为核对。
Exit Criteria:
- [ ] 云端 SDK 连接配置化 URL；缓存/cookie 策略按需求；行为与 Phase 2 一致。
- [ ] `docs/logs/` 记录。

### Stage D - 部署（保护区，人工批准 + auth 前置，默认 blocked）

Status: blocked（部署保护区 reviewer=none；且公网暴露前置 auth 未完成）
Targets: 三 Dockerfile、compose、worker 最小权限 DB 角色
- Item Types: `Fix | Proof`
- Prereqs: Stage A-C + **auth 完成** + **用户显式批准部署动作**
- [ ] `Fix`：cloud-server 镜像（无 ffmpeg/Python/vision-proxy）、nas-worker 镜像（含 ffmpeg + compose 内 vision-proxy）、vision-proxy 独立镜像；worker 独立最小权限 DB 角色。
- [ ] `Proof`：`pnpm docker:build`、`docker compose config`。
Exit Criteria:
- [ ] 三镜像构建通过；compose 校验通过；部署变更经人工批准。

### Stage E - 文档与闭合

Status: planned
Targets: `docs/architecture/system-baseline.md`、`module-boundaries.md`、`docs/design/app-overview.md`、`docs/backlog/README.md`、`docs/logs/`
- Item Types: `Fix | Proof`
- Prereqs: Stage A-C（D 视 auth/批准）
- [ ] `Fix`：owner docs——三包结构与依赖方向、模块归属、物理隔离、LLM/缓存/cookie、部署形态。
- [ ] `Proof`：独立 closure audit（reviewer=none → 独立子代理或 cold-replay，留证）。
Exit Criteria:
- [ ] owner docs / backlog / log 一致；closure gates 全绿（Stage D 若未完成则明确标注部分闭合 + 后继门）。

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

- [ ] in-scope 非部署行为完成（Stage A-C）
- [ ] relevant docs aligned
- [ ] verification has run（各包 typecheck/build/test；Stage D 的 docker:build/compose 视批准）
- [ ] `docs/testing/` 文档存在且每条方向确认或裁决
- [ ] no in-scope item downgraded（Stage D 为受控 gate，非静默降级）
- [ ] plan audit passed before implementation
- [ ] 部署/公网暴露：auth 前置完成 + 人工批准（否则 Stage D 保持 blocked，Phase 3 部分闭合）
- [ ] closure audit independent

## Deferred But Adjudicated

### Stage D 部署与公网暴露
- Classification: `protected-area gate`
- Why Not Blocking (A-C) Closure: 代码重构（A-C）不改部署、不公网暴露，可独立验证；部署为保护区，需人工批准且以 auth 完成为前置（**auth 已于 2026-09-30 闭合**，仅余人工批准）。
- Successor Required: `yes`（auth 需求 + 人工批准部署）

### Stage A 已使 `pnpm docker:build` 失效（计划未预见，须在 Stage D 修复）
- Classification: `protected-area gate`（部署文件变更需人工批准）
- What Broke: `packages/docker/Dockerfile.server` 仍按单体布局取件——`COPY packages/server/...`（无 server-common）、`COPY --from=builder /app/packages/server/src/prisma/ ./src/prisma/`（contract 已迁至 server-common）、运行镜像内 `prisma.config.ts` 的 contract 相对路径（现为 `../server-common/...`，flatten 后不存在）。容器 CMD 链 `prisma db init` 因此会失败。
- Why Not Fixed Now: 计划前置门规定「Stage A–C 纯代码重构、不改部署」，且部署文件变更须人工显式批准；本阶段不擅自改 Dockerfile/compose。
- Consequence Until Fixed: 本地开发/测试/typecheck/build 全部正常；**仅镜像构建与容器部署不可用**（自 Stage A 起到 Stage D 批准前）。
- Successor Required: `yes`（Stage D：三镜像重写时一并接线 server-common 与 contract 取件路径）


## Closure

Status Note: 待实施后回填。

Closure Audit Evidence:
- Reviewer / Agent: 待回填
- Evidence: 待回填
