# 2026-09-08 AI 总结修复脚本改造为 API 接口

## 背景

将一次性修复脚本（`packages/server/scripts/repair-summary-files.mjs`，已删除）
改造为 API 接口，便于 Docker 内调用；同时按用户决策消除下载长任务对接口的阻塞。

- 计划: `docs/plans/2026-09-08-summary-repair-api-plan.md`
  （plan 审计与 closure 审计均 pass-with-conditions，条件已回填）
- 前置脚本版: `docs/plans/2026-09-08-summary-repair-script-plan.md`、
  `docs/logs/2026-09-08-summary-repair-script.md`

## 实现

- 新增 `packages/server/src/analysis/summary-repair.service.ts`：
  全局互斥（tryStart/isRunning，try/finally 释放）；缺失判定与 integrity 检查
  同语义；可本地修复项同步 rebuild（不调 LLM、不发布 COS）；视频缺失项收集到
  末段统一处理。
- 新端点 `POST /api/summary-tasks/repair`（analysis-task.controller.ts）：
  同步 await 返回报告（repaired[带 empty 布尔] / skipped / failed / deferred）；
  并发触发 409。
- deferred 末段处理：bvid+cid 去重 → FfmpegMerger 预检 → created/downloading
  状态不重复入队 → `DownloadScheduler.createDownload`（旧任务画质/目录/命名，
  `autoSummary:false` 阻断自动总结链路）。
- 注册 provider 于 analysis.module.ts；旧脚本文件删除。

## 使用方式

```bash
curl -X POST http://<host>:3100/api/summary-tasks/repair
```

返回示例：

```json
{
  "message": "修复完成；2 个任务已入队重新下载，待下载完成后可重新触发本接口",
  "report": {
    "totalCompleted": 120, "pendingCount": 14,
    "repaired": [{ "id": 3, "bvid": "BV1..", "cid": 1, "title": "...",
                   "summaryPath": "...", "segmentCount": 8, "empty": false }],
    "skipped": [{ "id": 7, "reason": "rawResponse 为空，无法重建总结内容" }],
    "failed":  [{ "id": 9, "reason": "rawResponse 不是有效 JSON" }],
    "deferred": [{ "id": 12, "reason": "视频缺失，已按原任务画质入队重新下载",
                   "queuedTaskId": 1148 }]
  }
}
```

人工流程：触发接口 → 检视报告 deferred 项 → 在下载队列确认下载完成 →
重新触发接口（已修复项不再缺失，幂等）。下载任务卡死时先停止该任务再重触发。

## 验证

- `pnpm typecheck`（全部包通过）、`pnpm --filter @bilibili-downloader/server build` 通过
- 启动冒烟（DI 装配）：`node --env-file-if-exists=.env dist/main.js` 输出
  `Nest application successfully started`（端口 3100 被用户既有实例占用属预期，
  不影响 DI 验证）
- 真实环境两次触发幂等/deferred→重触发路径由用户 curl 验证（待执行）

## 遗留 / 提示级

- ffmpeg 故障时，"下载进行中"的 deferred 项会被记 failed 而非 deferred（标签偏差）
- rawResponse 为空的 task 在 ffmpeg 不可用场景记 failed 而非 skipped（检查顺序）
- DB 全链路自动化测试未新增（需 TEST_DATABASE_URL），记为 backlog 候选
