# Closure Audit: task.outputFile / analysis_sub_task.output_file 相对锚点改造

日期: 2026-09-09
类型: closure audit（independent auditor）
对象: `docs/plans/2026-09-09-outputfile-relative-anchor-plan.md`
需求: `docs/requirements/2026-09-09-outputfile-relative-anchor.md`
结论: **PASS-with-notes**（全部闭环门满足，验证命令独立复跑通过；无 F/m 级阻塞项）

## 冷回放：计划退出条件逐项核验

| Phase | 项 | 判定 | 证据（file:line） |
| --- | --- | --- | --- |
| 1 | path-anchor 新模块 | ✅ | `packages/server/src/paths/path-anchor.ts:11-13`（盘符判定 `isAbsolute` + 正则，POSIX 上 `C:/x` 也能识别）、:20-39（toRelative：空值/非绝对→null，rel==""、跨盘 isAbsolute(rel)、`..` 越界→null，POSIX 归一）、:49-60（resolve：空→undefined、绝对透传、相对 join）；仅依赖 node:path，无循环依赖 |
| 1 | summary-dir 委托行为不变 | ✅ | `analysis/summary-dir.ts:21-26/:32-37` 委托；对照 `git diff` 旧实现逐条件等价（`!value`→null / 非 abs→null / `rel==""`·isAbsolute·`..`→null / `replaceAll("\\","/")`；resolve 旧 `!value \|\| isAbsolute → value` 等价新 `?? value` 回退）。summary-integrity 测试全绿 |
| 2 | updateTaskStatus 相对化 | ✅ | `database/database.service.ts:338-349`（`toRelativeDownloadRootPath(...) ?? fields.outputFile`）；日志明细用持久化值 :379 |
| 2 | insertAnalysisSubTask / updateAnalysisSubTaskStatus | ✅ | :726-737（insert，空值走 `?? null`）、:778-789（update）；日志用持久化值 :803 |
| 2 | insertTask 保持原样 | ✅ | :268 未改；唯一生产调用方 `download/download.service.ts:370-383` 不传 outputFile（计划已记录） |
| 2 | summary_output 写侧切换到新 import | ✅ | :1147-1150 改用 `toRelativeDownloadRootPath`，语义逐条件等价（见上） |
| 3 | trigger 读侧解析 | ✅ | `analysis/analysis-trigger.service.ts:385-388`（highResPath）、:396-402（preferredLowResPath，先 resolve 再传 resolver，保证 :544 `startsWith(this.llmVideoDir)` 临时清理不回归——resolve 后路径仍在 `DOWNLOAD_ROOT/.analysis-llm` 下，`paths.service.ts:41-43`）、:422-425（screenshotVideoPath 派生自已 resolve 的 highResPath）、:592-595（resolveTaskForAnalysis 磁盘校验）、:810-813（runRebuild，videoPath/screenshotVideoPath :820-821 均为 resolved 值） |
| 3 | resolver 读侧解析 + 返回值 | ✅ | `analysis/analysis-video-resolver.ts:57`（PathsService 注入）、:211-219（completedTask 存在性校验用 resolved）、:234（返回 resolved）、:314-317 + :330（同步重下返回 resolved）；触发侧传参已是 resolved，resolver :74-84 原样返回成立 |
| 3 | summary-repair 读侧解析 | ✅ | `analysis/summary-repair.service.ts:178-193`（task 与 completedTask 两个分支均 resolve 后再 fileExists/赋值） |
| 3 | 全 src 无遗漏磁盘消费点 | ✅ | 全仓 grep `outputFile/output_file`：其余命中均为写侧传参（trigger :109/:115→DB 层转换）、日志明细、`server-log.util.ts` 脱敏键、DB 行映射（database.service :440/:834 原样返回 API，符合需求 3）。`download.service.ts:156/:565` taskCache 的 outputFile 无磁盘消费方（列表/详情 API 走 DB：`download.controller.ts:141→:678→db.listTasksPaginated`、`:158→:687→db.getTaskById`）；`scripts/seed.mjs` 无 outputFile；`scripts/test-screenshot-no-cookie.mjs:67-80` 消费的是截图产物（运行时绝对路径），与 DB 字段无关；前端仅展示（`Downloading.tsx:304-309`） |
| 4 | 004 脚本列名/幂等 | ✅ | `scripts/one-off-migrations/004-outputfile-relative.sql`：task 用带引号 `"outputFile"`（:32/:34/:36/:40），与 `prisma/contract.prisma:68`（无 @map）一致；subtask 用 `output_file`（:57/:59/:61/:65），与 `contract.prisma:91`（@map("output_file")）一致；幂等模式与 003 逐行同构（lower 比较 + 保 case substring + btrim，重复执行命中 0 行）；README 已登记含"重跑 migrate-sqlite-to-postgres.mjs 后需重跑 004"（README diff 确认） |
| 5 | 测试新增 | ✅ | `tests/paths/path-anchor.test.ts`（6 用例：POSIX 相对化、空/相对/根外/根本身 null、undefined 空、join 解析、绝对透传、roundtrip）；`tests/database/task.test.ts`（根下绝对→`sub/T-BV1-1-q80.mp4`、相对/根外原样）；`tests/database/analysis-sub-task.test.ts`（`.analysis-llm/low.mp4` 相对化、相对值保留）——断言与声明一致 |
| 5 | 验证命令独立复跑 | ✅ | 本次审计独立执行：`pnpm typecheck` 通过；`pnpm build` 通过（含 server nest build）；`pnpm --filter @bilibili-downloader/server test`（TEST_DATABASE_URL=postgres://…@localhost:55432/bdl_test）→ **11 文件 / 81 用例全部通过**，与日志/testing 文档声称一致 |

## AC 对照

- AC1/AC2（写侧相对化）：task.test / analysis-sub-task.test 直接断言 ✅
- AC3（读侧解析等价）：path-anchor roundtrip 语义 + 各消费点经同一 helper（逐一核对见上表）✅
- AC4（迁移幂等 + 读侧容错）：004 与 003 同构幂等；读侧绝对值透传由 resolveFromDownloadRoot + path-anchor.test 覆盖；真实环境执行为运维手工步骤，testing 文档已显式裁决（与 003 同先例）✅
- AC5（验证不回归）：三条命令独立复跑全绿 ✅

## 发现

| # | 严重度 | 发现 | 处置 |
| --- | --- | --- | --- |
| 1 | P | `toRelativeDownloadRootPath` 的 `rel.startsWith("..")`（path-anchor.ts:33）会把根下名字以 `..` 开头的目录（如 `..foo/`）误判为根外不改写——该条件逐字继承自旧 summary-dir 实现，无行为回归；病态边界，现实文件名不出现 | 无需修改，记录在案 |
| 2 | P | owner doc `app-overview.md:46` 与 `paths.service.ts:11` 的约定举例仍为"`task.outputFile`、`ai_summary_task.summary_output` 等"，未显式点名 `analysis_sub_task.output_file`；计划 gate"如需补充注记则更新"按现状未触发（"等/无例外"已覆盖） | 可选补名，不阻塞 |
| 3 | P | taskCache 内 `cached.outputFile`（download.service.ts:565）在进程内保存运行时绝对值、与 DB 相对值并存，但当前无任何消费方读取该缓存字段（列表/详情 API 均走 DB），纯死数据 | 无需修改；未来若让列表 API 改走 taskCache，须同步相对化 |
| 4 | m | 计划收尾簿记未完成：Closure Gates 最后一条"[x] closure audit was independent"仍标记"进行中"，Closure Status Note 为"（待闭）"——本报告即为该 gate 的证据，需回填打勾并写 Closure 状态（另 testing 文档 :47 "（ adjudicated" 有一处多余空格） | 实现方按本报告回填计划/测试文档 |

## 结论

Verdict: PASS-with-notes

实现与计划五阶段逐项一致、无未兑现声明；写侧三写点 + summary_output 切换、读侧全部磁盘消费点（含计划审计 m 级补充的 screenshotVideoPath 派生与 resolver 返回值站点）均落地并经独立代码核对；004 脚本列名/幂等性对照 Prisma contract 与 003 先例核实无误；三条验证命令由本次审计独立复跑全部通过。发现均为 P 级注记与一项计划簿记回填（m），无阻塞项。

**回填要求（不阻塞）：** 依据本报告将计划 Closure Gates 最后一条打勾、补 Closure Status Note；可顺带修正 testing 文档空格笔误。
