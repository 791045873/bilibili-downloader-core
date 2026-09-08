# Plan: AI 总结本地文件修复脚本（以 ai_summary_task 为真源）

日期: 2026-09-08
状态: implemented
Autonomy: 用户直接请求的一次性维护脚本（非产品行为变更）；plan 已过独立 subagent 审计
Audit: plan 审计 pass-with-conditions
（`docs/audits/2026-09-08-plan-audit-summary-repair-script.md`）；closure 审计
pass-with-conditions（`docs/audits/2026-09-08-closure-audit-summary-repair-script.md`，
文档级修正已回填日志）

## 背景与问题

下载目录中的 AI 总结 md 文件与云端数据库 `ai_summary_task` 表数据无法一一匹配：
部分 completed task 缺少对应 md 文件或截图文件。需要一次性脚本修复。

## 决策记录（用户确认）

1. `rawResponse` 为空的 completed task：**跳过并报告**（不触发 LLM 重新分析）。
2. 视频文件缺失：**原画质下载**，下载目录/命名与旧下载任务保持一致（复用旧 task 的
   quality/codec/outputPath/fileNameTemplate，落库为新的下载任务行）。
3. 只修本地文件与 `ai_summary_task` 记录，**不重新发布** COS/summary/summary_segment。
4. **不需要** dry-run 模式。

## 唯一真源与匹配规则

- 真源: `ai_summary_task WHERE status='completed'`（`db.listCompletedAiSummaryTasks()`，
  database.service.ts:937，含 rawResponse/summaryOutput 完整字段）。
- 判定"缺文件"（对齐 summary-integrity.service.ts 语义）：
  - `summaryOutput` 为空 → 缺 md；
  - `resolveSummaryOutputPath(summaryOutput, DOWNLOAD_ROOT)` 处 md 不存在 → 缺 md；
  - md 存在但 `listLocalImageRefs(content)` 中任一相对截图文件不存在 → 缺截图。
- 修复方式统一为 `AnalysisEngine.rebuild()`（analysis-engine.ts:220）：不调 LLM，
  用 `rawResponse` 重新截图 + 重写 md（md 文件名/目录与正常生成管道一致）。

## 修复流程（单个 task）

0. 启动预检（审计 P2）：`new FfmpegScreenshot().isAvailable()`；仅当存在待重下视频时
   另检 `new FfmpegMerger().isAvailable()`。ffmpeg 缺失时不产出半成品 md（rebuild 截图
   逐段失败仍会写 md），相关 task 记 failed/skipped 并明确报告。

1. 前置校验：`rawResponse` 非空且可 JSON.parse；`bvid`/`cid` 有效；否则跳过并报告。
2. 定位下载任务：`db.findLatestTaskByBvidAndCid(bvid, cid)`（同 analysis-trigger.ts:792）。
   无对应 task → 跳过并报告。
3. 视频文件：`task.outputFile` 存在且可读则直接用；否则先尝试
   `db.findCompletedTaskByBvidAndCid(bvid, cid)` 复用更早 success 任务的现存文件
   （审计 P4：latest task 可能是 failed 而旧 success 文件仍在）；仍无则按旧 task 字段
   （bvid/cid/title/quality/codec/outputPath/fileNameTemplate）经
   `DownloadService.createTask()` + `executeTask()` 原画质重下（目录与命名与旧任务一致）。
   **executeTask 吞错不抛异常**（审计 P1）：执行后必须 `db.getTaskById(newId)` 复查
   `status === "success"` 且 `outputFile` 非空，否则记 failed 继续。
   注：请求画质不可用时 selectBestStream 会降级，文件名含实际画质，"原画质"为尽力而为
   （审计 P5）。
4. summaryDir：复刻 `resolveSummaryDir` 规则（analysis-trigger.service.ts:624-675）：
   `{sanitize(title)}-{bvid}-{cid}`，优先复用已有同资源目录（精确名 → `-{bvid}-{cid}`
   后缀 → `{bvid}-{cid}`）。
5. `new AnalysisEngine().rebuild(input, rawResponse, modelName ?? "")` 生成
   md + `screenshots/segment-N-frame-0.jpg`。
6. 回写 DB（同 analysis-trigger.ts:829-838 rebuild 语义）：
   - `db.resetAiSummaryTaskIntegrity(id)`；
   - `db.upsertAiSummaryTask({bvid, cid, title, sourceTaskId, status:"completed",
     summaryOutput: result.summaryPath, errorMessage:"", executionTiming, lastTriggeredAt,
     lastCompletedAt})`（summaryOutput 自动转相对 DOWNLOAD_ROOT 的 POSIX 路径）。
   - 不触发 knowledgePublisher（用户决策 3）。
7. 失败不破坏：单 task 失败仅记录，不改写该记录状态；继续处理后续 task。

## 产出物

- `packages/server/scripts/repair-summary-files.mjs`（仿 seed.mjs 风格：直接 import
  `../dist/**`，`node --env-file-if-exists=.env scripts/repair-summary-files.mjs` 运行）。
- `docs/logs/2026-09-08-summary-repair-script.md`（实现日志）。

## 脚本直连实例化清单

| 组件 | 实例化方式 |
| --- | --- |
| DatabaseService | `new DatabaseService()` + `onModuleInit()`/`onApplicationShutdown()` |
| PathsService | `new PathsService()`（注入 DatabaseService 与 DownloadService 构造器） |
| DownloadService | `new DownloadService(db, paths)` + `onModuleInit()`（仅当需要重下视频） |
| AnalysisEngine | `new AnalysisEngine()`（rebuild 路径不需要 LLM 配置/resolver） |

## 范围外（明确不做）

- 不重新发布云端知识库（COS / summary / summary_segment）。
- 不处理非 completed 状态的 ai_summary_task。
- 不做 dry-run；不新增 API 端点；不改产品代码。

## 验证

- `pnpm --filter @bilibili-downloader/server build`（确保 dist 与脚本 import 路径一致）。
- `node --check packages/server/scripts/repair-summary-files.mjs`（语法检查）。
- dist 导入冒烟（审计 P9）：临时以 `--check-only` 之外的方式确认 `../dist/**` 各 import
  路径真实存在（脚本内对关键模块 import 失败时立即报错退出）。
- 运行前提（审计 P8）：Node ≥ 22.9（`--env-file-if-exists`；本机 v24）；在
  `packages/server/` 目录下运行；`OUTPUT_DIR` env 或 `.env` 决定 DOWNLOAD_ROOT
  （默认 `cwd/downloads`）。
- 实际修复需连真实 DB/下载目录，由用户在其环境运行；脚本输出汇总报告
  （repaired / repaired-empty / skipped / failed 明细；审计 P7：区分空内容文档）。

## Closure

- 冷回放自检：对照本计划、真实 diff、验证命令结果逐条核对。
- 更新 `docs/logs/`；不改动 project-context 的 active requirement。
