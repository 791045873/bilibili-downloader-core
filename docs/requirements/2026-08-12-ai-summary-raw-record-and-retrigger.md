# 2026-08-12 AI 总结原始返回记录与列表重新总结

## Source

- Owner Doc: `docs/design/app-overview.md`
- Related Requirement: `docs/requirements/2026-08-03-download-task-list-ai-summary.md`
- Related Requirement: `docs/requirements/2026-08-11-task-and-summary-delete.md`
- Live Baseline: `packages/adapters/src/llm/qwen-client.ts`, `packages/server/src/analysis/analysis-engine.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`, `packages/server/src/analysis/analysis-task.controller.ts`, `packages/server/src/database/database.service.ts`, `packages/frontend/src/views/AiSummaryTasks.vue`, `packages/frontend/src/api/index.ts`, `packages/frontend/src/types/index.ts`

## Problem

1. AI 总结完成后，数据库只保存了 summary 输出文件路径、错误信息与执行耗时，没有保存模型接口**成功返回的原始内容**，也没有记录本次实际使用的模型。用户无法事后核对模型到底返回了什么、用的是哪个模型。
2. AI 总结任务列表页只有"删除"操作，没有"重新总结"入口。用户在列表页看到失败或过期总结时，只能回到下载任务列表页重新触发，入口不完整。

## Goal

- 当 LLM 模型接口成功返回数据后，把模型返回的原始内容（`message.content` 原文）与本次实际使用的模型名记录到数据库 `ai_summary_task`。
- AI 总结任务列表页为每条非进行中记录提供"重新总结"按钮，点击后复用现有分析链路重新执行该资源的 AI 总结。

## 已确认的产品决策（用户确认）

1. AI 总结任务列表页新增"模型"列，展示本次总结实际使用的模型名称。
2. "原始的返回"记录粒度 = 模型返回的 JSON 内容字符串（`choices[0].message.content` 原文），而非整个 OpenAI 格式响应体。

## In Scope

- `ai_summary_task` 新增 `raw_response`（TEXT，模型 content 原文）与 `model_name`（TEXT，实际使用模型）两列，幂等迁移。
- LLM 多模态调用成功后，将原始 content 与解析结果一并回传；解析结果不变。
- AI 总结成功落库时写入 `raw_response` 与 `model_name`；新一次认领开始时清空（最新一次执行结果为准，与 `execution_timing` stale 语义一致）。
- `GET /api/summary-tasks` 返回 `modelName` 供前端"模型"列展示；不返回 `rawResponse`（避免列表载荷膨胀，原始内容仅在数据库中留存）。
- 新增 `POST /api/summary-tasks/:id/retrigger`：按 AI 总结记录 id 触发重新总结（内部按资源 bvid+cid 找到下载任务后复用 `AnalysisTriggerService.trigger`）。
- AI 总结任务列表页新增"重新总结"按钮（`completed`/`failed` 可点击；`pending`/`analyzing` 禁用）。

## Out Of Scope

- 不保留多条 AI 总结历史版本（`ai_summary_task` 仍为每个资源唯一一条记录，重跑覆盖）。
- 不在前端展示原始返回内容。
- 不改动 `AnalysisEngine` 的核心分析链路（仅透传原始返回）。
- 不改变"删除"操作、不改变下载任务列表页行为。
- 不为 AI 总结列表新增分页或自动刷新。

## User Flows

### Flow 1: 记录原始返回与模型名

1. 用户触发某资源的 AI 总结（任意入口）。
2. LLM 多模态接口成功返回 `message.content`（JSON 字符串）。
3. 服务端解析出总结段落用于生成文档，同时把原始 content 原文与本次实际使用模型写入该资源 `ai_summary_task` 记录的 `raw_response` / `model_name`。
4. 用户进入 AI 总结任务列表页，可看到该记录"模型"列展示本次模型名。
5. 若该资源再次触发总结，认领开始时旧 `raw_response` / `model_name` 被清空；成功后再写入本次结果。

### Flow 2: 列表页重新总结

1. 用户进入 AI 总结任务列表页，某条 `completed` 或 `failed` 记录行"操作"列显示"重新总结"按钮。
2. 用户点击"重新总结"。
3. 前端调用 `POST /api/summary-tasks/:id/retrigger`。
4. 服务端校验：记录存在、非进行中；按资源找到对应成功下载任务后复用 `AnalysisTriggerService.trigger`（原子认领 + 低清恢复 + 分析）。
5. 前端重新加载列表，该记录状态变为 `pending` / `analyzing`。
6. `pending` / `analyzing` 行"重新总结"与"删除"按钮均为禁用态。

## API Contract

### 新增：`POST /api/summary-tasks/:id/retrigger`

- `id` 必须为正整数；非法 id 返回 HTTP 400（`无效的任务 ID`）。
- 记录不存在返回 HTTP 404（`AI 总结任务不存在`）。
- 记录处于 `pending` / `analyzing` 返回 HTTP 409（`进行中的 AI 总结不可重新触发`）。
- 按记录资源（bvid+cid）找不到下载任务返回 HTTP 409（`无对应的下载任务，无法重新总结`）。
- 对应下载任务状态不是 `success` 返回 HTTP 409（`仅已完成下载任务可触发 AI 总结`）。
- 成功返回 HTTP 200：`{ "message": "AI 总结触发中" }`。
- 行为：复用现有 `AnalysisTriggerService.trigger` 链路，不新增第二套分析编排；触发前将该下载任务 `auto_summary` 置 1（与 `POST /api/tasks/:id/summary` 一致）。

## Acceptance Criteria

- [ ] `ai_summary_task` 数据库表新增 `raw_response`、`model_name` 两列；既有数据库幂等迁移成功。
- [ ] AI 总结成功后，`ai_summary_task.raw_response` 保存模型返回的 content 原文、`model_name` 保存实际使用模型名。
- [ ] `GET /api/summary-tasks` 返回 `modelName`，不返回 `rawResponse`。
- [ ] 重新认领（再次触发）时旧 `raw_response` / `model_name` 被清空；成功后写入本次结果。
- [ ] AI 总结任务列表页展示"模型"列。
- [ ] AI 总结任务列表页 `completed` / `failed` 记录显示可点击的"重新总结"按钮；`pending` / `analyzing` 禁用。
- [ ] 点击"重新总结"调用 `POST /api/summary-tasks/:id/retrigger`，成功后列表刷新、状态进入进行中。
- [ ] `POST /api/summary-tasks/:id/retrigger`：非法 id → 400；不存在 → 404；进行中 → 409；无对应成功下载任务 → 409。
- [ ] 重新总结复用现有 `AnalysisTriggerService.trigger` 链路，不新增分析编排。
- [ ] `pnpm typecheck`、`pnpm build` 通过。

## Open Questions

- 无（记录粒度、模型列展示已由用户确认；重跑 stale 语义与 `execution_timing` 一致，沿用既有决策）。

## 补充：AI 总结表格查看模型原始返回（2026-08-12 追加）

### Goal

AI 总结任务列表页为每条记录提供"查看原始"按钮，点击后弹窗展示本次大模型调用成功返回的原始内容（`raw_response`）。

### 说明

- 原始返回已在 `ai_summary_task.raw_response` 入库（本需求前半部分），此处仅补充查看入口。
- 列表响应继续不携带 `rawResponse`（避免载荷膨胀），原始内容通过单条详情接口按需获取。

### 新增 API

`GET /api/summary-tasks/:id/raw-response`

- `id` 必须为正整数；非法 id 返回 HTTP 400（`无效的任务 ID`）。
- 记录不存在返回 HTTP 404（`AI 总结任务不存在`）。
- 成功返回 HTTP 200：`{ "rawResponse": "<模型返回的 content 原文>" | null }`（`pending`/`analyzing`/失败或历史无记录时为 `null`）。

### 前端

- `AiSummaryTasks.vue` 操作列新增"查看原始"按钮，点击后调用该接口并以 Dialog 弹窗展示原始内容；无原始返回时显示提示文案。

### 补充 2：模型调用报错时错误信息也作为返回记录（2026-08-12 追加）

- 分析失败（含模型调用报错）落 `failed` 时，把错误信息同时写入 `raw_response`（与 `error_message` 一致），作为本次执行的"返回记录"。
- `GET /api/summary-tasks/:id/raw-response` 对失败记录返回该错误信息；前端"查看原始"弹窗展示之；弹窗在无 `rawResponse` 但记录存在 `errorMessage` 时（历史/对账记录）回退展示错误信息并提示"本次无模型原始返回"。

### Acceptance Criteria

- [ ] `GET /api/summary-tasks/:id/raw-response` 对含 `raw_response` 的记录返回原始内容，对空记录返回 `null`；非法 id → 400、不存在 → 404。
- [ ] AI 总结任务列表页每条记录有"查看原始"按钮，点击后弹窗展示本次模型原始返回。
- [ ] 分析失败（含模型调用报错）后，`raw_response` 保存错误信息，"查看原始"可查看该错误信息。
- [ ] `pnpm typecheck`、`pnpm build` 通过。
