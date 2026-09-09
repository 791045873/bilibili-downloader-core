# Plan Audit: 下载入队创建层去重

日期: 2026-09-09
类型: plan audit（independent subagent）
对象: `docs/plans/2026-09-09-download-create-dedup-plan.md`
需求: `docs/requirements/2026-09-09-download-create-dedup.md`
结论: **FAIL**（1 项 Major，计划按现状实现将无法通过 typecheck 且破坏一键 AI 总结链路；修补后可复审）

## 审计核验（与基线声明一致的部分）

- `createTask` download.service.ts:368-406，返回 `{id, message}`（:405），无去重 ✓
- `POST /api/download` 链：download.controller.ts:37-45 → download-scheduler.ts:96-113 → createTask ✓
- resolver 截图回退 `createTask` 调用 analysis-video-resolver.ts:270-275，同步 `executeTask` :292-295，依赖 `task.id`（:279/:287-289）✓（调用点在 :270，非计划所写 262-287 区间内核心；链路实际延伸至约 :315，见 M2 注）
- `findTasksByBvidsAndCids` database.service.ts:618-665：按 (bvid,cid) 去重取最新 ✓（但还返回 `autoSummary`/`summaryStatus` :628-629/:656-664，计划基线漏写，不影响设计）
- **确无** active（created/downloading）查询方法，新增 `findActiveTaskByBvidAndCid` 合理 ✓
- `findCompletedTaskByBvidAndCid` :682-693 返回完整 TaskRecord（含 outputFile）✓
- `scheduleLowResDownload` download-scheduler.ts:137-176 不经 createTask ✓（计划声明属实）
- `fileExists` download.service.ts:665-667 → fileStore.exists ✓；`resolveFromDownloadRoot` path-anchor.ts:49-60 纯函数 ✓；`PathsService.DOWNLOAD_ROOT` getter paths.service.ts:25，DownloadService 构造已注入 PathsService（download.service.ts:88-90）✓
- 前端 `request()` api/index.ts:19-29 现为 `err.error || HTTP ${res.status}`；Nest `ConflictException("中文")` body 为 `{message, error:"Conflict", statusCode:409}` → 现状确实显示 "Conflict"，修复 `err.message` 优先**真实必要** ✓（计划基线写 "statusText"，实际是 `HTTP ${res.status}`，表述小误）
- `VideoDetail.doAddToQueue` :308-363 逐任务 catch 吞错（:335 `{id:-1,message:""}`），外层 catch :360 对逐任务错误不可达，`setErrorMsg` 于 :520-522 渲染 ✓；`ParseResultList.doAddToQueue` :447-499 收集 message 到 actionError ✓——"加入失败"措辞符合需求 :16 的可接受口径
- 测试方向文档 `docs/testing/2026/09-09-download-create-dedup-testing.md` 存在且覆盖 AC1-AC7 需求级状态 ✓
- scripts/ 无 createTask/createDownload 依赖；测试 harness 仅实例化 DatabaseService（tests/helpers/db.ts:7-18，真实 PG）

## 发现

| # | 严重度 | 问题 | 证据 | 处置 |
| --- | --- | --- | --- | --- |
| F1 | Major（必修） | 计划基线"调用方三个"不完整：`DownloadScheduler.createDownload` 还有 2 个调用方被返回类型变更 + 去重门波及，计划完全未提。① `analysis.controller.ts:367`（一键 AI 总结，`POST /api/analysis/trigger` :103/:131）使用 `created.id` :383 传入 `scheduleInitialLowResDownload(taskId: number)` :415——`id?: number` 下直接 typecheck 失败；且门拒绝时 `created=false, id=undefined` 仍会以 undefined taskId 走 :383/:423 insertAnalysisSubTask，产出坏行。计划必须显式决策：一键链路是否受门管控（建议受控并在 created=false 时短路/给出可读返回），以及该端点的拒绝呈现。② `summary-repair.service.ts:312` `const { id } = await createDownload(...)`——门拒绝时不抛错，report 仍写"已按原任务画质入队重新下载"且 queuedTaskId 为 undefined（:323-327），报告失真；需处理 created=false 分支 | analysis.controller.ts:367-401、:415-430；summary-repair.service.ts:302-327 | 并入计划 Phase 1，新增对两个调用方的决策与改法 |
| F2 | Minor | `createTask` 返回改为 `{created, id?, message}` 后，resolver 的 `task.id`（analysis-video-resolver.ts:279/:287-289）为类型错误。计划应指明类型策略（如 `skipDedup: true` 重载返回 `{created: true; id: number; message: string}`，或调用侧处理），否则 AC5/typecheck 落地时才发现 | analysis-video-resolver.ts:270-289 | 并入计划 Phase 1 Item 描述 |
| F3 | Minor | 基线小误（不改变设计）：`findTasksByBvidsAndCids` 还返回 autoSummary/summaryStatus；`request()` 兜底是 `HTTP ${res.status}` 而非 statusText；resolver 链路实际约 :251-315；scheduler.createDownload 为 :96-113 | database.service.ts:628-629、api/index.ts:26、analysis-video-resolver.ts:251-315 | 修正基线表述即可 |
| F4 | Minor | Proof "门判定用例"与现有 harness 不匹配：门在 `DownloadService.createTask` 内，该类构造需 DatabaseService + PathsService 及 onModuleInit 初始化的 SDK/fileStore/merger 重依赖，现有测试仅能实例化 DatabaseService（tests/helpers/db.ts:7-18）。DB 层新查询用例可行；门判定用例需计划明确路径：把判定逻辑抽为纯函数（输入 activeTask/completedTask/fileExists 布尔），或测试中构造带 stub 的 DownloadService。否则 AC1-AC4 的服务端自动化验证不可达 | download.service.ts:63-90、tests/helpers/db.ts:7-24 | 并入计划 Phase 1（推荐抽纯判定函数） |
| P1 | Note | 409 只经 controller 抛出，scheduler/resolver 内部调用不抛（计划设计的 `{created:false}` 返回与 ConflictException 分层合理）；ParseResultList "加入失败"措辞已被需求 :16 明示接受 | download.controller.ts:44 + 计划 Item 4 | 无需动作 |

## 强制修复（复审前必须并入计划）

1. F1：补齐 `analysis.controller.ts:367` 与 `summary-repair.service.ts:312` 两个 `createDownload` 调用方的决策与改法（类型 + created=false 行为 + 一键链路是否豁免/受控）。
2. F4：明确门判定的测试路径（抽纯函数或 stub 构造方式），使 AC1-AC4 的 Proof 与现有 DB-layer harness 兼容。

建议一并处理 F2（resolver 类型策略）。修复后按流程复审即可转 PASS。

## 复审记录

## Re-audit (round 2)

日期: 2026-09-09
对象: 修订后的 `docs/plans/2026-09-09-download-create-dedup-plan.md`（全文重读）
方法: 对照 live code 重新核验首轮 F1-F4 与 Phase 1 新增项，并全仓 grep 复扫调用方

### 首轮发现复核

| 首轮 # | 复核结果 | 证据 |
| --- | --- | --- |
| F1 (Major) | **已解决** | 计划 Phase 1 新增两条 Fix：① 一键 AI 总结（analysis.controller.ts:367-401，实读确认 `created.id` :383 传入 `scheduleInitialLowResDownload(taskId: number)` :415、:401 直接返回 `created`）——`created === false` 时 throw ConflictException，`created === true` 时用 `created.id`，类型与语义闭环；② 延迟重下（summary-repair.service.ts:312-336，实读确认 `{id}` 解构填 `queuedTaskId` :326、active 分支 :305-310 走 deferred）——`created === false` 时推入 deferred/failed 附 `result.message`，不填 queuedTaskId。两处改法与 live code 吻合 |
| F2 (Minor) | **已解决** | Decision 项：resolver 传 `{skipDedup: true}`，重载返回 `{created:true; id:number; message}`，`task.id`（analysis-video-resolver.ts:279/:287-289/:297）类型不变，可行 |
| F3 (Minor) | **已解决** | 基线已修正：findTasksByBvidsAndCids 含 autoSummary/summaryStatus（计划 :18，与 database.service.ts:628-629/:656-664 一致）；`request()` 兜底改为 `HTTP ${res.status}` 表述（计划 :20，与 api/index.ts:26 一致）；resolver 链路 :251-315、scheduler :96-113 均已写对 |
| F4 (Minor) | **已解决** | 门逻辑抽为纯函数 `decideCreateDedupVerdict`（download/create-dedup.ts），单测 `tests/download/create-dedup.test.ts`——vitest.config.ts include 为 `tests/**/*.test.ts`，新目录可被收录；`findActiveTaskByBvidAndCid` 用例可走现有 tests/helpers/db.ts 真实 PG harness。设计可行 |

### Phase 1 新增项复核

- createTask 重载策略：现有签名 `{id:number; message:string}`（download.service.ts:368-406）；计划的两条重载（skipDedup→`{created:true;id:number}` / 默认→`{created:boolean;id?:number}`）TS 可行，resolver 单参调用走默认重载但 Decision 强制其传 `{skipDedup:true}`。
- 纯函数模块 + 测试：路径与 vitest include 匹配；现有测试目录结构（tests/database、tests/paths 等）下新增 tests/download/ 无障碍。
- `findActiveTaskByBvidAndCid` 设计与既有模式一致：`findLatestTaskByBvidAndCid`（database.service.ts:668-679）、`findCompletedTaskByBvidAndCid`（:682-693）同为 where + createdAt desc + first，status 过滤 `{created,downloading}` 可行。

### 调用方全仓复扫

grep `packages/server/src` + `scripts/`：createTask 仅 resolver :270 一处；createDownload 仅 download.controller.ts:44、analysis.controller.ts:367、summary-repair.service.ts:312 三处；scripts/ 无引用。全部覆盖，无遗漏。

### Phase 2 未变项复核

- `request()` 修复：现况确为 `err.error || \`HTTP ${res.status}\``（api/index.ts:19-29），Nest ConflictException body `{message, error:"Conflict"}` 下 409 中文消息会被 "Conflict" 掩盖；改 `err.message` 优先真实必要 ✓。
- VideoDetail.doAddToQueue（:308-363）逐任务 catch 吞错（:335）属实；errorMsg 渲染位仍在（首轮 :520-522 核验，代码未变）；ParseResultList（:447-499）已收集 message ✓。两项 Fix 仍成立。

### 发现（第二轮）

| # | 严重度 | 问题 | 证据 | 处置 |
| --- | --- | --- | --- | --- |
| N1 | Minor | 计划为 `DownloadScheduler.createDownload` 指定的返回形状 `{created: boolean; id?: number; message}` 为非判别联合：`created === false` throw 之后 `created.id` 仍为 `number \| undefined`，analysis.controller.ts:383（`taskId: number`）与 summary-repair.service.ts:326（`queuedTaskId?: number` 按成功分支写 number）会出现 typecheck 摩擦 | download-scheduler.ts:96-98、analysis.controller.ts:377-389、summary-repair.service.ts:312-327 | 实现时建议 scheduler 返回与 createTask 重载一致的判别联合（`{created:true;id:number;message} \| {created:false;message}`），或调用方显式 `id === undefined` 兜底；AC7 typecheck 门会强制解决，不阻塞计划 |
| N2 | Note | 一键总结 Fix 抛出的 ConflictException 位于 try 内，会被外层 catch（analysis.controller.ts:402-412）再包装为 `BadGatewayException("创建 AI 总结下载任务失败: <中文消息>")`——该端点实际返回 502 而非 409，但中文消息保留，Phase 2 request() 修复后仍可见 | analysis.controller.ts:402-412 | 需求 :16 只要求消息文本可见，不强制该端点 409；实现时若想保持 409 语义，可在 catch 中识别 ConflictException 透传，或接受 502 包装；两种均可接受，无需改计划 |

### 验证与收尾一致性

- 闭门项与 00-plan-authoring-and-execution-guide.md 模板一致（含 testing 文档、text consistency、independent closure audit）；testing 文档 `docs/testing/2026/09-09-download-create-dedup-testing.md` 已存在 ✓。
- Phase 3 验证命令 `pnpm typecheck`、`pnpm build`、`pnpm --filter @bilibili-downloader/server test` 均为 project-context.md 登记的真实命令 ✓。
- Deferred 并发竞态条目含 Classification/Why Not Blocking/Successor 三要素，符合模板 ✓。

### 结论

**PASS-with-notes**：首轮 F1-F4 全部已解决；新增 N1（Minor，实现期类型判别建议）与 N2（Note，502 包装语义）不阻塞计划进入实现，实现时按 N1 建议处理即可。
