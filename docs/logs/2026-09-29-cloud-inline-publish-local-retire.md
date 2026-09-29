# 2026-09-29 云端/NAS Phase 1b — 内联发布 + 本地 md/截图下线（实现闭合）

> 计划：`docs/plans/2026-09-28-cloud-inline-publish-local-retire-plan.md`
> 需求：`docs/requirements/2026-09-17-cloud-inline-publish-local-retire.md`
> 提交：`2654466`(P1) `44f8f75`(P3-be) `afd6cc8`(P2) `d92b9e3`(P3-fe) `39117ec`(P4) + 本次 P5 文档/闭合

## 结果

- **内联发布**：`KnowledgePublisherService.publishInline` 按结构化 `segments[].screenshotFiles` 上传 COS + 事务写 `summary`/`summary_segment`；内容入库成功=`completed` 门槛，COS/embedding 入库后 best-effort（失败不阻塞、不回退 failed）。旧 `publish()`（读 md 反解）已删。
- **H4**：trigger 三处失败路径不再写 `rawResponse`；LLM 成功后步骤失败保留模型 JSON。
- **B3**：`AnalysisEngine` 暴露 `segments[].screenshotFiles`，发布按结构映射。
- **停写本地**：engine 不再写 md、trigger 不再写 `summary_output`；`main.ts` 移除 `/summary-files` 挂载；`summary-dir` 删死 helper（保留 `listLocalImageRefs`/`resolveSummaryOutputPath`，完整性检查仍用）。
- **下线端点**：`publish`/`backfill`/`repair`（后端文件+module+前端引用+knowledge_status UI）全部移除。
- **顺序调整**：实施为 P1 → P3 → P2 → P4 → P5（P2 依赖 P3 先删旧 publish/helper）。

## 验证

- `pnpm typecheck`、`pnpm build` 通过；`pnpm --filter server test` 18 文件 / 128 项通过（本地 pgvector:pg17 容器）。
- 计划审计：实现前独立子代理 plan audit（两轮）；闭合前独立子代理 closure audit（Verdict PASS-WITH-FIXES，should-fix 已处理：vite `/summary-files` 代理删除、临时文件清理、发布器注释更正、计划闭合元数据）。

## 已知副作用（已裁决）

- 旧"本地完整性检查"（读本地 md）在停写后会误报缺失，由「完整性检查重定义」需求（依赖 Phase 1b/2）承接；已在 app-overview 加注。
- `database.service` 的 `updateSummaryKnowledgeStatus` / `listAiSummaryTasksForKnowledgeBackfill` 成为无调用方死方法；随 `knowledge_status` 列一并留待 Phase 4 清理。
- rebuild 仅连带适配发布器契约，语义收窄仍属独立「重试截图」需求。

## 后续

- Phase 2（作业化 `worker_job`）→ 完整性检查重定义 / 重试截图 → Phase 3（拆项目）→ Phase 4（删列/删本地副本/COS 清理）。
