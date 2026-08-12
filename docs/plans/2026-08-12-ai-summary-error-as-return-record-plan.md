# Plan: 模型调用报错时错误信息作为返回记录

日期：2026-08-12
状态：completed（2026-08-12 闭核算：cold-replay 自核 PASS）
Audit: skipped under micro-plan exception —— 本地小改动（2 处失败 upsert 增补字段 + 前端弹窗回退展示 + 注释/文档，约 60 行内）；不改数据模型、不加列、只读端点不变；无 auth/permission、数据删除、支付、部署、跨表面契约风险。

## 背景与动机

- 用户需求：如果模型调用报错，错误信息也应作为"返回记录"保存，且"查看原始"弹窗可查看错误信息。
- 现状：`raw_response` 仅在成功时写入；失败时清空，弹窗显示"无原始返回"。`error_message` 已入库但不在原始返回弹窗展示。

## Scope（实施项）

1. `packages/server/src/analysis/analysis-trigger.service.ts`：
   - `runAnalysis` 失败分支（含模型调用报错）upsert 增加 `rawResponse: msg`；
   - `onLowResFinished` 失败分支 upsert 增加 `rawResponse: result.error`（保持一致，失败即记录错误）。
2. `packages/server/src/database/database.service.ts`：`raw_response` 字段注释更新为"本次执行记录：成功=模型返回 content 原文；失败=错误信息"；upsert 保留逻辑注释同步。
3. `packages/frontend/src/views/AiSummaryTasks.vue`："查看原始"弹窗逻辑改为 `rawResponse` 优先，为空时回退展示 `task.errorMessage` 并提示"本次无模型原始返回，以上为记录中的错误信息"（覆盖历史/对账记录）。

## 明确不做

- 不改 `raw_response` 列与 upsert/claim 结构；不改成功路径；不改列表响应。

## 验证命令

- `pnpm typecheck`、`pnpm build`：通过。
- API/DB 冒烟（沿用 `$TEMP/opencode/raw-retrigger-smoke/smoke.cjs`）：
  - 种子一条 `failed` 记录（`raw_response`=错误文本），`GET /api/summary-tasks/:id/raw-response` → 200 返回该错误文本；
  - 重触发后旧 `raw_response` 被清空或写入本次新错误（不再保留旧内容）。

## Audit

- 计划审计：`Audit: skipped under micro-plan exception`（理由见文件头）。
- 闭核算：cold-replay 自核 PASS。对照计划逐条核对真实 diff（两处失败 upsert `rawResponse`、DB 注释、前端弹窗回退分支）；`pnpm typecheck`、`pnpm build` 通过；冒烟 23/23 PASS（含新增"failed 记录返回错误文本"检查；原"raw cleared"断言因离线管线可能已把新错误写入 `raw_response` 调整为"旧内容已移除"）。文档已同步（requirement 追加、app-overview、logs、testing）。
