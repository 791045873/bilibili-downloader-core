# 2026-09-30 Phase 3 Stage B 拆分映射（cloud-server / nas-worker）

> 用途：Stage B 实施底图。由独立子代理逐行读 live code 得出，避免跨会话重做该分析。
> 关联：`docs/plans/2026-09-30-cloud-project-split-plan.md`（Stage B）、`docs/requirements/2026-09-17-cloud-project-split.md`（模块表）
> 口径：cloud = 校验 + 写 DB + 入队 + 读查询/删除 + HTTP 面；nas = 注册 handler + 跑引擎/ffmpeg/截图 + 触盘 + `PathsService` + 出站模型调用。

## 1. `analysis/analysis-trigger.service.ts`（实际 903 行）

### 归 cloud
- `AiSummaryExecutionTiming` / `AiSummaryTaskView` / `PaginatedAiSummaryTaskView`（31-50）与 `parseExecutionTiming`（847-868）→ 视图类型单独成文件
- `getAiSummaryTasksPaginated`（802-827）、`getAiSummaryTaskById`（829-841）、`deleteAiSummaryTask`（843-845）

### 归 nas
- `onModuleInit` 的启动对账 `reconcileStaleAnalysisState`（81-89）—— **必须在 nas**：它把 `created` 子任务与 `pending/analyzing` 总结标 failed，只有 nas 在推进这些状态；放 cloud 会在 cloud 重启时误杀 nas 正在跑的分析
- `downloadScheduler.onAnalysisTrigger` 钩子（91-102）、`worker.registerHandler` ×4（104-113）
- 四个 handler：`handleIntegrityCheckJob`(139-142)、`handleScreenshotRetryJob`(144-150)、`handleAnalyzeJob`(152-166)、`handleLowResDownloadJob`(168-244)
- `trigger`（246-364）—— **不可提前到 cloud**：它含 `claimAiSummaryTask`(321-327)，claim 必须紧贴执行
- `runAnalysis`(426-662)、`resolveTaskForAnalysis`(664-723，688 触盘)、`resolveSummaryDir`(725-776)、`getLlmConfig`(778-800)、`parseVisionProxyTimeoutMs`(52-56)、`upsertAiSummaryTask`(870-901)、`llmVideoDir`(61,76)

### 两侧都要
- `enqueueAnalyzeForTask`(117-137)：**下沉 `server-common`**（`worker/analysis-job-producer.ts` + `job-kinds.ts`），顺带消除 5 处手写 dedupKey 副本
- `resolvePromptId`(371-401)：下沉为纯函数 + deps 注入（提示词优先级链只留一份）
- `resolveCreatorMid`(403-424)：两侧各自薄实现（cloud 走 parse 面的 SDK client，nas 走 download-nas 的 `getVideoInfo`），共享 `(bvid) => Promise<number|undefined>` 签名
- `getLlmConfig` / `parseVisionProxyTimeoutMs`：各自复制（Stage C 后 cloud 换 openai SDK，强行共享会挡住 C；cloud 侧 `analysis.controller.ts:495-524` 本来就已有一份副本）

### 依赖拆分
- cloud 注入：`DatabaseService`、`PromptService`、一个 B站视频信息解析器（原为 `DownloadService.getVideoInfo`，改指 parse 面）
- nas 注入：`DatabaseService`、`WorkerService`、`PathsService`、`AnalysisVideoResolver`、`DownloadService` 的 nas 半、`KnowledgePublisherService`、`NotificationService`、`SummaryIntegrityService`、`ScreenshotRetryService`、（可选）`DownloadScheduler`
- nas **不要**复制 `PromptService`：`getAiPromptById`/`getDefaultAiPromptId`/`getCreatorBindingByMid` 已在 `server-common`，直接用 db

### 建议落位
```
cloud-server/src/analysis/analysis-job-producer.service.ts   # 入队 + resolvePromptId 适配 + resolveCreatorMid(cloud)
cloud-server/src/analysis/ai-summary-query.service.ts        # 802-845
cloud-server/src/analysis/ai-summary-task.view.ts            # 31-50 + parseExecutionTiming
nas-worker/src/analysis/analysis-job-handlers.service.ts     # 81-113 + 139-244
nas-worker/src/analysis/analysis-executor.service.ts         # 246-364 + 426-662 + 664-723 + 870-901
nas-worker/src/analysis/summary-dir-resolver.ts              # 725-776（入参 (base, task)，便于单测）
nas-worker/src/analysis/llm-config.ts                        # 778-800 + 52-56
server-common/src/worker/{analysis-job-producer.ts,job-kinds.ts}
```

### 调用方影响面
- `analysis-task.controller.ts`：35（ctor）、122、273/300、284 → 全部指向 cloud 查询服务
- `analysis.controller.ts`：18/56 注入了 `AnalysisTriggerService` 但**全文无调用点** → 死注入，拆分时删除
- `analysis.module.ts`：5/26/35；`analysis/index.ts`：4 → 按新命名分别导出
- `download-scheduler.ts`：26/62（`onAnalysisTrigger` 钩子契约）→ nas 半

### 风险点
1. 启动对账（81-89）落错边 → cloud 重启误杀在跑分析
2. **handler 注册时机**：`WorkerService.onModuleInit` 直接 `setInterval(drain)`（`server-common/src/worker/worker.service.ts:61-79`）。拆包后若 handler provider 的 `onModuleInit` 晚于 `WorkerService`，抢到的作业命中「无 handler」分支（`:132-141`）→ `failJob` + 30s backoff + 白耗一次 `attempts`。必须显式保证注册先于轮询（`registerHandler` 移到构造器，或让 `WorkerModule` 依赖 handler 模块）
3. **cloud 不得 provide `WorkerService`**：队列默认 `"nas"`（`:42`）、`enabled` 默认 true（`:51`），且 `worker.module.ts:5-9` 是 `@Global`。cloud 照搬会抢 nas 作业并因无 handler 全判失败。cloud 只保留 `worker.controller.ts`（只读 DB）
4. **dedupKey 手写副本拆后跨包**：`analyze:${bvid}:${cid}` 4 处（`analysis-trigger.service.ts:134`、`analysis.controller.ts:196`、`analysis-task.controller.ts:84,339`）、`lowres:${bvid}:${cid}` 2 处（`analysis.controller.ts:448`、`analysis-video-resolver.ts:147`）、`analyze:cont:` 1 处（199-206，留 nas）、`screenshot_retry:${id}`（`analysis-task.controller.ts:378`）、`integrity_check`（`:97`）。**格式漂移会静默失去去重，不报错只双跑**
5. `payload.continuation` 与常规 analyze 是两个不同 dedupKey，活跃唯一索引拦不住彼此 → 低清完成入队 cont 同时用户手点重触发可并发双跑（既有隐患，拆后触发入口增至 3 个 controller，概率放大）
6. 临时视频清理的前缀守卫（634 `startsWith(this.llmVideoDir)`）：executor 若丢 `PathsService` 或锚点变了，条件恒假 → `rm`(635) 永不执行，`.analysis-llm` 无声膨胀且无日志
7. **错误语义**：`runAnalysis` 的 catch(608-632) 自吞异常写 failed、**不重抛** → handler 视作成功、`completeJob` 落终态永不重试；`handleLowResDownloadJob` catch(207-243) 同样。拆分时若「顺手」改成重抛，行为从「一次失败即终态 + 1 封邮件」变成「最多 5 次重试 + 5 封邮件」
8. claim→执行顺序耦合（321-327 → 363，中间夹子任务查询 346-348 与提前 `return` 360）：claim 提前到 cloud 会留下永久 `pending`
9. `upsertAiSummaryTask` 单写者约束（870-901，写 `title`/`sourceTaskId`）：cloud 若为「让前端立刻看到 pending」也 upsert，会与 nas 竞争 `updated_at` 与完整性字段重置语义（见 `tests/database/ai-summary-task.test.ts:384`）
10. `getLlmConfig` 两份副本错误类型不同（nas `Error`(791) vs cloud `BadRequestException`(505/508)）；误合并会把 400 语义带进作业失败信息

## 2. `download/download.service.ts`（实际 947 行）

### 归 cloud
`getDownloadConfig`(104-108)、`parseAllVideos`(237-246)、`createTask`(387-450)、`evaluateCreateDedup`(453-478)、`stopTask`(691-706)、`resumeTask`(709-724)、`getTasksPaginated`(750-756)、`deleteTask`(764-773)、`clearTasks`(776-786)、B站扫码四件套 `getQrCode`/`pollQrStatus`/`confirmLogin`/`getUserInfo`(790-812)、`proxyBilibiliImage`(820-837) + `normalizeBilibiliImageUrl`/`isAllowedBilibiliImageHost`(839-864，**含 SSRF 白名单，勿与代理拆散**)

### 归 nas
`LowResDownloadResult`(35-38)、`outputDir`(73,100)、`executionDeps`(83)、`fileStore`(84)、`merger`(85)、`abortControllers`(91)、`onTaskFinished`(94)、`restoreTaskCacheFromDatabase`(151-180)、`resolveBestVideoStream`(249-280)、`executeLowResDownload`(283-380)、`executeTask`(481-688)、`fileExists`(737-739)、`formatBytes`(905-910)、`sanitizeOutputPath`(917-924)、`toSubtitleLanguages`(930-946)

### 两侧都要
类型 `CreateTaskResult`/`TaskEntry`/`ParseResultItem`（40-66）、`cookieFile`(74,101)、B站客户端四件套 `biliClient`/`authProvider`/`resourceParser`/`streamProvider`(76-79)、`resolutionService`(82)、`getVideoInfo`(185-189)、`parseVideo`(192-234)、`loadCookieString`(868-875)、纯函数 `extractCodecName`/`qualityLabel`(880-903)、`getTaskById`(759-761，纯透传 → 两侧直接调 `db.getTaskById`)

### 死代码（拆分时删除）
- `getTasks`(742-748)：全仓无调用（controller 走 `getTasksPaginated`）
- `abortControllers`(91)：全仓**无任何 `.set()`**，只有 `delete`(685) 与 `get(...)?.abort()`(733) → `abortTask` 现为 no-op
- `analysis.controller.ts:18,56` 对 `AnalysisTriggerService` 的注入：全文无调用点

### 危险共享状态
`taskCache`(88)：cloud 写(429)/删(765/778)，nas 读写(483/529/636-641)。**拆包后进程内 Map 不再共享** → `stopTask`(692)/`resumeTask`(710) 的 cache 守卫必须改为 `db.getTaskById` + 守卫式 `updateTaskStatus`

### 依赖拆分
- cloud 半（建议 `DownloadTaskService` + `BilibiliCatalogService`）：`DatabaseService` + cookie 来源。**注意：cookie 当前来自 `PathsService.COOKIE_FILE_PATH`(101)，而 Stage A 已判 `PathsService` 为 nas 专属** → cloud 必须换 `app_settings` 物化 cookie 或独立 env（属 Stage C 的 cookie 项，Stage B 需先定临时口径）
- nas 半（`DownloadExecutorService`）：`DatabaseService` + `PathsService`
- `DownloadScheduler` 是**第三个**拆分对象：`createDownload/stop/resume/delete` → cloud，`tryScheduleNext/executeTask` → nas

### 跨侧断点（含 Stage B 未预见的缺口）
1. **`download` kind 缺失（阻塞级）**：`download-scheduler.ts:96` 的 `createDownload → tryScheduleNext` 是同进程直调；`tryScheduleNext`(125-158) 仅由启动(66)/创建(96)/恢复(109)/完成(61) 事件驱动，而 nas 现在**只注册 4 个 kind**（无 `download`）。拆分后 cloud 创建的任务会**停在 `created` 永不执行**。**已裁决（用户 2026-09-30）：新增 `kind:"download"`**（`{taskId}`、`refType:"task"`、`dedupKey: download:${bvid}:${cid}`），不走 nas 定时 `claimNextCreatedTask` 轮询。
2. `abortTask`(727-734) 控制面在 cloud、AbortController 在 nas → 用 `worker_job.cancel_requested`（列已存在，`claimNextJob` 的 WHERE 已含 `cancel_requested = 0`，`database.service.ts:1610`）或新增 `download_cancel` kind
3. **`evaluateCreateDedup:453-478` 的 `fileExists` 磁盘判定无法跨侧**。**更正（独立复审 2026-09-30）**：先前记录的代价方向错误。「盘上有文件但 DB 无记录」今天就已放行重下（`:461` 无 completed 记录 → `create-dedup.ts:31` 不成立），纯 DB 化零影响；真正改变的是相反分支——「DB 有 success 记录 + 盘上文件已删」今天放行重下，纯 DB 化后变**拦截**（`download.controller.ts:46-48` 与 `analysis.controller.ts:384-386` 均 409）。该行为是既有需求 `2026-09-09-download-create-dedup.md:18,24`（需求项 4 / AC3）明文规定的，纯 DB 化＝AC3 回归。**待用户在正确前提下重新裁决。**


4. `analysis-video-resolver.ts:297+323` 的 `createTask(skipDedup:true) → executeTask` 均在 nas，但不能引用 cloud 的 `createTask` → nas 半需 `createAdHocTask`（仅 `insertTask`，无去重、无 cache）
5. `confirmLogin`(800) 写 cookie 文件在 cloud、nas 要读 → `app_settings` 物化 + 版本刷新（Stage C）

## 3. 跨侧调用断点（作业契约，Phase 2 已有）


`enqueueJob` 签名（`server-common/src/database/database.service.ts:1556-1566`）：`{ kind, queue?（默认 "nas"）, refType?, refId?, dedupKey?, priority?, maxAttempts?, availableInSeconds?, payload? }`；去重靠活跃状态唯一索引。

- `analyze`：`{taskId, promptId}`，`refType:"task"`, `dedupKey: analyze:${bvid}:${cid}`
- `analyze`（续跑）：`{taskId, continuation:true}`，`dedupKey: analyze:cont:${bvid}:${cid}`
- `low_res_download`：`{taskId, analysisSubTaskId, bvid, cid, title?, resourceType?}`
- `screenshot_retry`：`{summaryTaskId}`，`dedupKey: screenshot_retry:${id}`
- `integrity_check`：无 payload，`dedupKey: integrity_check`
- `fileExists`（495/688）**nas 独占**：cloud 永远拿不到这个事实，不要试图跨侧查询
- `publishInline`（555-563）留 nas 同进程（要读本地截图文件）
- 邮件通知（230/585/602/627）：nas 直接出站 SMTP（推荐，nas 本就仅出站），不引入 `notify` kind

## 4. 其余文件归属（二次独立复审 2026-09-30 补齐，逐条带调用方证据）

### 归 nas
- `notification/`（service + module + index）：唯一注入方 `analysis-trigger.service.ts:67`，调用点 `:230/585/602/627`；`notification.service.ts:2` nodemailer 直连 SMTP，符合「NAS 仅出站」。`notification.module.ts:4` 是 `@Global`，cloud 不 import 即可
- `knowledge/knowledge-publisher.service.ts`：唯一注入方 `analysis-trigger.service.ts:70`，调用点 `:555`；`:65` `cosStore.upload` 读**本地截图文件**（`:61`），必须与引擎同进程
- `analysis/analysis-engine.ts`：构造点 `analysis-trigger.service.ts:536`（另一处 `analysis.controller.ts:95` 随 B7 删除）；`:19` FfmpegScreenshot、`:21` QwenClient 直接命中物理隔离条款
- `analysis/screenshot-retry.service.ts`：`analysis-trigger.service.ts:74` + handler `:144-150`；`:4` FfmpegScreenshot、`:120` `ANALYSIS_LLM_VIDEO_DIR`、`:130` 截图、`:143` 上传本地文件
- `analysis/summary-integrity.service.ts`：`analysis-trigger.service.ts:73` + handler `:139-142`；内容判据读云 DB（`:124`）但 `:59-66 fileExists` / `:87 DOWNLOAD_ROOT` / `:147-158 isVideoMissing` 需触盘。`analysis-task.controller.ts:38` 的注入是**死的**，删后 cloud 不再需要它
- `analysis/analysis-video-resolver.ts`：`:75/82` fileExists、`:127` parseVideo、`:209/280` resolveBestVideoStream、`:297/323` `createTask(skipDedup)+executeTask`、`:240/346` DOWNLOAD_ROOT；消费方 `analysis-trigger.service.ts:463/539`、`screenshot-retry.service.ts:186`。顺带删 `:56` 对 `DownloadScheduler` 的死注入
- `analysis/timestamp.ts`（纯函数）：两个消费方都在 nas（`analysis-engine.ts:27`、`knowledge-publisher.service.ts:20-22`→`:81-83`）
- `download/file-naming.ts`：`buildOutputFileName` 仅 `download.service.ts:30`→`:332/572`（执行侧）；`sanitizeFileName` 仅 `analysis-trigger.service.ts:19`→`resolveSummaryDir:735`、`analysis-engine.ts:29`。**cloud 的 `createTask`(387-450) 不生成文件名**（`executeTask:572` 才生成）→ cloud 不需要
- `paths/`：nas 专属成立，但有两处 cloud 残留必须先解（见下「cloud 侧 PathsService 残留」）

### 两侧都要 → 各自复制
- `analysis/document-generator.ts`（60 行，无 IO/env/Nest）：nas 经 `analysis-engine.ts:25`，cloud 经 `summary-render.ts:11`（`generateMarkdown` 于 `:33`）。复制成本低于扩 server-common 职责。**两份文件头必须互相标注「渲染输出须逐字节一致」**——`summary-render.ts:31-34` 的 `documentToBody` 正是靠「复用同一生成器 + 剥 frontmatter 得到与 nas 产出逐字节一致的正文」成立的，漂移会让云端读取侧渲染与 nas 产出不一致

### 归 cloud
- `knowledge/knowledge-search.controller.ts`：`:20-21` 只注入 `EmbeddingService` + `DatabaseService`，纯向量检索、不触盘。注册点现在 `analysis.module.ts:22` → 须移到 cloud 独立 knowledge 模块
- `analysis/summary-dir.ts`（纯函数）：src 内消费者均在 cloud（`summary-render.ts:12` 等）
- （其余 cloud 侧清单与测试归属见「5. 待取回」）

### cloud 侧 `PathsService` 残留（N4 口径须扩大，不只 cookie）
| 位置 | 用途 | 处置 |
|---|---|---|
| `download.service.ts:101`、`parse.service.ts:47` | `COOKIE_FILE_PATH` | N4 已覆盖（改 `app_settings` 物化或独立 env） |
| `download.service.ts:115`、`parse.service.ts:55` | `BILI_API_CACHE_DIR`（`paths.service.ts:37-39` = `join(DOWNLOAD_ROOT,"bili-api-cache")`） | **未覆盖**：需求 `:37` 要 cloud 用 `FileCacheStore`、`:64` 又禁 cloud join 媒体路径 → cloud 需独立 cache dir 配置 |
| `main.ts:24-25` `mkdirSync(SUMMARY_BASE_DIR)`、`:32` 日志打 `DOWNLOAD_ROOT` | 启动建 summary 目录 | **未覆盖**：cloud bootstrap 必须删掉这段 |

### 模块图纠缠（计划只提了四分之一）
- `download.module.ts:9` `controllers: [DownloadController, VideoController, AuthController]` → `VideoController` 也要一起移
- `analysis.module.ts:22` 把 cloud 的 `KnowledgeSearchController` 注册在 AnalysisModule 里
- `chat.module.ts:2` `imports: [AnalysisModule]`（只为拿 `EmbeddingService`/`CosStoreService`，见 `analysis.module.ts:35-40` 的 exports）→ cloud 需独立 knowledge 模块，否则 ChatModule 会把整个 AnalysisModule（含 nas 侧 provider）拖进 cloud

### 死代码清单（实际 5 处 + 1 死类型）
1. `download.service.ts:742-748` `getTasks`（全仓无调用）
2. `abortControllers`（全仓无 `.set()` → `abortTask` 为 no-op）
3. `analysis.controller.ts:18,56` 对 `AnalysisTriggerService` 的死注入
4. `analysis-video-resolver.ts:56` 对 `DownloadScheduler` 的死注入
5. `analysis-task.controller.ts:38` 对 `SummaryIntegrityService` 的死注入
6. `download.dto.ts:23-32` `SingleDownloadDto`（全仓零引用）

### B7（删 `POST /api/analysis/run`）的连带死代码
删 `analysis.controller.ts:63-101` 后同文件以下全部无引用：`:55` AnalysisVideoResolver 注入、`:60` PromptService 注入、`:13/16/14` 三个 import、`:27-43` `AnalysisRequest`、`:536-594` `validateRequest`，以及 `prompt.service.ts:111-129` `resolveForRun`（全仓唯一调用方是 `:67`）。
保留项：`:526` `parseOptionalPromptId`（`triggerAiSummary:110` 仍用）、`:47-48` `DASHSCOPE_NATIVE_API_URL`（`testLlmConfig:283` 仍用）。
**需 Stage B/C 协调**：`:495-517` `getLlmConfig` 在 `runAnalyze` 删除后也变无引用，而 Stage C 明确要改它 → 须择一并写进计划（Stage B 一并删且 Stage C 不再提它；或 Stage B 保留并标注「待 Stage C 复用」），否则会出现「Stage B 删了、Stage C 找不到」的断点。
**收益（建议写进 Exit Criteria）**：删完后 `analysis.controller.ts` 的 ctor 只剩 `DatabaseService` + `DownloadScheduler` + `DownloadService`，cloud 侧再无任何通向 `AnalysisEngine`/`AnalysisVideoResolver` 的 import 路径 —— 这是物理隔离能用一条 grep 断言证明的前提。建议 Proof 写成 cloud 包内 `grep -rn "adapters/ffmpeg\|adapters/llm\|analysis-engine\|QwenClient\|PathsService" src` 必须 0 命中。

### 依赖分配（各包 package.json，计划一字未提）
- cloud：`sharp`（`chat-photo.service.ts:14`）、COS SDK（`chat-photo.service.ts:27`）、`multer`/`@nestjs/platform-express`（`chat.controller.ts:15` `AnyFilesInterceptor`）、Stage C 的 `openai`
- nas：COS SDK（`knowledge-publisher.service.ts:16`、`screenshot-retry.service.ts:8`）、`nodemailer`（`notification.service.ts:2`）、ffmpeg 相关、`QwenClient`
- 两侧：`pg`/`prisma`（经 server-common）、`lodash`（`analysis-trigger.service.ts:2`、`analysis-video-resolver.ts:21`）

### `download.service.ts` 的 `onModuleInit`(110-149) 拆法（底图原先漏给）
它同时做四件跨侧的事：`:115` `new FileCacheStore(paths.BILI_API_CACHE_DIR)`、`:118` `new FfmpegMerger()`、`:120` `ensureOutputDir(outputDir)`、`:122` `merger.isAvailable()`。cloud 半照搬会同时违反物理隔离与「不 join 媒体路径」。

### 既有隐患，本阶段不修（建议记 Deferred + 后继门）
`analyze:cont:${bvid}:${cid}`（`analysis-trigger.service.ts:204`）与 `analyze:${bvid}:${cid}`（`:134`、`analysis-task.controller.ts:84,339`、`analysis.controller.ts:196`）是两个不同键，活跃唯一索引（`database.service.ts:1580`）拦不住彼此 → 同资源可并发双跑。Stage B 会把触发入口变成 3 个共存，概率放大，但**不应在拆分切片里顺手修**。

## 5. cloud 侧其余文件归属（二次复审补齐）

- `analysis/summary-render.ts`：纯函数，唯一消费方 `analysis-task.controller.ts:22-26`（调用 `:226/230/234`）
- `analysis/prompt.service.ts`：HTTP 侧提示词 CRUD，`prompt.controller.ts:28` 注入；**nas 不复制**（它只是 db 薄壳 `:23`，nas 的 `resolvePromptId` 直接用 db）
- `analysis/prompt.controller.ts`：`:24` `@Controller("api/analysis/prompts")`，前端 9 处调用
- `analysis/analysis-task.controller.ts`：端点全为读云 DB / 入队，无触盘；`:35` 改指新 query service，`:38` 死注入删
- `analysis/analysis.controller.ts`（B7 后残余）：只剩 `/trigger`(103-200) + `/config`×3(219/238/262)；ctor 仅留 `:57` db、`:58` scheduler、`:59` downloadService
- `download/create-dedup.ts`：纯函数，唯一消费方 `download.service.ts:31`（`:473`）
- `download/download.dto.ts`：`DownloadDto` 被 `download.controller.ts:38`、`download-scheduler.ts:78` 消费
- `download/download.controller.ts`：`:24-28` 三注入全是 cloud 半，10 个端点均为创建/读/停/恢复/删
- `download/download-scheduler.ts`：**拆** —— cloud 留 `createDownload:77`/`stopTask:102`/`resumeTask:107`/`deleteTask:114`；`runningSet:24` + `tryScheduleNext:125-158` + `onModuleInit:35-74` + `onTaskFinished:52-63` 归 nas 或随 B-4 删除
- `video/video.controller.ts`：`:18` 注入 DownloadService，四端点 `:34/52/89/113`；随 `download.module.ts:9` 迁出
- `parse/`：需求 `:29` 明列；`parse.service.ts:8-17` 无 ffmpeg/引擎。阻塞点 `:45-48` cookie + `:55` cache dir + `:43` cookieString 永不刷新
- `auth/auth.controller.ts`：`:6` 注入 DownloadService，四端点 `:11/18/20/28`；阻塞点 `download.service.ts:800` 写 NAS cookie 文件
- `chat/*`（8 文件）：需求 `:29/58`；`chat.service.ts:7` 的 `QwenClient` 是 Stage C 入口
- `user-auth/*`（10 文件）：`user-auth.module.ts:19` 注册 `APP_GUARD`，纯 HTTP 面
- `worker/worker.controller.ts`：`:20` 只注入 db，三端点全 DB 读 + `cancelWorkerJob:53`；**`worker.module.ts:8` 的 `providers:[WorkerService]` 必须在 cloud 删掉**
- `main.ts`：两侧各一份。cloud 保留 `:19-21/36-44` 静态资源（前端产物，非媒体）+ `:27` listen；**删** `:7/24-25/32`（PathsService + `SUMMARY_BASE_DIR` mkdir + DOWNLOAD_ROOT 日志）。nas 版无 `listen`，改 `createApplicationContext`
- `app.module.ts`：两侧各一份。cloud 去掉 `:22` PathsModule、`:28` NotificationModule，Worker 仅 controller，保留 `:33-37` interceptor；nas 保留 Paths + Notification，Worker 仅 provider，无 interceptor/UserAuth/Chat/Parse；两侧都要改 `:20` `envFilePath`

## 6. COS / embedding 的归属裁决

**结论：客户端下沉 `adapters`（不是 `server-common`）+ 两侧各留薄 Nest wrapper，不改需求。**

理由：下沉 `server-common` 会违反需求 `:21,31` 的职责表述；而 embedding 已有现成先例——真客户端在 `packages/adapters/src/embedding/embedding-client.ts`（`package.json` 有 `"./embedding"` export），`EmbeddingService` 只是 79 行薄壳、非 adapter 依赖仅 `:43` 一行 `db.getSettings`；COS 照同一路子新增 `adapters/src/cos`（`adapters/dist/cos/` 残留产物说明它曾在 adapters），依赖方向合需求 `:25`。

**必须一并下沉的易漂移项**：`embedding.service.ts:9-12` 常量、`:21-26` `normalizeEmbeddingText`（`knowledge-publisher.service.ts:153,161` 用它做向量复用键，**漂移会静默重复计费**）、`:50-57` 维度守卫、`cos-store.service.ts:29-34` `publicUrlPrefix` 推导。

## 7. `packages/server/tests/` 17 文件落位

| 文件 | 目标包 | 改写？ |
|---|---|---|
| `analysis/summary-render.test.ts` | cloud-server | 否（仅 import 路径） |
| `analysis/summary-markdown-controller.test.ts` | cloud-server | **是**：`:9` 实例化 controller，ctor 变（删 `:38` 死注入、`:35` 换 query service），`:2` fs mock 可清 |
| `chat/citation.test.ts` | cloud-server | 否 |
| `chat/photo-compress.test.ts` | cloud-server | 否（`sharp` 随 cloud 包） |
| `database/ai-summary-task.test.ts` | cloud-server（**拆三份**） | **是**：`:318-343` 路径用例 → server-common；`:384` 单写者用例 → nas；其余留 cloud（`:8` PathsService 依赖须去掉） |
| `database/analysis-sub-task.test.ts` | nas-worker | 否 |
| `database/screenshot-retry.test.ts` | nas-worker | 否 |
| `database/summary-integrity.test.ts` | nas-worker | **是**：`:34-50`（`listLocalImageRefs`，来自 cloud 侧 `summary-dir.ts`）需拆出 |
| `database/task.test.ts` | nas-worker | **是**：`:4` PathsService；B-4 去 `taskCache` + 状态门收紧后断言需重写 |
| `download/create-dedup.test.ts` | cloud-server | **是（N2 直接命中）**：`:25-32` 期望反转为 `block:true`，删 `fileExists` 入参，`:22` 文案改，补「文件已删仍拦截」用例 |
| `knowledge/vector-search.test.ts` | nas-worker | 否（改 import + 薄壳桩） |
| `user-auth/*`（6 文件） | cloud-server | 否 |

基建：`tests/helpers/db.ts` 与 `tests/global-setup.ts` 两侧各复制一份（前者只依赖 server-common；后者需改 contract / prisma.config 路径）。



