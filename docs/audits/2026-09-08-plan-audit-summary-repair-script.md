# Plan Audit: AI 总结本地文件修复脚本

日期: 2026-09-08
类型: plan audit（independent subagent）
对象: `docs/plans/2026-09-08-summary-repair-script-plan.md`
结论: **pass-with-conditions**

## 审计核验（全部一致）

- `rebuild` analysis-engine.ts:220、`AnalysisInput` :36-60；无参构造安全（:97-106），
  rebuild→buildOutput 不触发 `ensureLlmClient`（:108-116），无 resolver 时回退
  `input.videoPath`（:479-481）
- `runRebuild` analysis-trigger.service.ts:760-883、`resolveSummaryDir` :624-675
- `listCompletedAiSummaryTasks` database.service.ts:937、`upsertAiSummaryTask` :1101
  （rawResponse 未传保留既有值 :1122-1125；summaryOutput 自动转相对 :1131-1134；
  errorMessage `"" ?? null` → null :1144/:1159）、`resetAiSummaryTaskIntegrity` :966、
  `findLatestTaskByBvidAndCid` :662、`findCompletedTaskByBvidAndCid` :676、
  `getTaskById` :547
- `createTask` download.service.ts:368（写 taskCache :385-390，同实例 create→execute
  可通过 :411-443 校验）、`executeTask` :409；`updateTaskStatus` 写回 outputFile
  :571-579，绝对路径 :508-510
- COS 绝对 URL 图片引用不会误判缺失（summary-dir.ts:63-69、229-242）；
  cid BigInt/number 无泄漏（mapAiSummaryTaskRow :849 转 Number）
- seed.mjs 直连风格、`new PathsService()` 无依赖可用

## 审计条件（必须并入计划/实现）

| # | 问题 | 证据 | 处置 |
| --- | --- | --- | --- |
| P1 | executeTask 失败吞错不抛异常，脚本必须执行后复查 DB 状态 | download.service.ts:562-611 | 已并入计划步骤 3 |
| P2 | ffmpeg 缺失时截图逐段失败仍写 md（假修复）；重下还需 FfmpegMerger | analysis-engine.ts:358-417,447；ffmpeg-merger.ts:19 | 已并入计划步骤 0 预检 |
| P3 | 计划头部状态/Audit 声明须与 docs/audits/ 实际记录一致 | — | 本文件即证据，计划已回填 |
| P4 | findLatestTaskByBvidAndCid 不限状态，failed 最新任务会误触发重下 | database.service.ts:662-687 | 已并入计划步骤 3（先查 completed） |
| P5 | 画质回退致文件名漂移；重下后必须重新 fetch outputFile | download.service.ts:475-510 | 已并入计划步骤 3 |
| P6 | rebuild 覆写 md，title 变化时旧名 md 成孤儿 | analysis-engine.ts:443-447 | 提示级：报告不假设 md 文件名不变 |
| P7 | rawResponse 全部段无效时写 emptySummary 计为 repaired | analysis-engine.ts:530-544 | 报告区分 repaired-empty |
| P8 | Node ≥22.9、cwd/OUTPUT_DIR 运行前提 | paths.service.ts:24-28 | 已并入计划验证节 |
| P9 | 需 dist 导入冒烟，防 dist 漂移 | — | 已并入计划验证节 |
