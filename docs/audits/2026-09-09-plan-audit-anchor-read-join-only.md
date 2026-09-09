# Plan Audit: 读侧路径锚点移除绝对值透传

日期: 2026-09-09
类型: plan audit（independent subagent）
对象: `docs/plans/2026-09-09-anchor-read-join-only-plan.md`
结论: **pass-with-conditions**

## 审计核验（全部一致）

- 现实现 `resolveFromDownloadRoot`（path-anchor.ts:49-59）确为 `isAbsoluteAnchorPath`（:56）命中即透传，否则 join(:59)；`isAbsoluteAnchorPath`（:11-13）POSIX `/` + win32 盘符双语义；写侧 `toRelativeDownloadRootPath`（:20-39）依赖同一判定，计划保留写侧正确
- 全部 `resolveFromDownloadRoot` 调用点输入来源均为 DB 记录，无一传入进程内绝对值：
  - download.service.ts:453 — `findCompletedTaskByBvidAndCid`（DB）:450-451
  - analysis-trigger.service.ts:385（`effectiveTask.outputFile`，resolveTaskForAnalysis 全程 `db.getTaskById` :578/:355）、:398（`lowResSubTask.outputFile`，DB）、:592（DB completedTask :587-589）、:810（DB findLatestTaskByBvidAndCid :803）
  - analysis-video-resolver.ts:211（DB completedTask :209-210）、:319（DB finalRecord :300，`downloadService.getTaskById` → `db.getTaskById` :748）
  - summary-repair.service.ts:178/:187（DB task/completedTask :172/:183）
  - summary-dir.ts:36 委托（`?? value` 空值回退），消费方全部 DB 来源：analysis-task.controller.ts:211/:406、summary-integrity.service.ts:105、summary-repair.service.ts:134、knowledge-backfill.service.ts:117
  - API 直传绝对路径（analysis.controller.ts:523-543 校验）进 `AnalysisInput` 后直接使用，不经 resolveFromDownloadRoot，不受影响
- resolver :319：`rawOutputFile` 来自 DB；写侧 updateTaskStatus 已统一转相对（database.service.ts:338-343），且 outputDir === DOWNLOAD_ROOT（download.service.ts:98）→ 新任务 outputFile 必在根下、必被相对化，join 语义正确还原。`?? rawOutputFile` 仅在空值时触发（:301 已先校验 outputFile 非空），无回归
- 测试影响：win32 下 `path.join` 对绝对形态段**不重置**（`join(root, "/tmp/x.mp4")` → `root\tmp\x.mp4`；`join(root, "C:\\dl\\...")` → `root\C:\dl\...`），计划"一律 join"断言方向正确；`:50-57` roundtrip 中 `rel` 为 POSIX 相对值，join 正常归一化还原 abs，写侧未改故仍有效；`resolveSummaryOutputPath("", root)` 空值语义由 `value ? join : undefined` + `?? value` 保留（ai-summary-task.test.ts:342 不受影响）
- 透传语义 grep："透传"仅存于 path-anchor.ts:5/:47 与 summary-dir.ts:30 注释；server src 其余 `isAbsolute`（analysis.controller.ts:523-543、summary-dir.ts:152）与读侧锚点无关，无其他隐藏透传分支

## 审计条件（必须并入计划/实现）

| # | 问题 | 证据 | 处置 |
| --- | --- | --- | --- |
| M1 | 计划注释同步范围遗漏 `app-overview.md:74` —— 该行亦含"2026-09-04 前遗留绝对值原样容错读取"表述，仅改 :46 锚点约定行会留下与实现矛盾的 stale 表述，Closure Gate"docs aligned / text consistency"无法诚实通过 | docs/design/app-overview.md:74 | 计划 Fix 项 3 扩展为同时更新 :74（改为"遗留绝对值须清理，读侧恒 join，不再容错"） |
| m1 | 计划 Baseline :17 断言 `paths.service.ts` 头注释含"遗留绝对路径值原样容错透传"——实际该注释（paths.service.ts:10-16）为中性表述、不含透传字样，同步项基于错误前提 | packages/server/src/paths/paths.service.ts:10-16 | 修正 Baseline 表述；paths.service 注释可选择性补一句"读侧恒 join"，非强制 |
| m2 | 消费方清单遗漏 `knowledge-backfill.service.ts:117`（resolveSummaryOutputPath，DB 来源，无行为风险，但 Baseline/Exit 核对时应覆盖） | packages/server/src/knowledge/knowledge-backfill.service.ts:117 | 并入 Baseline 消费方清单 |
| P1 | 残余不对称：写侧注释承诺"根外/遗留绝对值原样保留"（database.service.ts:338/:746/:798），读侧改恒 join 后，此类值（若未来再入库）将被**静默拼接成错误路径**而非失败——计划 Decision 残余风险已述，但建议日志级确认：读侧结果不存在时消费方均已走存在性检查（fileExists），失败路径为显式 warn/throw，可接受 | database.service.ts:338-343; 各调用点 fileExists 前置 | 提示级：实现日志中记录一次该残余语义即可，无需改写侧 |

## Verdict 判定依据

- 计划范围与真实代码基线一致（函数行为、调用点数量与来源全部核实）
- 无隐藏依赖：无任何调用点合法依赖透传分支；API 绝对路径链路不经该函数
- 证明策略完备（typecheck/build/server 测试 + 行为断言更新），测试断言在 win32 join 语义下成立
- Closure gates 诚实；M1 为唯一阻断文本一致性的遗漏，修正后即可开工

## 结论

**pass-with-conditions**：并入 M1（必须）与 m1/m2（应并入）后可进入实现；P1 提示级。
