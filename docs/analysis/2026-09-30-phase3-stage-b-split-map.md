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
1. **`download` kind 缺失（阻塞级）**：`download-scheduler.ts:96` 的 `createDownload → tryScheduleNext` 是同进程直调；`tryScheduleNext`(125-158) 仅由启动(66)/创建(96)/恢复(109)/完成(61) 事件驱动，而 nas 现在**只注册 4 个 kind**（无 `download`）。拆分后 cloud 创建的任务会**停在 `created` 永不执行**。需新增 `kind:"download"`（`{taskId}`、`refType:"task"`、`dedupKey: download:${bvid}:${cid}`），或在 nas 侧加定时 `claimNextCreatedTask` 轮询
2. `abortTask`(727-734) 控制面在 cloud、AbortController 在 nas → 用 `worker_job.cancel_requested`（列已存在，`claimNextJob` 的 WHERE 已含 `cancel_requested = 0`，`database.service.ts:1610`）或新增 `download_cancel` kind
3. **`evaluateCreateDedup:469` 的 `fileExists` 磁盘判定无法跨侧**：cloud 去重门将失去「文件已存在」这一事实 → 必须明确降级口径（纯 DB 去重 / 由 nas 物化文件存在性 / 借 `integrity_check` 的 `videoMissing`）并留证
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

## 4. 待补

`notification/`、`knowledge/`（cos-store / embedding / knowledge-publisher）、`summary-dir.ts` / `summary-render.ts` / `document-generator.ts` / `timestamp.ts` / `file-naming.ts` / `create-dedup.ts` / `analysis-video-resolver.ts` / `analysis-engine.ts` / `screenshot-retry.service.ts` / `summary-integrity.service.ts` / `paths/` / `video.controller.ts` / `parse/` / `auth/auth.controller.ts` 的逐个归属，以及受影响测试清单——子代理输出两次在此处被截断，实施对应部分前需补齐（同一分析口径可复用）。

初步判断（待证实）：`cos-store.service.ts` 与 `embedding.service.ts` 两侧都要（cloud 传问答照片 / nas 传截图与算向量）→ 若要「共享不复制」，需下沉 `server-common`，但这偏离需求里 server-common 的职责表述（DB/日志/作业仓储/settings/cookie/类型），属需裁决项。

