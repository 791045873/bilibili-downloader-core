# 2026-09-30 完整性检查重定义（内容/截图/视频三类，作业化执行体）实施

计划：`docs/plans/2026-09-30-integrity-check-rescope-plan.md`
测试：`docs/testing/2026/09-30-integrity-check-rescope-testing.md`

## 分步与提交

- 计划 + testing + 独立 plan audit（c982bd7）：PASS-WITH-REQUIRED-FIXES 已并入。
- P1+P3 后端判据重写 + 作业 handler 打通 + 测试（bccbc43）：
  - `summary-integrity.service.ts` 以云端为真源三类判据（内容=云 DB summary/segment；
    截图=segment.screenshot_url 非空；视频=NAS 本地文件存在），导出纯函数
    `judgeIntegrity`（分级 complete/partial/missing，视频仅告警不降级），
    `integrity_detail` 改结构化 JSON；不读本地 md。
  - `analysis-trigger.service.ts` un-gate `handleIntegrityCheckJob` → 注入
    `SummaryIntegrityService` 执行 `run()`（无循环依赖）。
  - `summary-integrity.test.ts` 整块重写：judgeIntegrity 5 例 + 数据层 5 例
    （upsertSummaryKnowledge 播种 + insertTask 落盘验视频）。
- P2 前端结构化展示（8d6ec4d）：`AiSummaryTasks.tsx` 解析 integrityDetail JSON 分类
  展示（内容/截图 seq/视频告警），新增 partial 橙色徽标，旧自由文本回退。

## 验证

- server：`typecheck` / `build` 通过；`test` 全量 155 passed（测试容器 pgvector/pg17）。
- frontend：`typecheck` / `build` 通过。

## 决策与裁决

- 内容缺失仅可判"无 summary 头 / 零段"两态（数据模型无"应有段数"权威值）；
  `contentMissing[]` 以固定标记 `summary`/`segments` 承载（跨端契约）。
- 视频判定用服务内 node-fs `fileExists`（不新增 DownloadService 依赖）；
  无完成下载任务 / 无 outputFile / 文件不存在 → videoMissing（仅告警）。
- 截图判定默认凭 `screenshot_url` 非空，不做 COS HEAD 探测（Open Question，另需求可选增强）。
- 触发/status 已在 Phase 2 作业化，本需求沿用；`summary-dir.ts` 的
  `resolveSummaryOutputPath`/`listLocalImageRefs` 仅解除引用、不删除（仍被渲染与测试使用）。

## 无 schema 变更

- 复用 `ai_summary_task.integrity_status/integrity_detail/integrity_checked_at`；
  `integrity_status` 扩展 `partial`，`integrity_detail` 由自由文本改为结构化 JSON 文本。
