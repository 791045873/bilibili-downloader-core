# 09-30 重试截图（screenshot_retry 收窄）Testing

> 需求：`docs/requirements/2026-09-17-screenshot-retry.md`
> 计划：`docs/plans/2026-09-30-screenshot-retry-plan.md`
> 定位：需求级观察态（应呈现/不应呈现），非测试脚本。

## 检查应覆盖的状态

### T1 纯截图重试
- screenshot_retry 作业：读段 timestampSeconds + 截图源 → 截图 → 传 COS → 仅回写 screenshot_url；不调 LLM、不改 summary 文本/段内容/向量、不改 ai_summary_task 状态。

### T2 批量幂等
- 仅处理 screenshot_url 为空且 timestamp 非空的段；已有截图不重传；重复投递由 dedup_key 去重。

### T3 截图源三级降级
- 本地高清 → NAS 下载 → 远端兜底；降级/跳过显式记日志。

### T4 作业化
- 触发（/rebuild 收窄）写 screenshot_retry 作业；status 读 DB（Phase 2 语义）。

### T5 安全跳过
- 本地视频缺失 / timestamp 缺失 / COS 未配置或上传失败 → 该段跳过并记录，不使整作业失败、不破坏内容。

### T6 前端语义
- rebuild 按钮呈现“重试截图”语义（补齐缺失、不重跑分析）；调用路径不变，兼容。

### T7 无回归
- 全量 server 测试绿；前端 typecheck/build 绿；旧“全量重建”副作用（改内容/向量/状态）不再发生。

## 验证命令
- `pnpm --filter @bilibili-downloader/server test`（测试容器，`TEST_DATABASE_URL`）
- `pnpm --filter @bilibili-downloader/server typecheck` / `build`
- `pnpm --filter @bilibili-downloader/frontend typecheck` / `build`

## 实施结论（2026-09-30）

验证：server `typecheck`/`build` 通过、`test` 全量 160 passed（测试容器 pgvector/pg17）；frontend `typecheck`/`build` 通过。

- T1 纯截图重试 — 通过（代码核对 + 测试）。`ScreenshotRetryService.run` 仅 `updateSegmentScreenshotUrl` 回写；不调 LLM、不 upsertSummaryKnowledge、不 upsertAiSummaryTask、不动向量；旧 `runRebuild`（全量重建）已移除。
- T2 批量幂等 — 通过。`selectSegmentsForRetry` 仅选空 screenshot_url 且有 timestamp 的段（纯函数用例覆盖，含 ts=0/空串）；COS key 确定性（`summary/{bvid}-{cid}/screenshots/segment-{seq}-frame-0.jpg`）覆盖同段；重复投递由 `dedup_key=screenshot_retry:{id}` 去重（Phase 2）。
- T3 截图源三级降级 — 通过（代码核对）。本地高清优先（findLatestTaskByBvidAndCid+fileExists 直用本地），缺失回退 `AnalysisVideoResolver.resolve`（远端/已完成本地/重下兜底，既有共享行为）；两者不可得 → 记 videoMissing 跳过。resolver 内部 NAS-vs-远端子序为裁决 out-of-scope。
- T4 作业化 — 通过（沿用 Phase 2）。/rebuild 收窄后仍 enqueue screenshot_retry；status 读 DB；handler 改调新执行体。
- T5 安全跳过 — 通过（代码核对）。无 timestamp（selectSegments 排除）/ 视频缺失（source 为空整体跳过）/ COS 未配置（isConfigured=false 跳过）/ 单段截图或上传失败（catch 跳过并记日志）均不失败整作业、不破坏内容。
- T6 前端语义 — 通过（代码核对 + build）。按钮/成功/错误文案收窄为“重试截图”，调用路径 `/summary-tasks/:id/rebuild` 不变。
- T7 无回归 — 通过。全量 160 passed；前端构建绿；旧全量重建副作用（改内容/向量/状态）随 runRebuild 移除而消除。

### 裁决（out of scope）
- ffmpeg 截图 + COS 上传为外部 IO，不做单测（typecheck/build + 人工核对覆盖）。
- /rebuild 改名 /screenshot-retry、强制重截全部段、resolver 内部 NAS-vs-远端子序重排：均 out-of-scope（见计划 Deferred）。
