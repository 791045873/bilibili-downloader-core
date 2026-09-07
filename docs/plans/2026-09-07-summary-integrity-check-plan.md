# 2026-09-07 AI 总结本地原始内容完整性检查 Plan

> Plan Status: completed
> Last Reviewed: 2026-09-07
> Source: `docs/requirements/2026-09-07-summary-integrity-check.md`
> Related: `docs/plans/2026-09-04-summary-output-relative-path-plan.md`（summary_output 相对路径读侧语义，本功能直接复用）
> Audit: required
> Testing: `docs/testing/09-07-summary-integrity-check-testing.md`

## Current Baseline（2026-09-07 已核对 live 代码）

- **磁盘布局**：AI 总结原始产物位于 `SUMMARY_BASE_DIR = join(DOWNLOAD_ROOT, "summary")` 下，每资源一个目录（`resolveSummaryDir`：`{标题}-{bvid}-{cid}`，同资源复用既有目录，`analysis-trigger.service.ts:624-675`）。目录内：`<标题>-summary.md`（`analysis-engine.ts:443-447`）+ `screenshots/segment-N*.jpg`（`analysis-engine.ts:253,352-353,425`，md 内以相对路径 `screenshots/…` 引用）。
- **读侧路径语义**：`resolveSummaryOutputPath(value, downloadRoot)`（`analysis/summary-dir.ts:50-58`）——相对值按 `DOWNLOAD_ROOT` 拼接，遗留绝对值原样。三个消费方（markdown 查看 `analysis-task.controller.ts:132-178`、发布 `:307-368`、回填）均使用。
- **DB**：`ai_summary_task` 由 Prisma contract 管理（`src/prisma/contract.prisma:23-46`）。schema 演进流程：改 contract → `prisma contract emit` → `prisma migration plan --name <slug>` → `prisma db migrate`（`prisma/baseline/README.md` 迁移工作流表，P3 drill 实证）。`AiSummaryTaskRecord` 接口与 `mapAiSummaryTaskRow`（`database.service.ts:82-105,817-856`）为数据访问层映射点；列表读取 `listAiSummaryTasksPaginated:869`，知识回填全量读取 `listAiSummaryTasksForKnowledgeBackfill:907` 可作批量查询模式参考。
- **总结执行链路**：`claimAiSummaryTask`（`database.service.ts:964-1006`，含防并发 raw SQL claim）→ `upsertAiSummaryTask`（`:1046`）为记录写入/更新入口；新总结启动会覆盖 `status` 等字段——完整性新列需在此链路重置。
- **进程内异步 job 先例**：rebuild 用 `tryStartRebuild`（`analysis-trigger.service.ts:58`，按 summary task id 的 `Set<number>` 互斥）+ controller 内 `void service.run…()` + 409（`analysis-task.controller.ts:263-305`）；publish 同模式（`:307-368`）。注意：rebuild **不经 claim、无"开始"态 upsert**，唯一一次写库是终态 `completed` upsert（`analysis-trigger.service.ts:828-835`）——完整性重置不能只绑 claim/开始态。本功能的"进行中不可重复触发"沿用该模式，但互斥粒度为**全局单例**（同一时刻至多一个全量检查），与 rebuild 的 per-id 粒度不同。
- **markdown 图片解析**：`MARKDOWN_IMAGE_RE`（`summary-dir.ts:61`，模块私有，`/g` 正则有 lastIndex 风险）；`knowledge-publisher.service.ts:275 extractImageUrls` 为该服务私有副本。完整性检查需要"列出 md 中相对图片引用"的共享纯函数，需从 `summary-dir.ts` 导出（`extractImageUrls` 不导出复用，避免跨模块私有依赖）。
- **前端**：`AiSummaryTasks.tsx` 表格已接入 `useResizableColumns`（操作列 `key: "actions"` 固定），页面已有"刷新任务状态"手动刷新 + Modal 模式；`api/index.ts:205 getAiSummaryTasks`、`types/index.ts:190 AiSummaryTaskEntry`（`knowledgeStatus`/`knowledgeError` 双列标签先例可直接参考）。
- **缺口**：无任何完整性检查能力；`ai_summary_task` 无承载结果的列；前端无对应列与按钮。

## Goals

- 一键批量检查全部 completed AI 总结任务的本地原始内容（md + 相对截图）完整性，结果持久化并在前端表格展示。
- 检查仅手动触发、运行中互斥、结果逐条写 DB、重触发后重置。

## Non-Goals

- 不修复/删除缺失文件；不检查视频文件本体与 COS 对象；无单任务检查入口；无自动/定时触发。
- 不改 `summary_output` 存储语义（沿用相对路径读侧容错）。
- 不改 AI 总结执行管线核心逻辑（仅在其启动处补一个完整性字段重置）。

## Infrastructure And Config Prereqs

- schema 演进需 PostgreSQL 测试库：`docker run --rm -d --name bdl-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bdl_test -p 55432:5432 pgvector/pgvector:pg17`（同 `project-context` 验证命令表）。
- 演进产物（migration plan 输出）随镜像发布属部署既有流程，本计划不改部署配置；容器启动 `prisma db init` 对已签名库 + 已应用迁移的行为需在验证中确认（见 Phase 1 Proof）。
- 无新增 env / secrets / 端口。

## Decisions

- **D1 异步 job + 状态查询（而非同步接口）**：检查需逐条读 md 与 stat 截图，记录量大时耗时不可控；且需求明确"进行中不可重复触发"的 job 语义。采用与 rebuild/publish 一致的进程内异步模式 + `GET …/status` 供前端轮询。备选（同步返回汇总）在记录量大时有请求超时风险。残余风险：单进程假设，多副本部署时互斥失效——与 rebuild 先例一致，当前部署形态为单副本，接受。
- **D2 复检覆盖写，且不改写 `updated_at`**：每次检查对每条 completed 记录无条件重写三个完整性字段（不做"跳过未变化"优化）。文件系统态可变，增量化收益低、复杂度高。完整性写入必须**不触碰 `updated_at`**（时间语义由 `integrityCheckedAt` 单独承载）——否则一次全量检查会刷新全部记录的更新时间并打乱列表默认排序（列表按 `updated_at desc` 排序，`database.service.ts:883`）。残余风险：无。
- **D3 明细截断**：`integrity_detail` 存缺失项列表（每行一个相对路径），超过 40 项截断为前 40 项 + `…共 N 项`；明细只服务人工排查，不做结构化。残余风险：无。
- **D4 图片引用解析共享化**：在 `summary-dir.ts` 导出 `listLocalImageRefs(md): string[]`（内部用局部正则/matchAll 规避 `/g` lastIndex 共享风险；仅返回相对引用，绝对/根相对/锚点/越界排除）。`knowledge-publisher` 私有 `extractImageUrls` 不动（行为不变，避免扩散改动）。
- **D5 非 completed 不写完整性字段**：检查范围与写入范围均为 completed；failed/pending/analyzing 记录前端显示"未检查"。备选（对 failed 也查 rawResponse 有无）超出需求原文，不做。
- **D6 重置语义（rebuild 需显式覆盖）**：`integrityStatus` 取值词表：`complete` / `missing` / NULL=未检查。重置分三条路径：
  1. **claim 路径**（retrigger / 自动总结）：`claimAiSummaryTask` 认领成功的 `ON CONFLICT DO UPDATE` 中将三条完整性字段置 NULL；
  2. **upsert 开始态路径**（非 claim 进入执行的其他写入）：`upsertAiSummaryTask` 以 `pending`/`analyzing` 状态写入时将三条字段置 NULL；
  3. **rebuild 路径**（不经 claim、无开始态 upsert，唯一写库为终态 `completed` upsert，`analysis-trigger.service.ts:828-835`）：新增数据方法 `resetAiSummaryTaskIntegrity(id)`，`runRebuild` 在写终态 upsert 前显式调用。
  新总结完成后未复查即显示"未检查"，与 D5 一致。备选（完成后自动触发单条检查）违反"仅手动触发"，排除。

## Execution Plan

### Phase 1 - 数据层：contract 演进 + 映射 + 重置语义

Status: completed
Targets: `packages/server/src/prisma/contract.prisma`、`database.service.ts`、`packages/server/tests/database/ai-summary-task.test.ts`（或新增 `ai-summary-integrity.test.ts`）
Prereqs: 无

- [x] `Add`: contract 中 `AiSummaryTask` 新增三列：`integrityStatus String? @map("integrity_status")`、`integrityDetail String? @map("integrity_detail")`、`integrityCheckedAt Timestamptz? @map("integrity_checked_at")`；执行 `prisma contract emit` → `prisma migration plan --name summary-integrity-check` → `prisma db migrate`（对测试库），确认迁移产物落盘并被 `db init`/`db migrate` 流程覆盖。
- [x] `Add`: `AiSummaryTaskRecord` 增加对应三个可选字段；`mapAiSummaryTaskRow` 与列表/详情查询透出新字段（含 timestamptz → ISO string 转换，与既有 `lastCompletedAt` 一致）。
- [x] `Add`: 批量/逐条写入方法 `updateAiSummaryTaskIntegrity(items: Array<{ id, status, detail, checkedAt }>)`（Prisma 门面内实现，不引入 raw SQL；写入不得触碰 `updated_at`，见 D2）。另加单条 `resetAiSummaryTaskIntegrity(id)`（rebuild 路径用，见 D6.3）。
- [x] `Add`: 重置语义（D6）：claim SQL `ON CONFLICT DO UPDATE` 置三列 NULL（D6.1）；`upsertAiSummaryTask` 以 `pending`/`analyzing` 写入时置 NULL（D6.2）；`runRebuild` 写终态 upsert 前调用 `resetAiSummaryTaskIntegrity(id)`（D6.3）。
- [x] `Proof`: server 数据层测试（需 `TEST_DATABASE_URL`）：新列映射往返、完整性写入（含 `updated_at` 不被改写）、重置语义（claim 后 NULL、analyzing upsert 后 NULL、**rebuild 链路后 NULL**）、列表透出。`pnpm --filter @bilibili-downloader/server test` 通过。

Exit Criteria:

- [x] 测试库 db verify 通过（marker 与 contract 一致）；启动哨兵不因新列误报（新列走 Prisma 演进，不属于 `ONE_OFF_MIGRATION_COLUMNS`，维持现状即正确——此判断在实现时复核）。
- [x] No owner-doc update required at this phase（owner doc 更新统一归 Phase 4 文档对齐复核）。
- [x] `docs/logs/` 记录条目。

### Phase 2 - 检查服务与 API

Status: completed
Targets: `packages/server/src/analysis/summary-dir.ts`（导出共享纯函数）、新增 `packages/server/src/analysis/summary-integrity.service.ts`、`analysis-task.controller.ts`、`analysis.module.ts`（provider 注册）
Prereqs: Phase 1

- [x] `Add`: `summary-dir.ts` 导出 `listLocalImageRefs(md: string): string[]`（D4）。
- [x] `Add`: `SummaryIntegrityService`：
  - `tryStart(): boolean`（内存互斥，模式同 `tryStartRebuild`）与 `isRunning()`；
  - `run(): Promise<void>`：查询全部 completed 记录（新增 `listCompletedAiSummaryTasks()` 数据方法，模式参考 `listAiSummaryTasksForKnowledgeBackfill`），逐条：`resolveSummaryOutputPath` 定位 → 读 md（失败=缺失，明细"总结文档不存在或不可读"）→ `listLocalImageRefs` → 对每个相对引用 `pathExists(join(dirname(md), ref))`（复用 `resolve`/`exists`；绝对引用跳过）→ 组装 D2/D3 结果 → `updateAiSummaryTaskIntegrity`（可按批聚合写入）→ 汇总日志（总数/完整/缺失）；`finally` 释放运行态。
  - `summary_output` 为空 → 缺失，明细"无输出文档记录"。
- [x] `Add`: 接口（`analysis-task.controller.ts`）：
  - `POST /api/summary-tasks/integrity-check`：运行中 409（"完整性检查进行中"）；否则启动异步 job（`void …run()`，catch 记日志），返回 `{ message: "完整性检查已开始" }`。无 completed 记录时照常启动并空转完成（前端行为一致）。
  - `GET /api/summary-tasks/integrity-check/status`：返回 `{ running: boolean }`。
- [x] `Proof`: 纯函数与判定路径的 vitest 单测（临时目录构造 md + 截图文件：全部存在=完整、md 缺失、截图缺失、无输出记录、绝对 URL 跳过、明细截断）；controller 层 409 互斥行为经测试或手动 demo 证据确认。

Exit Criteria:

- [x] 两个接口行为符合 AC1-AC4；无自动/定时调用路径（代码内确认）。
- [x] No owner-doc update required at this phase（接口表更新统一归 Phase 4 文档对齐复核）。
- [x] `docs/logs/` 记录条目。

### Phase 3 - 前端：类型 / API / 表格列 / 检查按钮

Status: completed
Targets: `packages/frontend/src/types/index.ts`、`packages/frontend/src/api/index.ts`、`packages/frontend/src/pages/AiSummaryTasks.tsx`
Prereqs: Phase 2

- [x] `Add`: `AiSummaryTaskEntry` 增加 `integrityStatus?: string | null`、`integrityDetail?: string | null`、`integrityCheckedAt?: string | null`；api 增 `startIntegrityCheck()`、`getIntegrityCheckStatus()`。
- [x] `Add`: 页面头部按钮"检查本地文件"：点击 → `startIntegrityCheck`（409 时提示）→ 以 2s 轮询 `status` 直至 `running=false` → `refetch` 列表；运行中按钮 loading/disabled（AC2）；沿用页面既有错误提示条模式。同步更新页面副标题文案，说明检查期间存在 job 状态轮询例外（现行文案"不做自动刷新"指任务列表数据，需消除表述张力）。
- [x] `Add`: 表格新增"本地文件"列（参与 `useResizableColumns` 可调宽，非 actions）：Tag 完整（green）/ 缺失（red）/ 未检查（default，含非 completed 与未检查过的记录，映射 D6 词表：`complete`/`missing`/NULL）；缺失时以 tooltip 展示 `integrityDetail` 与检查时间（对齐 `knowledgeError` 的 tooltip 呈现先例，`AiSummaryTasks.tsx:369-373`）。
- [x] `Proof`: `pnpm --filter @bilibili-downloader/frontend typecheck` 通过；`docs/testing/09-07-summary-integrity-check-testing.md` 手动方向逐项演示。

Exit Criteria:

- [x] AC5 行为落地（列展示、tooltip 明细、检查后刷新可见）。
- [x] `docs/testing/` 文档覆盖本需求全部观察态。
- [x] `docs/logs/` 记录条目。

### Phase 4 - 收尾验证与文档对齐

Status: completed
Targets: 全仓
Prereqs: Phase 1-3

- [x] `Proof`: `pnpm typecheck`、`pnpm build`、`pnpm --filter @bilibili-downloader/server test`（含测试库）全部通过。
- [x] `Proof`: 演进流程端到端确认——本地测试库 `db migrate` 后 `db verify` 通过；确认部署链路（镜像内 `prisma db init`）对"已签名库 + 新迁移"的行为与 P4 既有结论一致（引用 `prisma/baseline/README.md`），如有偏差补记录。
- [x] `Add`: 文档对齐复核（owner doc 更新的单一归属点）：`app-overview.md`——接口表新增 `POST /api/summary-tasks/integrity-check`（含 409 语义）与 `GET /api/summary-tasks/integrity-check/status` 两行、数据层小节补三条完整性列语义（含取值词表 `complete`/`missing`/NULL）、markdown 接口描述如涉及则同步；`codebase-map.md` Server 行一句话补充 integrity 服务；`docs/context/project-context.md` Active Work 收尾时更新。
- [x] Proof: 独立 closure audit（independent subagent，fresh context，2026-09-07：PASS-with-notes，补填清单 6 项已完成，允许闭合提交）。

Exit Criteria:

- [x] 全部验证命令通过且有留痕。
- [x] `docs/testing/09-07-summary-integrity-check-testing.md` 每条方向确认通过或显式裁决。
- [x] `docs/logs/` 汇总条目。

## Plan Audit

- Status: passed（2026-09-07，independent subagent，两轮：首轮 FAIL 1 major + 4 minor + 2 note → 按意见修订 D6/D2/词表/文档归属/模糊措辞/副标题/互斥粒度 → 复核 PASS-with-notes，确认无新引入矛盾，允许进入实施）
- Reviewer / Agent: independent subagent（fresh context，任务 id `ses_f8506d4fcffekrx1jv3y9QpYX1`）
- Evidence: 首轮审计报告（FAIL：D6 rebuild 重置机制与 live 代码矛盾等 7 项）与复核报告（PASS-with-notes：7 项全部正确修订；遗留 note——testing 文档 T5 需补 rebuild 重置观察行，已随审计完成补充）记录于本文件与对应任务会话；复核确认 AC1-AC7 覆盖完整、路由无冲突、不触碰 protected area、哨兵判定正确。

## Closure Gates

- [x] in-scope behavior is complete（AC1-AC7 全部有证据）
- [x] relevant docs are aligned（app-overview / codebase-map / project-context）
- [x] verification has run（`pnpm typecheck`、`pnpm build`、server 测试、演进 drill 复核）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（independent subagent，fresh context，非 cold-replay）

## Deferred But Adjudicated

（无——范围内无降级项；需求原文未含的扩展如"单任务检查""视频文件检查"已写入需求非目标，不属于本计划裁决项。）

## Closure

Status Note: 计划全部 Phase 完成。AC1-AC7 均有证据（server 测试 72/72、服务级端到端、真实服务端 demo、演进 drill 与部署链路实证）；testing 文档全部方向确认通过或显式裁决（前端交互观感待用户部署确认）；owner doc 三处对齐；plan audit 与 closure audit 均为独立 fresh-context subagent。closure audit 提出的 6 项补填（project-context 收尾态、T4 措辞、fixed:"right" 移除记录、剩余 checkbox、Closure 本节）均已完成。

Closure Audit Evidence:

- Reviewer / Agent: independent subagent（fresh context，任务 id `ses_f84a9561cffeI8OhbcfpCH5s74`）
- Evidence: 2026-09-07 closure audit 报告（PASS-with-notes，结论"允许闭合提交: yes"；核对 AC 覆盖、Phase checkbox 与真实 diff 一致、重置三路径/`updated_at` 不改写/路由/前端实现抽查属实、无范围外改动）记录于对应任务会话。




