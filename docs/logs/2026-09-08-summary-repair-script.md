# 2026-09-08 AI 总结本地文件修复（脚本版 → 已被 API 版取代）

> 状态更新（同日）：本日志所述一次性脚本
> `packages/server/scripts/repair-summary-files.mjs` 已被 API 化实现取代并删除，
> 见 `docs/logs/2026-09-08-summary-repair-api.md` 与
> `docs/plans/2026-09-08-summary-repair-api-plan.md`。以下为历史记录。

## 背景

下载目录中的 AI 总结 md/截图与云端 `ai_summary_task` 表无法一一匹配。
用户要求一次性修复脚本：以 DB 为唯一真源，找出缺文件的 completed task，
用 rawResponse 重建 md + 截图；视频缺失时先复用旧 success 文件、否则按旧任务
画质/目录/命名重下。

## 实现

- 计划: `docs/plans/2026-09-08-summary-repair-script-plan.md`
  （subagent 计划审计 pass-with-conditions，9 条处置见
  `docs/audits/2026-09-08-plan-audit-summary-repair-script.md`）
- 脚本: `packages/server/scripts/repair-summary-files.mjs`
- 运行: `cd packages/server && node --env-file-if-exists=.env scripts/repair-summary-files.mjs`

### 用户决策

1. rawResponse 为空 → 跳过并报告
2. 视频缺失 → 原画质重下，目录/命名与旧任务一致（createTask+executeTask，
   执行后复查 `getTaskById` 的 success 状态与 outputFile —— 审计 P1）
3. 只修本地 + `ai_summary_task`，不重新发布 COS（不触发 knowledgePublisher）
4. 无 dry-run

### 关键实现点

- 缺失判定对齐 summary-integrity.service.ts：summaryOutput 为空/md 不可读/
  listLocalImageRefs 任一相对截图缺失
- `resolveSummaryDir` 复刻 analysis-trigger.service.ts:624-675（含已有目录复用）
- 启动预检 FfmpegScreenshot.isAvailable()；懒初始化 DownloadService 时另检
  FfmpegMerger.isAvailable()（审计 P2）
- 重下前先 `findCompletedTaskByBvidAndCid` 复用旧 success 文件（审计 P4）
- 报告四态：repaired / repaired-empty / skipped / failed（审计 P7）
- `DatabaseService` 无参构造（不能把 PathsService 传给第一个 prisma 参数）

## 验证

- `node --check scripts/repair-summary-files.mjs` ✅
- `pnpm --filter @bilibili-downloader/server build` ✅
- dist 六个 import 路径存在性检查 ✅；`@bilibili-downloader/adapters/ffmpeg`
  具名导入冒烟 ✅（审计 P9）
- 假 DATABASE_URL 导入冒烟：全部静态 import 解析成功，运行正确终止于
  PostgreSQL 连接失败 ✅
- `pnpm typecheck` ✅
- 真实 DB/下载目录修复待用户在其环境执行

## 遗留

- 画质不可用时 selectBestStream 会降级（文件名含实际画质），"原画质"为尽力而为
- title 与原生成时不同时，rebuild 覆写新名 md，旧名 md 会成孤儿（提示级）
- rawResponse 非法 JSON 归 failed 而非 skipped：与计划步骤 1"跳过并报告"的偏差
  （闭项审计确认合理）——rebuild 对非法 JSON 自身抛错（analysis-engine.ts:226-231），
  该记录属数据损坏态无法本地修复，且预检避免为其白白重下视频
- sourceTaskId 语义：重下场景中视频实际来自新下载任务，但 upsert 仍写定位到的
  latest task id（与 runRebuild 的 latest-task 语义一致；sourceTaskId 无文件定位
  消费方，仅认领/日志用）
- 提示级：ffmpeg 不可用时，rawResponse 为空的 task 因检查顺序会被记 failed
  而非 skipped
