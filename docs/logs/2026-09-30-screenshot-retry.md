# 2026-09-30 重试截图（rebuild → screenshot_retry 收窄）实施

计划：`docs/plans/2026-09-30-screenshot-retry-plan.md`
测试：`docs/testing/2026/09-30-screenshot-retry-testing.md`

## 分步与提交

- 计划 + testing + 独立 plan audit（801dcf9）：PASS-WITH-REQUIRED-FIXES 已并入（截图源本地优先、resolve 顺序基线更正、幂等 key）。
- P1+P2+P4 后端（42c84c6）：
  - `database.service.ts` 增 `updateSegmentScreenshotUrl(summaryId,seq,url)` + `getSummarySegmentsForScreenshotRetry(bvid,cid)`。
  - `screenshot-retry.service.ts`（新）：`selectSegmentsForRetry` 纯函数 + `ScreenshotRetryService.run`（本地高清优先→回退 resolver；逐段截图→COS 确定性 key→仅回写 screenshot_url；不调 LLM/不改内容/向量/状态；安全跳过）。
  - `analysis-trigger.service.ts` handler 改调新执行体，**移除旧 `runRebuild`**（全量重建语义收窄取代）；`analysis.module.ts` 注册。
  - 测试：纯函数 2 例 + 数据层 3 例。
- P3 前端（63191b6）：rebuild 按钮/提示文案收窄为“重试截图”，调用路径不变。

## 验证

- server：`typecheck`/`build` 通过；`test` 全量 160 passed（测试容器 pgvector/pg17）。
- frontend：`typecheck`/`build` 通过。

## 决策与裁决

- 截图源本地高清优先（修 plan audit B1）：`findLatestTaskByBvidAndCid`+`fileExists` 直用本地文件；缺失回退 `AnalysisVideoResolver.resolve`（远端/已完成本地/重下兜底为既有共享行为）。resolver 内部 NAS-vs-远端子序不在本期重排（out-of-scope）。
- 批量仅补空段（幂等）；确定性 COS key 保证同段重截覆盖。
- 外部 IO（ffmpeg/COS）不做单测，靠 typecheck/build + 人工核对。
- /rebuild 路径保留、仅收窄语义（前端兼容）；改名为 Open Question 暂不做。

## 无 schema 变更

- 仅更新 `summary_segment.screenshot_url`；不动 summary 文本/向量/`ai_summary_task` 状态。
