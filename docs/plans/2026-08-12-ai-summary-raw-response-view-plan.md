# Plan: AI 总结列表查看模型原始返回

日期：2026-08-12
状态：completed（2026-08-12 闭核算：cold-replay 自核 PASS）
Audit: skipped under micro-plan exception —— 本地小改动（1 个只读 GET 端点 + 前端按钮/Dialog，4 个代码文件、约 120 行内）；不新增数据库列、不改数据模型，只读端点无副作用；无 auth/permission、数据删除、支付、部署、跨表面契约风险。

## 背景与动机

- 本需求前半部分已将 LLM 成功返回的原始内容（`raw_response`）与模型名（`model_name`）入库，但列表响应刻意不携带 `rawResponse`。用户希望直接在 AI 总结表格中查看本次大模型调用的原始返回内容。

## Scope（实施项）

1. `packages/server/src/analysis/analysis-task.controller.ts`：新增 `GET /summary-tasks/:id/raw-response`（非法 id → 400 `无效的任务 ID`；记录不存在 → 404 `AI 总结任务不存在`；成功 → `{ rawResponse: record.rawResponse ?? null }`）。
2. `packages/frontend/src/api/index.ts`：新增 `getAiSummaryTaskRawResponse(id): Promise<{ rawResponse: string | null }>`。
3. `packages/frontend/src/views/AiSummaryTasks.vue`：
   - 操作列新增"查看原始"按钮；
   - 新增 Dialog（复用 primevue/dialog 既有模式），点击按钮按 id 拉取原始返回并展示；加载中/错误/无原始返回（null）三种状态分别处理。

## 明确不做

- 不在列表响应中携带 `rawResponse`；不改动入库逻辑；不新增数据库列。

## 验证命令

- `pnpm typecheck`、`pnpm build`：通过。
- API/DB 冒烟（沿用 `$TEMP/opencode/raw-retrigger-smoke/smoke.cjs`）：
  - `GET /api/summary-tasks/:id/raw-response`（completed 含 raw）→ 200 返回原文；pending（raw 为 null）→ 200 返回 `null`；非法 id → 400；不存在 → 404。

## Audit

- 计划审计：`Audit: skipped under micro-plan exception`（理由见文件头）。实施前 cold-replay 自查：`databaseService.getAiSummaryTaskById` 返回完整记录含 `rawResponse`（`aiSummaryTaskSelectSql` 已含该列）、primevue Dialog 在 `VideoDetail.vue` 有既有用法。
- 闭核算：cold-replay 自核 PASS。对照计划逐条核对真实 diff（controller 端点、api 方法、vue 按钮 + Dialog）；`pnpm typecheck`、`pnpm build` 通过；冒烟 22/22 PASS（含新增 5 项 raw-response 检查）。文档已同步（requirement 追加、app-overview、logs、testing）。
