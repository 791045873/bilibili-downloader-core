# Plan: AI 总结修复脚本改造为 API 接口

日期: 2026-09-08
状态: implemented
Autonomy: 用户直接请求；新 API 端点，遵循既有 integrity-check/rebuild 端点模式
Audit: plan 审计 pass-with-conditions
（`docs/audits/2026-09-08-plan-audit-summary-repair-api.md`）；closure 审计
（`docs/audits/2026-09-08-closure-audit-summary-repair-api.md`，实现完成后创建）
前置: `docs/plans/2026-09-08-summary-repair-script-plan.md`（脚本版，行为基线；
其产物 `packages/server/scripts/repair-summary-files.mjs` 由本接口取代并删除）

## 需求（用户确认）

1. 将一次性修复脚本改为 API 接口，便于 Docker 内调用。
2. 接口返回修复成功/失败/跳过信息。
3. **阻塞分析结论（用户决策）**：重新下载原视频耗时长，不得阻塞接口。所有需要
   重下视频的 task 统一收集，在本次修复主流程（全部可本地修复项）完成后、接口
   返回前，仅**入队**下载（经 DownloadScheduler，非阻塞）；接口返回中标记这些
   task 为 deferred。由人工检视下载任务完成后**重新触发本接口**完成剩余修复
   （已修复项自然不再判定为缺失，幂等）。

## 行为设计

### 端点

- `POST /api/summary-tasks/repair`（analysis-task.controller.ts，对齐
  integrity-check 端点风格；`@HttpCode(200)`）
- 进程内全局互斥（同 SummaryIntegrityService 的 tryStart/isRunning 模式）；
  并发触发返回 409 `修复流程进行中`。
- **同步执行**主流程（磁盘修复），返回完整报告；仅下载入队为异步。
- 不新增 status 轮询端点（主流程同步返回结果；下载进度走既有下载任务表）。

### 主流程（SummaryRepairService.run()，await 完成后返回报告）

1. `db.listCompletedAiSummaryTasks()`；逐条判定缺失（复用脚本版 findMissing
   语义：summaryOutput 空 / md 不可读 / listLocalImageRefs 任一截图缺失）。
2. 启动预检 `FfmpegScreenshot.isAvailable()`；不可用 → 全部待修复项记 failed，
   不入队下载。
3. 逐条处理（可本地修复）：
   - rawResponse 空 → skipped；非法 JSON → failed（同脚本版偏差，已记录）；
     bvid/cid 缺失 → skipped；无下载任务 → skipped。
   - 视频：latest task outputFile 存在 → 直接用；否则
     `findCompletedTaskByBvidAndCid` 复用旧 success 文件；仍无 → **收集到
     deferred 列表，跳过本条，不下载**。
   - 修复：`AnalysisEngine.rebuild()` + `resetAiSummaryTaskIntegrity` +
     `upsertAiSummaryTask`（字段与 analysis-trigger.runRebuild 终态一致，
     不触发 knowledgePublisher）。
4. **末段统一处理 deferred**（主流程全部可修复项完成之后；先按 bvid+cid 去重）：
   - latest task status 为 created/downloading → deferred（reason: 下载任务
     进行中，不入队，防重复）；
   - 否则 `DownloadScheduler.createDownload({旧 task 的 bvid/cid/title/quality/
     codec/outputPath/fileNameTemplate/subtitleLang, autoSummary:false})` 入队，
     记录 queuedTaskId；入队前检 `FfmpegMerger.isAvailable()`，缺失则记 failed
     （避免反复入队必败下载）。
   - 卡死出路（人工）：若下载任务永久卡在 downloading，先在下载队列页停止该任务，
     再重触发本接口（stopped → 走入队分支重建）。
5. 返回报告（成功项统一入 `repaired`，条目带 `empty` 布尔区分空内容文档；
   不设独立 repairedEmpty 数组）：

```json
{
  "message": "修复完成；N 个任务已入队重新下载，待下载完成后可重新触发本接口",
  "report": {
    "totalCompleted": 0, "pendingCount": 0,
    "repaired": [{ "id", "bvid", "cid", "title", "summaryPath", "segmentCount", "empty" }],
    "skipped": [{ "id", "bvid", "cid", "title", "reason" }],
    "failed": [{ "id", "bvid", "cid", "title", "reason" }],
    "deferred": [{ "id", "bvid", "cid", "title", "reason", "queuedTaskId" }]
  }
}
```

### 阻塞与时限说明

- 同步部分耗时 ≈ 待修复任务数 ×（ffmpeg 截图数秒 + md 写入）；缺失量级大时
  存在 HTTP 客户端超时风险（属用户明确接受的交互模型：主修复同步返回，
  只有下载异步化）。调用方可加长 curl/http 客户端超时。
- 客户端超时后重试会得 409（互斥中），首次运行不受影响，结束后可再触发。
- 全局互斥防止并发重复修复/重复入队。**controller 必须同步 await
  `service.run()` 并返回报告，不得照抄 integrity-check 的 fire-and-forget
  模式**；互斥释放在 service.run() 的 try/finally 内。

## 产出物

- 新增 `packages/server/src/analysis/summary-repair.service.ts`
- 修改 `packages/server/src/analysis/analysis-task.controller.ts`（新端点 + 注入）
- 修改 `packages/server/src/analysis/analysis.module.ts`（注册 provider）
- 删除 `packages/server/scripts/repair-summary-files.mjs`（被接口取代）
- 更新 `docs/context/codebase-map.md`（Server 行补 summary-repair.service.ts）
- 更新/新增 `docs/logs/` 记录

## 测试策略

- 修复链路复用已测试的 rebuild 管道（tests/database/summary-integrity.test.ts、
  rebuild 端点既有语义）；新增端点验证：`pnpm typecheck`、`pnpm build`、
  `node --check` 级别的导入完整性（Nest DI 编译期校验）。
- DB 全链路测试需 TEST_DATABASE_URL，本轮不新增（记为 backlog 候选）；由用户
  在真实环境 curl 验证。

## 验证

- `pnpm typecheck`、`pnpm --filter @bilibili-downloader/server build`
- **真实启动冒烟**（DI 装配错误 tsc/build 不报错，只在运行时 bootstrap 暴露）：
  连同 `.env` 启动一次 server，确认 Nest 完成初始化无 DI 错误后停止。
- 用户真实环境：`curl -X POST http://<host>:<port>/api/summary-tasks/repair`
  两次触发验证幂等与 deferred → 人工确认下载完成 → 重触发 → repaired。

## 明确不做

- 不做前端 UI；不做轮询状态端点；不改 ai_summary_task 表结构；
- 不做 COS 重发布；不改变下载调度器行为。
