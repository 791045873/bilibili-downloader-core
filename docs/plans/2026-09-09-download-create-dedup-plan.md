# 2026-09-09 下载入队创建层去重计划

> Plan Status: completed
> Last Reviewed: 2026-09-09
> Source: `docs/requirements/2026-09-09-download-create-dedup.md`（用户直接请求；有意推翻 2026-08-10 创建层不去重决策）
> Related: `docs/plans/2026-08-10-download-enqueue-dedup-ux-plan.md`（被推翻决策）、`docs/plans/2026-09-09-outputfile-relative-anchor-plan.md`（相对锚点，读文件判定复用其 resolve helper）
> Audit: required
> Testing: `docs/testing/2026/09-09-download-create-dedup-testing.md`

## Current Baseline

- `DownloadService.createTask`（download.service.ts:368-406）无任何去重，直接 insertTask + taskCache；调用方五个：
  1. `POST /api/download` → `DownloadController.createDownload`（download.controller.ts:37-45）→ `DownloadScheduler.createDownload`（download-scheduler.ts:96-113）→ `createTask`；
  2. `analysis-video-resolver.resolve()` 截图回退（analysis-video-resolver.ts:251-315，createTask 在 :270）：`createTask` 后同步 `executeTask`，依赖返回 `{id}`；
  3. 一键 AI 总结（analysis.controller.ts:367-401）：`downloadScheduler.createDownload` 后用 `created.id` 调度低清（:383）并作为响应返回（:401）；外层 catch 包成 `BadGatewayException("创建 AI 总结下载任务失败: ...")`（:411）；
  4. 总结修复延迟重下（summary-repair.service.ts:302-336）：`createDownload` 解构 `{id}` 填入 `report.deferred[].queuedTaskId`；同资源 task 已是 created/downloading 时走 deferred 跳过分支（:305-310）；
  5. （低清子任务不经 createTask，不受影响。）
- DB 查询现状：`findTasksByBvidsAndCids` 返回去重后最新记录（含 autoSummary/summaryStatus）；`findCompletedTaskByBvidAndCid`（database.service.ts:682-693 附近）返回 status='success' 完整记录（含 outputFile）。**无**"查 active（created/downloading）任务"的查询方法。
- 文件存在性判定：`DownloadService.fileExists(path)`（download.service.ts:665-667）→ `fileStore.exists`；相对值解析用 `resolveFromDownloadRoot`（paths/path-anchor.ts，上一计划产物）；`DownloadService` 构造器已注入 PathsService。
- 前端：`api.createDownload`（api/index.ts:102-118）返回 `{id,message}`；`request()`（api/index.ts:19-29）错误提取为 `err.error || "HTTP ${res.status}"`——Nest `ConflictException("中文")` 的 body 是 `{message,error:"Conflict"}`，故现有 4xx 中文消息在前端会显示成 "Conflict"/"HTTP 409"（既有缺陷，与本计划呈现需求相关）；`VideoDetail.doAddToQueue`（VideoDetail.tsx:308-361）逐任务 catch 吞错（`{id:-1,message:""}`），errorMsg 有用户可见渲染位（:520-522）；`ParseResultList.doAddToQueue`（ParseResultList.tsx:447-497）逐任务 catch 收集 message 并在 actionError 展示。
- 前端"已下载"标记（展示性）已在位，本次不改其拦截语义。

## Goals

- `createTask` 层按 (bvid,cid) 去重：active 任务存在 或 success+磁盘文件存在 → 拒绝创建（409 + 中文消息）。
- resolver 截图回退经 `skipDedup` 豁免。
- 前端两入队页可见拒绝原因；request() 错误消息提取修正为优先 `err.message`。

## Non-Goals

- 不做唯一索引/原子化防并发双建（竞态为记录在案的残余风险）。
- 不改前端"已下载"标记语义（保持展示性）。
- 不改低清子任务与调度器行为。
- 不做画质比对（success+文件存在即拦）。

## Infrastructure And Config Prereqs

No infra prereqs beyond existing baseline.

## Execution Plan

### Phase 1 - 服务端去重门

Status: completed
Targets: `packages/server/src/download/create-dedup.ts`（新建）、`database/database.service.ts`、`download/download.service.ts`、`download/download-scheduler.ts`、`download/download.controller.ts`、`analysis/analysis-video-resolver.ts`、`analysis/analysis.controller.ts`、`analysis/summary-repair.service.ts`

- Item Types: `Add | Decision | Fix`
- Prereqs: none

- [x] Add: 新建 `download/create-dedup.ts`，导出纯函数 `decideCreateDedupVerdict(input: { activeTaskExists: boolean; completedOutputFile: string | null | undefined; fileExists: boolean }): { block: boolean; message?: string }`——active 存在 → block"排队中/下载中"；否则 success outputFile 存在磁盘 → block"已下载且文件存在"；否则放行。门逻辑独立于 DB/文件系统，可纯函数单测。
- [x] Add: `DatabaseService.findActiveTaskByBvidAndCid(bvid, cid): Promise<TaskRecord | undefined>`——status ∈ {created, downloading}，按 createdAt 最新一条。
- [x] Add: `createTask(dto, opts?)` 重载签名：
  - `createTask(dto, opts: { skipDedup: true }): Promise<{ created: true; id: number; message: string }>`
  - `createTask(dto, opts?: { skipDedup?: boolean }): Promise<{ created: boolean; id?: number; message: string }>`
  - 实现：skipDedup 跳过门直接插入；否则查 active + completed → `fileExists(resolveFromDownloadRoot(outputFile, DOWNLOAD_ROOT))` → `decideCreateDedupVerdict` → block 时返回 `{ created: false, message }`（含日志），放行时 `{ created: true, id, message: "任务已创建" }`。
- [x] Decision: resolver 截图回退的 `createTask` 调用传 `{ skipDedup: true }`（重载保证返回 `{created:true,id:number}`，`task.id` 用法不变）。备选：让它复用 active 任务（否决——语义耦合调度器状态机，收益低）；让回退被 409 拒绝后重试（否决——截图链路需要同步拿到任务 id）。残余风险：无。
- [x] Add: `DownloadScheduler.createDownload` 返回类型同步 `{ created: boolean; id?: number; message: string }`；`DownloadController.createDownload` 在 `created === false` 时 `throw new ConflictException(result.message)`，成功路径返回 `{ id, message }` 不变。
- [x] Fix: 一键 AI 总结（analysis.controller.ts:367-401）适配新返回形状：`created === false` 时 throw `ConflictException(result.message)`（替代原 BadGateway 包装路径，消息可见）；`created === true` 时照常使用 `created.id`。
- [x] Fix: 总结修复延迟重下（summary-repair.service.ts:312-336）适配：`created === false` 时该条目推入 `report.deferred`（或 failed）并附 `result.message` 作为 reason，**不**填 queuedTaskId；成功时照常。
- [x] Proof: 纯函数单测（`tests/download/create-dedup.test.ts`：active 拦 / 文件存在拦 / 文件缺失放行 / 无记录放行）+ DB 层 `findActiveTaskByBvidAndCid` 用例（见测试文档）。

Exit Criteria:

- [x] AC1-AC5 服务端行为落地（409 + 提示 + 无新行 / 文件缺失放行 / cid 隔离 / resolver 豁免 / 两处分析调用方适配后 typecheck 通过且语义正确）
- [x] `docs/logs/` 更新

### Phase 2 - 前端呈现

Status: completed
Targets: `packages/frontend/src/api/index.ts`、`pages/VideoDetail.tsx`、`pages/ParseResultList.tsx`（如需）

- Item Types: `Fix`
- Prereqs: Phase 1

- [x] Fix: `request()` 错误提取改为 `err.message || err.error || statusText`（修正既有 4xx 中文消息被 "Bad Request"/"Conflict" 掩盖的缺陷，使 409 去重提示可见）。
- [x] Fix: `VideoDetail.doAddToQueue` 逐任务 catch 保留 e.message（对齐 ParseResultList 模式），被拒任务汇总提示（setErrorMsg/等价展示），成功任务照常 addTaskIds。
- [x] Proof: frontend typecheck；代码级核对两个入队页提示路径（真实页面交互留用户部署后确认）。

Exit Criteria:

- [x] AC6 两页可见拒绝文本；AC7 前端 typecheck/build 过
- [x] `docs/logs/` 更新

### Phase 3 - 验证与收尾

Status: completed
Targets: 全仓

- Item Types: `Proof`

- [x] Proof: `pnpm typecheck`、`pnpm build`、`pnpm --filter @bilibili-downloader/server test` 全绿。
- [x] Add: `docs/logs/2026-09-09-download-create-dedup.md`；2026-08-10 决策推翻记录（requirement 文档已含，log 引用）。
- [x] Proof: closure audit（独立 subagent）通过并留档。

Exit Criteria:

- [x] 全部验证命令通过
- [x] testing 文档各方向确认
- [x] closure audit 证据落库

## Plan Audit

- Status: passed（PASS-with-notes。首轮 FAIL 1 Major 已修订补齐；复审新增笔记：N1 scheduler.createDownload 用 discriminated union（实现时落实）；N2 一键总结端点 409 经外层 catch 变 502 但中文消息可见——按需求"消息可见"接受。调用方全量 sweep 仅 4 处，无遗漏）
- Reviewer / Agent: subagent（独立审计，两轮）
- Evidence: `docs/audits/2026-09-09-plan-audit-download-create-dedup.md`（含 Re-audit round 2 节）

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned（app-overview 若涉及入队行为描述需同步；否则写明无需更新）
- [x] verification has run（typecheck / build / server 测试）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（subagent，pass-with-conditions；M1/P2 条件已回填：app-overview 两处 POST /api/download 行为行补 409 语义、testing 文档库名笔误修正）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 并发双建竞态

- Classification: `watch-only residual`
- Why Not Blocking Closure: 判定与插入非原子，同资源并发双请求可能各建一行；与现有调度模型一致，无唯一索引；实际入队为用户手工批量操作，风险低。
- Successor Required: `no`（若未来出现实际重复，改为 (bvid,cid,status) 部分唯一索引或原子 claim）

## Closure

Status Note: 三个 Phase 全部落地：去重门（纯函数判定 + DB active 查询 + 磁盘校验）在 createTask 生效，409 语义接通 controller；resolver 豁免与两处分析调用方适配完成；前端 request() 消息提取修正 + VideoDetail 汇总展示；`pnpm typecheck`/`pnpm build`/server 测试（12 文件 87 用例）全绿并由 closure audit 独立复跑。前端 409 提示的运行级人工目测留用户部署后确认。

Closure Audit Evidence:

- Reviewer / Agent: subagent（独立 closure audit，pass-with-conditions）
- Evidence: `docs/audits/2026-09-09-closure-audit-download-create-dedup.md`（9 项实现声明逐项核实；M1 app-overview 409 语义与 P2 testing 文档库名笔误已回填；P1 502 包装与 P3 并发竞态为已裁决项）

Follow-up:

- （无阻塞项；并发双建竞态见 Deferred But Adjudicated）
