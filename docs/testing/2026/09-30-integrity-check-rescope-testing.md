# 09-30 完整性检查重定义 Testing

> 需求：`docs/requirements/2026-09-17-integrity-check-rescope.md`
> 计划：`docs/plans/2026-09-30-integrity-check-rescope-plan.md`
> 定位：需求级观察态（应呈现/不应呈现），非测试脚本。

## 检查应覆盖的状态

### T1 三类判据（云端为真源）
- 内容以云 DB `summary`+`summary_segment` 判定，**不读本地 md**；截图凭 `summary_segment.screenshot_url` 非空；视频凭 NAS 本地文件（`outputFile` join `DOWNLOAD_ROOT`）存在。

### T2 分级
- 内容缺失 → `missing`；仅截图缺失 → `partial`；仅视频缺失 → `complete`（视频仅告警，记 `videoMissing[]`）；全备 → `complete`。
- 不应出现：视频缺失把状态误降为 `missing`（除非同时内容缺失）。

### T3 结构化 detail
- `integrity_detail` = `{contentMissing[],screenshotMissing[],videoMissing[]}` JSON 文本；`screenshotMissing` 列出缺失 `seq`。

### T4 作业化（沿用 Phase 2）
- 触发写 `integrity_check` 作业；status 读 DB；`integrity_check` handler 实际执行新判据（不再 gated no-op）。
- NAS 离线（worker 未轮询）→ 作业保持 `queued`。

### T5 只读与幂等
- 检查仅写 `integrity_*` 三列，不改业务数据、不触碰 `updated_at`；重复执行结果可覆盖、幂等。

### T6 前端展示
- UI 分类呈现内容/截图(seq)/视频三类缺失；`partial` 有区分样式；旧自由文本 detail 值不致崩溃（回退原文）。

### T7 边界
- `completed` 无 `summary` 行 → `contentMissing`，`missing`。
- `screenshot_url` 部分空 → `screenshotMissing[seq]`，`partial`。
- 视频缺失但内容/截图完备 → `videoMissing[]` + 告警，状态 `complete`。
- COS 未配置 → 不做可达性探测，凭 url 非空判定，不误判。

### T8 无回归
- 全量 server 测试绿；前端 typecheck/build 绿。

## 验证命令
- `pnpm --filter @bilibili-downloader/server test`（测试容器，`TEST_DATABASE_URL`）
- `pnpm --filter @bilibili-downloader/server typecheck` / `build`
- `pnpm --filter @bilibili-downloader/frontend typecheck` / `build`

## 实施结论（2026-09-30）

验证：server `typecheck`/`build` 通过、`test` 全量 155 passed（测试容器 pgvector/pg17）；frontend `typecheck`/`build` 通过。

- T1 三类判据 — 通过。`summary-integrity.service.ts` 内容经 `getSummaryWithSegmentsByResource`（云 DB，不读本地 md）、截图凭 `segment.screenshotUrl` 非空、视频经 `findCompletedTaskByBvidAndCid`+`resolveFromDownloadRoot`+node-fs 存在性。
- T2 分级 — 通过。`judgeIntegrity` 纯函数用例覆盖：内容缺失→missing、仅截图→partial、仅视频→complete（告警）、全备→complete。
- T3 结构化 detail — 通过。`integrity_detail=JSON.stringify({contentMissing[],screenshotMissing[],videoMissing[]})`；数据层用例断言 `screenshotMissing` 列 seq。
- T4 作业化 — 通过（沿用 Phase 2 + un-gate）。触发/status 已作业化；`handleIntegrityCheckJob` 现执行 `run()`。NAS 离线（worker 未轮询）作业保持 queued（Phase 2 语义）。
- T5 只读幂等 — 通过。`updateAiSummaryTaskIntegrity` 不触碰 updated_at（用例断言 before==after）；重复 run 可覆盖。
- T6 前端展示 — 通过（代码核对 + build）。`AiSummaryTasks.tsx` 解析 JSON 分类展示，partial 橙色徽标，旧自由文本 JSON.parse 失败回退原文。
- T7 边界 — 通过。无 summary→missing；截图部分空→partial 列 seq；视频缺失但内容/截图完备→complete+videoMissing 告警；COS 未配置→凭 url 非空判定不误判（未做 HEAD 探测）。
- T8 无回归 — 通过。全量 155 passed；前端构建绿。

### 裁决（out of scope）
- COS 截图 HEAD 可达性探测：Open Question，默认凭 url 非空判定即满足 AC，未实现（可选增强）。
- 自动修复（截图→screenshot_retry / 视频→下载作业）：属独立需求，本需求仅检测报告。
