# Closure Audit: AI 总结本地文件修复脚本

日期: 2026-09-08
类型: closure audit（independent subagent）
对象: `docs/plans/2026-09-08-summary-repair-script-plan.md` /
`packages/server/scripts/repair-summary-files.mjs`
结论: **pass-with-conditions**（2 项文档级修正已回填至实现日志）

## 计划审计条件 P1-P9 逐条核验（全部落地）

| # | 判定 | 证据 |
| --- | --- | --- |
| P1 | ✅ | 脚本 :189-201 执行后重取 getTaskById，校验 success + outputFile，失败 throw → catch 记 failed |
| P2 | ✅ | 启动检 FfmpegScreenshot.isAvailable() :105-109；逐 task 门 :130-134；FfmpegMerger 懒检 :171-176（补上 DownloadService.onModuleInit 仅 log 不 throw 的缺口） |
| P3 | ✅ | 计划头部引用的审计记录真实存在且结论一致 |
| P4 | ✅ | :160-168 先 findCompletedTaskByBvidAndCid 复用，仍无才重下 |
| P5 | ✅ | :195-201 重下后重取 refreshed.outputFile；画质降级语义已记录 |
| P6 | ✅ | 报告用 result.summaryPath，不假设文件名不变；孤儿 md 已记录 |
| P7 | ✅ | :244-248 按 result.emptySummary 分 repaired-empty |
| P8 | ✅ | 脚本头注 Node ≥22.9 / cd packages/server / --env-file-if-exists |
| P9 | ✅ | node --check、6 个 dist 导入路径、adapters/ffmpeg 具名导出均独立复验通过 |

## 逻辑排查

- 无资源泄漏：db.onApplicationShutdown 在 finally；DownloadService 无 shutdown 需求
- taskCache 校验满足：同实例 createTask(:385-390) → executeTask(:411-443) 校验的是
  cache 条目（status=Created），传入 record 仅提供业务字段
- upsert 对齐 runRebuild 终态语义：resetIntegrity 先行；errorMessage ""→null；
  rawResponse/modelName 未传保留既有值（无误覆写）
- resolveSummaryDir 复刻与 analysis-trigger.service.ts:624-675 逐行一致

## 已回填的文档级修正

1. rawResponse 非法 JSON = failed 的偏差及依据 → 实现日志"遗留"节
2. sourceTaskId 写 latest task id（非新下载任务 id）的语义选择 → 实现日志"遗留"节

## 提示级（不阻塞）

- ffmpeg 不可用时 rawResponse 为空的 task 被记 failed 而非 skipped（检查顺序）
- repaired 明细在逐条 console 输出中，汇总仅计数
