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

Status: planned
Targets: 新增 `packages/server-common`；从 `packages/server` 迁出 DB/Prisma、logging、worker_job 仓储、settings/cookie、共享类型/配置；`server` 改依赖 `server-common`
- Item Types: `Add | Fix`
- Prereqs: 无（不改部署/不公网暴露）
- [ ] `Add`：建 `@bilibili-downloader/server-common` 包（tsconfig/exports 比照 `adapters`）。迁入 `DatabaseService`/`PrismaService`/contract 访问、`server-log.util`、worker_job 仓储、settings/cookie 读写、共享 record 类型。
- [ ] `Fix`（B1 反向依赖）：`DatabaseService` 现 import `../analysis/prompt-template.js`（builtin 提示词播种，`database.service.ts:14-17,219-220`）——将 `prompt-template.ts` 的 builtin 常量迁入 server-common，`analysis` 改从 server-common 引用；消除 `server-common → analysis` 反向边。
- [ ] `Fix`（B2 路径耦合）：`DatabaseService` 现 import `PathsService` + `path-anchor`（`database.service.ts:19-21,175-176`，写规范化 `toRelativeDownloadRootPath(...,DOWNLOAD_ROOT)`）——将纯函数 `path-anchor.ts` 迁入 server-common，并把 `DOWNLOAD_ROOT` 作为**字符串配置**注入 `DatabaseService`（去掉对 `PathsService` 的 import）；`PathsService` 本体保持 nas-worker 专属。运行期不变（读侧返回原始相对值；云端 createTask 不传 outputFile → 规范化为 no-op）。
- [ ] `Fix`：`server` 内引用改指向 `server-common`；`prisma:emit` 产物归属与脚本路径对齐（产物随 contract 落 server-common，emit 脚本路径同步）。
- [ ] `Fix`（S2 测试/产物归属）：随迁移移动相关测试至 server-common——`tests/database/*`、`tests/prisma/prisma-service.test.ts`、`tests/worker/worker-loop.test.ts`、`tests/database/worker-job.test.ts`、`tests/database/settings.test.ts`、`tests/paths/path-anchor.test.ts`；`TEST_DATABASE_URL`/globalSetup 随包对齐。
- [ ] `Proof`：`pnpm typecheck`、`pnpm build`、`pnpm --filter @bilibili-downloader/server test` 全绿（行为不变）。
Exit Criteria:
- [ ] server-common 独立可编译；server 经其访问 DB/日志/作业仓储；全量测试绿（零行为变更）。
- [ ] `docs/logs/` 记录。

### Stage B - 新建 cloud-server 与 nas-worker 骨架 + 模块搬迁

Status: planned
Targets: 新增 `packages/cloud-server`、`packages/nas-worker`；按模块表迁移 provider/controller
- Item Types: `Add | Fix`
- Prereqs: Stage A
- [ ] `Add`：两个 NestJS 应用骨架，均依赖 server-common。
- [ ] `Fix`：云端模块（parse/download 创建读取/analysis 触发查询/chat-RAG/knowledge/prompt/settings/作业生产）迁入 cloud-server；执行类（下载执行/分析引擎/截图/screenshot_retry/完整性检查/WorkerService 消费/PathsService+锚点）迁入 nas-worker。物理隔离校验：cloud-server 无 ffmpeg/分析执行/vision-proxy import。
- [ ] `Fix`（B3 分析触发/执行拆分）：`AnalysisTriggerService` 现同时承担云端触发（写 worker_job）与 NAS 执行（`WorkerService.registerHandler` analyze/low_res_download/screenshot_retry/integrity_check + `new AnalysisEngine` 运行，见 `analysis-trigger.service.ts:8,68,72,74,104-111,536`）。须沿**作业 kind + payload 契约（Phase 2）**拆为：cloud 侧 job-producer（enqueue + 触发校验 + 查询），nas 侧 handler/executor（注册 handler + 跑引擎 + 截图/完整性）。拆分后再断言两应用独立可编译。
- [ ] `Fix`（B4 下载创建/执行拆分 + Auth 解耦）：`DownloadService` 现同时含 `createTask`（云）与 `executeTask`/`executeLowResDownload`（NAS，import `FfmpegMerger`/`HttpDownloader`，`download.service.ts:9-10,283,481`）；`DownloadModule` 还挂 `DownloadController`(读/创建→云) 与 `AuthController`(→云)（`download.module.ts:6,9`），且被 `AnalysisModule` 整体 import。须拆：创建/读取仓储面→cloud，执行 + ffmpeg/下载器→nas；`AuthController` 移出 DownloadModule 归 cloud。物理隔离退出校验在此拆分后才有效。
- [ ] `Proof`：两应用各自 `typecheck`/`build`；迁移的服务测试随包移动并绿。
Exit Criteria:
- [ ] 两应用可独立编译；模块归属符合需求表；cloud-server 物理不含执行/ffmpeg/vision-proxy。
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
- Why Not Blocking (A-C) Closure: 代码重构（A-C）不改部署、不公网暴露，可独立验证；部署为保护区，需人工批准且以 auth 完成为前置。
- Successor Required: `yes`（auth 需求 + 人工批准部署）

## Closure

Status Note: 待实施后回填。

Closure Audit Evidence:
- Reviewer / Agent: 待回填
- Evidence: 待回填
