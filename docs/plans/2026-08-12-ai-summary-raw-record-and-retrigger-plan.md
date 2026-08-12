# Plan: AI 总结原始返回记录与列表重新总结

日期：2026-08-12
状态：completed（2026-08-12 闭核算：cold-replay 自核 PASS，对照计划执行项/affected docs/真实 diff/验证命令全部一致）

## 背景与动机

- 用户需求：1) LLM 接口成功返回后，数据库记录原始返回并记录使用模型；2) AI 总结列表页提供"重新总结"按钮。
- 已确认决策：列表页展示模型列；原始返回记录模型 `content` 原文。
- 现有基线：`ai_summary_task` 为每个资源唯一一条记录，重跑覆盖，`execution_timing` 采用"认领即清、成功才写"的 stale 语义，本次沿用该语义。

## Scope（实施项）

### 适配器（`packages/adapters/src/llm/qwen-client.ts`）

1. 新增 `extractRawContent(body, emptyMessage)`：从 OpenAI 格式响应提取 `choices[0].message.content` 原文（替代现有 `parseOpenAiJsonResponse` 中的提取逻辑）。
2. `multimodalChat` 返回结构调整为 `{ data: object; rawContent: string; model: string }`：
   - `data` = 解析后的 JSON 对象（原行为不变）；
   - `rawContent` = 模型返回的 content 原文；
   - `model` = 实际使用模型（`params.model || visionModelName || modelName`）。
   - 现有唯一调用方为 `analysis-engine.ts`，同步调整即可。
3. `chatCompletion` 保持返回 `Promise<object>`，内部改用 `extractRawContent`。
4. `index.ts` 导出新结果类型 `MultimodalChatResult`。

### 引擎（`packages/server/src/analysis/analysis-engine.ts`）

5. `AnalysisOutput` 新增 `rawResponse: string`、`modelName: string`。
6. `analyze()` 中 `multimodalChat` 调用改为 `result.data`，同时保存 `result.rawContent`、`result.model`。
7. 正常返回与 `writeEmptySummary`（LLM 成功返回但无有效段落）路径都透传 `rawResponse` / `modelName`。

### 数据库（`packages/server/src/database/database.service.ts`）

8. `ai_summary_task` CREATE 语句新增 `raw_response TEXT`、`model_name TEXT`；`initSchema` 追加两条 try/catch `ALTER TABLE` 幂等迁移。
9. `AiSummaryTaskRecord` 新增 `rawResponse?: string; modelName?: string`；`aiSummaryTaskSelectSql` 追加 `raw_response AS rawResponse, model_name AS modelName`。
10. `upsertAiSummaryTask`：`rawResponse` / `modelName` 未提供时保留既有值（与 `executionTiming` 一致）；INSERT 与 ON CONFLICT UPDATE 同步写入。
11. `claimAiSummaryTask` 的 ON CONFLICT UPDATE 追加 `raw_response = NULL, model_name = NULL`（认领即清 stale）。

### 触发服务（`packages/server/src/analysis/analysis-trigger.service.ts`）

12. `AiSummaryTaskView` 改为 `Omit<AiSummaryTaskRecord, "executionTiming" | "rawResponse">`；`getAiSummaryTasks` / `getAiSummaryTaskById` 映射时解构剔除 `rawResponse`（列表响应不含原始返回，避免载荷膨胀），`modelName` 保留透出。
13. `runAnalysis` 成功分支 upsert 增加 `rawResponse: result.rawResponse`、`modelName: result.modelName`。
14. 私有 `upsertAiSummaryTask` 的 fields 类型增加 `rawResponse?` / `modelName?` 并透传 db。

### 新端点（`packages/server/src/analysis/analysis-task.controller.ts`）

15. 新增 `POST /summary-tasks/:id/retrigger`：
    - 非法 id → 400 `无效的任务 ID`（logger.warn）；
    - 记录不存在 → 404 `AI 总结任务不存在`；
    - `pending` / `analyzing` → 409 `进行中的 AI 总结不可重新触发`；
    - `findLatestTaskByBvidAndCid` 找不到 → 409 `无对应的下载任务，无法重新总结`；
    - 任务状态非 `success` → 409 `仅已完成下载任务可触发 AI 总结`；
    - 置 `autoSummary = 1` 后 `void trigger(task.id).catch(...)`（与 `POST /tasks/:id/summary` 同款火即走，异步失败落日志）；
    - 成功返回 `{ message: "AI 总结触发中" }`。

### 前端（`packages/frontend/src/`）

16. `types/index.ts`：`AiSummaryTaskEntry` 新增 `modelName?: string | null`。
17. `api/index.ts`：新增 `retriggerAiSummaryTask(id: number): Promise<{ message: string }>` → `POST /summary-tasks/:id/retrigger`。
18. `views/AiSummaryTasks.vue`：
    - 表格新增"模型"列（`task.modelName`，空值显示 `—`）；
    - "操作"列新增"重新总结"按钮：`completed` / `failed` 可点击，`pending` / `analyzing` 禁用；点击调 `retriggerAiSummaryTask`，成功重拉列表，失败写 `error`。

### 文档

19. `docs/design/app-overview.md`：Integration Points 更新 `POST /api/tasks/:id/summary` 邻接描述并新增 `POST /api/summary-tasks/:id/retrigger`；`ai_summary_task` 记录字段说明补充 raw_response/model_name 语义。
20. `docs/context/codebase-map.md`：视频分析路由行验证日期更新。
21. `docs/context/project-context.md`：active requirement / active plan 更新为本需求与本计划。
22. `docs/logs/2026/08-12.md`：追加实施记录。
23. 新增 `docs/testing/2026/08-12-ai-summary-raw-record-and-retrigger.md`：记录冒烟证据。

## 明确不做

- 不展示原始返回内容到前端；不保留多条历史版本；不改分析编排；不改删除语义；不加列表分页/自动刷新。

## 验证命令

- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- API/DB 冒烟：
  - 直接向 `ai_summary_task` 插入记录并 UPDATE 写入 `raw_response` / `model_name`，确认 `GET /api/summary-tasks` 返回 `modelName` 且不含 `rawResponse`。
  - `POST /api/summary-tasks/:id/retrigger`：completed 记录 + 存在 success 任务 → 200；不存在记录 → 404；pending/analyzing → 409；非法 id → 400；存在记录但资源无 success 任务 → 409。
  - 迁移幂等：同一 OUTPUT_DIR 重启 server 不报错。

## 风险与退出标准

- 无单元测试设施，验证以 typecheck/build + API/DB 冒烟为准。
- 适配器 `multimodalChat` 返回结构调整为同包内唯一调用方（analysis-engine）已同步，无外部消费者（grep 已确认）。
- `raw_response` 为模型 JSON 原文，体积可控；不进入列表响应。

## Audit

- 计划审计：`Audit: skipped under micro-plan exception`。透明性说明：实际改动 12 个文件、约 224 行，超出 micro-plan 通常的"1-3 文件 / 200 行"边界；因改动全部为增量（可空列、新端点、新按钮/列、返回字段扩展），无 auth/permission、数据删除、支付、部署、跨表面契约风险，且评审人可用性为 `none`，故仍按 cold-replay 自检替代独立评审（与 `docs/context/ai-autonomy-policy.md` 的 reviewer-availability 规则一致）。实施前已 cold-replay 自查 live 代码（`multimodalChat` 唯一调用方、`claimAiSummaryTask` conflict-update 块、`findLatestTaskByBvidAndCid`、`trigger()` autoSummary 守卫均已核对）。
- 闭核算：cold-replay 自核 PASS。对照计划逐条核对真实 diff：
  1-4 适配器/引擎返回结构调整 ✅（`multimodalChat`→`{data,rawContent,model}`，`extractRawContent`，`AnalysisOutput.rawResponse/modelName`，空内容路径透传）；
  5-7（计划 8-11）DB 两列迁移 + select + upsert 保留/写入 + claim 清空 ✅；
  8-11（计划 12-14）视图剔除 rawResponse、成功分支写入、私有 upsert 透传 ✅；
  12（计划 15）retrigger 端点各错误分支 + `@HttpCode(200)` ✅；
  13-15（计划 16-18）前端类型/api/视图模型列 + 重新总结按钮 ✅；
  16-19（计划 19-23）app-overview/project-context/codebase-map/logs/testing 文档 ✅。
  验证命令：`pnpm typecheck`、`pnpm build` 通过；API/DB 冒烟 17/17 PASS（记录于 testing 文档）。实现偏差 2 项已记录：新增 `@HttpCode(200)` 使响应码与需求契约一致（NestJS POST 默认 201）；冒烟脚本为一次性脚本未入库。
