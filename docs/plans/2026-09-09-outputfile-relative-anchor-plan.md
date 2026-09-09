# 2026-09-09 task.outputFile / analysis_sub_task.output_file 相对锚点改造计划

> Plan Status: completed
> Last Reviewed: 2026-09-09
> Source: `docs/requirements/2026-09-09-outputfile-relative-anchor.md`（用户直接请求 + owner doc 既有约定缺口）
> Related: `docs/plans/2026-09-04-summary-output-relative-path-plan.md`（先例）、`docs/plans/2026-09-04-output-dir-centralization-plan.md`
> Audit: required
> Testing: `docs/testing/2026/09-09-outputfile-relative-anchor-testing.md`

## Current Baseline

- `docs/design/app-overview.md`（L46）已声明"DB 相对路径锚点约定（无例外）"，点名 `task.outputFile`，但实现未覆盖。
- 仅 `ai_summary_task.summary_output` 已落实：写侧 `database.service.ts:1130-1133` 用 `toRelativeSummaryOutputPath`（`analysis/summary-dir.ts:21-40`），读侧各消费点用 `resolveSummaryOutputPath`（`summary-dir.ts:50-58`）；一次性迁移脚本先例 `packages/server/scripts/one-off-migrations/003-summary-output-relative.sql`。
- `task.outputFile` 写入链：`download.service.ts` `executeTask` 计算绝对路径（:500-510，`join(DOWNLOAD_ROOT, [sanitizeOutputPath(outputPath),] fileName)`）→ 成功后 `updateTaskStatus`（:571-579）原样落库（`database.service.ts:343` 无转换）。跳过下载分支（文件已存在）走同一 `request.outputFile`，无需单独处理。
- `analysis_sub_task.output_file` 写入链：低清下载结果经 `analysis-trigger.service.ts`（:108-114 附近与 `insertAnalysisSubTask`/`updateAnalysisSubTaskStatus` 落库，`database.service.ts:719-798`）原样落库。
- 读侧磁盘消费点（全部需 resolve）：
  - `analysis-trigger.service.ts` :384（highResPath）、:394（低清子任务 outputFile）、:586-587（重载文件磁盘校验）、:799-807（重建）
  - `analysis-video-resolver.ts` :209-226、:228-237、:290-316
  - `summary-repair.service.ts` :177-184
  - `download.service.ts` `fileExists`（:665-667）为透传，不在此转换
- `PathsService.DOWNLOAD_ROOT`（`paths.service.ts:24-26`）已被上述三个 analysis 服务注入（analysis-video-resolver 待确认注入情况）。
- 前端仅展示原始值（`Downloading.tsx:304-309`、`types/index.ts:161`），无需改代码。
- 测试现状：`server/tests/database/task.test.ts` 已用相对值断言（`out.mp4`）；`summary-integrity.test.ts` 覆盖 `resolveSummaryOutputPath` 行为。

## Goals

- `task.outputFile`、`analysis_sub_task.output_file` 新写入值统一为相对 `DOWNLOAD_ROOT` 的 POSIX 相对路径；读侧磁盘消费全部经锚点解析，兼容遗留绝对值。
- 存量数据提供幂等一次性迁移脚本（模式同 003）。
- `summary_output` 逻辑不回归。

## Non-Goals

- 不改 DB schema、不做 ORM/迁移框架变更。
- 不改文件落盘位置（磁盘上仍是绝对路径写入，仅 DB 存储值变相对）。
- 不改前端代码。
- 不迁移历史 `summary_output`（已完成）。
- 不处理"画质回退致文件名漂移"问题（另案，见 2026-09-08 审计 P5）。

## Infrastructure And Config Prereqs

- 无新增 env/端口/密钥；依赖现有 `OUTPUT_DIR` → `DOWNLOAD_ROOT`。
- 数据迁移回滚策略：004 脚本只改两表指定列且幂等；回滚 = 手工按脚本同根前缀反向拼接（与 003 同一风险等级，可接受；脚本头部注释说明"停服执行"）。

## Execution Plan

### Phase 1 - 锚点 helpers 泛化

Status: completed
Targets: `packages/server/src/paths/path-anchor.ts`（新建）、`packages/server/src/analysis/summary-dir.ts`

- Item Types: `Decision | Add`

- [x] Add: 新建 `paths/path-anchor.ts`，提供通用纯函数 `toRelativeDownloadRootPath(value, downloadRoot)` 与 `resolveFromDownloadRoot(value, downloadRoot)`，逻辑即现 `toRelativeSummaryOutputPath`/`resolveSummaryOutputPath`（含 Windows 盘符判定、POSIX 分隔符归一、根外返回 null/透传）。
- [x] Decision: summary-dir 的两个导出改为委托新模块（保留原导出名与行为，既有调用零改动），避免逻辑双份漂移。备选：保留双份实现（否决——漂移风险）；将泛化函数直接放 summary-dir（否决——归属错误，路径锚点非摘要域私有）。残余风险：无。
- [x] Proof: 既有 `summary-integrity.test.ts` 及 typecheck 通过，证明委托未改行为。

Exit Criteria:

- [x] 新模块导出可被 paths/analysis/database 层复用，无循环依赖（path-anchor 只依赖 node:path）
- [x] No owner-doc update required（owner doc 已声明目标约定）
- [x] `docs/logs/` 更新

### Phase 2 - 写侧相对化

Status: completed
Targets: `packages/server/src/database/database.service.ts`

- Item Types: `Add`
- Prereqs: Phase 1

- [x] Add: `updateTaskStatus`（:343 处）对 `fields.outputFile` 应用 `toRelativeDownloadRootPath(fields.outputFile, this.paths.DOWNLOAD_ROOT) ?? fields.outputFile`（null 时保留原值——根外/遗留值不改写）。
- [x] Add: `insertAnalysisSubTask`（:726）与 `updateAnalysisSubTaskStatus`（:771）对 `outputFile` 同规则处理。
- [x] Decision: `insertTask`（database.service.ts:268）是 `task.outputFile` 的第三个写入点，但无生产调用方传该字段——保持原样不改写，此处显式记录（plan audit F/m 项相关）。若未来有调用方传入，须走同规则。残余风险：无。
- [x] Proof: server 数据层测试新增用例：内存/测试库写入"绝对路径位于临时根下"→ 读回为相对值；根外值与相对值保持原样。

Exit Criteria:

- [x] 新任务与低清子任务落库值为相对路径（AC1/AC2）
- [x] 相关测试通过
- [x] `docs/logs/` 更新

### Phase 3 - 读侧解析

Status: completed
Targets: `packages/server/src/analysis/analysis-trigger.service.ts`、`analysis-video-resolver.ts`、`summary-repair.service.ts`

- Item Types: `Add`
- Prereqs: Phase 1

- [x] Add: 各消费点在磁盘访问/传参前经 `resolveFromDownloadRoot(value, this.paths.DOWNLOAD_ROOT)`：
  - trigger :384（highResPath）、:394（低清子任务 outputFile，**在调用 resolver 与后续清理 `startsWith(llmVideoDir)`（:537）之前先 resolve**，顺序为硬约束）、:415-418（screenshotVideoPath 派生）、:586-587（重载文件磁盘校验）、:799-807（重建）
  - resolver 三处存在性校验 + **返回值 :226/:316 也必须 resolve 后再返回**（返回值即下游磁盘路径）
  - summary-repair :177-184
  - resolver 若未注入 PathsService 则注入。
- [x] Proof: server 数据层或模块测试覆盖"相对值解析后命中文件、绝对值透传"分支；typecheck/build 通过。

Exit Criteria:

- [x] 相对值下游行为与旧绝对路径等价（AC3）
- [x] 遗留绝对值不受影响
- [x] `docs/logs/` 更新

### Phase 4 - 存量迁移脚本

Status: completed
Targets: `packages/server/scripts/one-off-migrations/004-outputfile-relative.sql`、`packages/server/scripts/one-off-migrations/README.md`

- Item Types: `Add`
- Prereqs: Phase 2（约定一致后再迁移）

- [x] Add: 004 脚本（模式同 003）：真实列名为 `task."outputFile"`（Prisma 无 @map，camelCase 带引号，contract.prisma:65；migration 脚本 migrate-sqlite-to-postgres.mjs:40 同）与 `analysis_sub_task.output_file`（contract.prisma:88）。对两列中位于指定根之下的绝对值改写为相对值；幂等；头部注释含用法、停服要求、根字面量修改说明。
- [x] Add: README/注释注明：`migrate-sqlite-to-postgres.mjs`（:33-55）按原样复制两列，重跑迁移后需重跑 004。
- [x] Proof: 脚本评审 + 在测试库（如有）或语法评审确认幂等性；真实环境执行由用户操作（脚本内自校验 UPDATE 计数）。

Exit Criteria:

- [x] 脚本落库且 README 登记
- [x] 读侧容错对未迁移值有效（Phase 3 已覆盖）
- [x] `docs/logs/` 更新

### Phase 5 - 验证与收尾

Status: completed
Targets: 全仓

- Item Types: `Proof`

- [x] Proof: `pnpm typecheck`、`pnpm build`、`pnpm --filter @bilibili-downloader/server test` 全通过（测试库不可用时按 testing 文档裁决并记录）。
- [x] Add: `docs/logs/2026-09-09-outputfile-relative-anchor.md` 记录实现与验证证据。
- [x] Proof: closure audit（独立 subagent）通过并留档 `docs/audits/`。

Exit Criteria:

- [x] 全部验证命令通过或显式裁决
- [x] `docs/testing/2026/09-09-outputfile-relative-anchor-testing.md` 各方向确认
- [x] closure audit 证据落库

## Plan Audit

- Status: passed（PASS-with-notes，笔记已并入计划：列名 `task."outputFile"`、insertTask 第三写入点记录、trigger :415-418/:537 顺序约束、resolver 返回值 resolve、migrate 脚本重跑需重跑 004）
- Reviewer / Agent: subagent（独立审计）
- Evidence: `docs/audits/2026-09-09-plan-audit-outputfile-relative-anchor.md`

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned（app-overview L46 约定复核，如需补充"已落实"注记则更新）
- [x] verification has run（typecheck / build / server 数据层测试）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（subagent，PASS-with-notes）- [x] closure evidence exists in files

## Deferred But Adjudicated

（无）

## Closure

Status Note: 五个 Phase 全部落地：写侧三个持久化点相对化、读侧全部磁盘消费点经锚点解析（含 resolver 返回值与 trigger 清理顺序约束）、004 幂等迁移脚本就绪、summary_output 委托无回归；`pnpm typecheck`/`pnpm build`/server 测试（11 文件 81 用例）全绿并由 closure audit 独立复跑。真实环境 004 执行与部署后前端展示目测留用户操作（见 testing 文档裁决）。

Closure Audit Evidence:

- Reviewer / Agent: subagent（独立 closure audit，PASS-with-notes）
- Evidence: `docs/audits/2026-09-09-closure-audit-outputfile-relative-anchor.md`（audit 独立复跑 typecheck/build/server 测试全部通过；P 级笔记：path-anchor `..` 前缀目录名边界逐字继承旧实现无回归、owner doc 可选补名 analysis_sub_task.output_file、taskCache 内 outputFile 死数据）

Follow-up:

- （无阻塞项；如重跑 `migrate-sqlite-to-postgres.mjs`，需重跑 004——已写入脚本 README）
