# 2026-08-17 AI 总结自定义提示词（Prompt）

## Source

- Owner Doc: `docs/design/app-overview.md`
- Related Requirement: `docs/requirements/2026-08-12-ai-summary-raw-record-and-retrigger.md`
- Related Requirement: `docs/requirements/2026-08-03-download-task-list-ai-summary.md`
- Live Baseline: `packages/server/src/analysis/analysis-engine.ts`（`buildAnalysisSystemPrompt()` 硬编码）、`packages/server/src/analysis/analysis-trigger.service.ts`、`packages/server/src/analysis/analysis.controller.ts`、`packages/server/src/database/database.service.ts`、`packages/frontend/src/pages/Downloading.tsx`、`packages/frontend/src/pages/ParseResultList.tsx`、`packages/frontend/src/api/index.ts`

## Problem

1. AI 分析使用的 system prompt 在 `analysis-engine.ts` 的 `buildAnalysisSystemPrompt()` 中写死，用户无法按视频类型定制分析指令。
2. 批量/单个触发 AI 总结时，没有任何入口让用户选择提示词。

## Goal

- 提示词配置下沉到前端：用户在界面上创建、编辑、删除自己的提示词。
- 触发 AI 总结时可为视频（单个或整批）选择提示词。
- 单个触发提供默认选中项；支持把某提示词设为系统默认，或绑定到某个创作者（up 主）。

## 已确认的产品决策（用户确认，2026-08-17）

1. JSON 结构约束（summary/title/content/timestamp/frameDescription 格式）从分析指令中独立出来，作为一段可一键插入的"格式要求片段"。用户主要编辑"分析指令"，可把格式片段插入到自己的提示词中；最终使用的 prompt = 用户自定义内容的完整原文。
2. 新增专门的表存储提示词；表中第一条为当前代码里硬编码的提示词，作为系统内置提示词，**不可删除、不可编辑**，初始为系统默认提示词。
3. 用户选择提示词时，可勾选"设为默认提示词"（系统级默认）；也可勾选"应用到该创作者"，下次该创作者（按 mid）的视频加入 AI 总结队列时忽略系统默认、直接使用创作者绑定提示词。

## In Scope

- 新增 `ai_prompt` 表（id、name、content、is_system、is_default、created_at、updated_at），幂等建表 + 空表时播种内置提示词。
- 新增 `ai_prompt_creator` 表（mid 唯一 → prompt_id）保存创作者绑定。
- `task` 表新增 `prompt_id`（下载任务显式选中的提示词，用于下载完成后自动总结）；`ai_summary_task` 新增 `prompt_id`（本次执行实际使用的提示词，认领时写入）。
- 后端提示词管理 API：列表/创建/编辑/删除/设为默认；系统内置提示词拒绝编辑与删除；删除默认提示词时默认回落到内置提示词。
- `GET /api/analysis/prompts/format-snippet`：返回 JSON 格式要求片段（服务端单一来源，前端"一键插入"）。
- 触发链路透传 prompt：`POST /api/tasks/:id/summary`、`POST /api/analysis/trigger` 接受可选 `promptId`；`POST /api/download`（DownloadDto）接受可选 `promptId`；`POST /api/summary-tasks/:id/retrigger` 复用 `ai_summary_task.prompt_id`。
- 提示词解析优先级（触发时）：显式 `promptId` → 下载任务 `prompt_id` → 创作者绑定（按视频 mid 查 `ai_prompt_creator`）→ 系统默认提示词 → 内置提示词兜底。
- `AnalysisEngine` 改用传入的 `systemPrompt`；未传入时回退内置提示词内容。`POST /api/analysis/run` 也按默认提示词解析（保持一致）。
- 前端提示词管理页（独立路由 `/prompts`）：列表、创建、编辑、删除、设为默认、编辑时"一键插入格式要求片段"。
- 下载任务页（Downloading）"立刻/重新 AI 总结"弹窗：提示词选择器（默认选中系统默认）、"设为默认提示词"与"应用到该创作者"勾选。
- 解析结果列表（ParseResultList）"加入待下载"弹框：整批提示词选择器（默认选中系统默认），选中后写入该批每个下载任务的 `prompt_id`。

## Out Of Scope

- 不校验用户自定义提示词是否包含 JSON 格式要求（格式错误导致分析失败属用户责任，仅日志记录）。
- 不给 ParseResultList"一键 AI 总结"新增选择弹窗（该入口沿用解析链路：任务 prompt_id → 创作者绑定 → 系统默认）。
- 不改动 `AnalysisEngine` 的 JSON 解析/截图/Markdown 生成逻辑，仅替换 system prompt 来源。
- 不删除任务时级联清理提示词关联；提示词删除后，已引用它的任务/总结记录保留 `prompt_id` 数字值（下次解析找不到时回落到默认）。
- 不做提示词模板市场/导入导出。
- 不为创作者绑定提供可视化管理页（仅在选择弹窗中勾选绑定；解绑通过再次绑定或人工维护）。单个视频弹窗内提供"解除该创作者绑定"入口。

## User Flows

### Flow 1: 管理提示词

1. 用户进入"AI 提示词"页，看到提示词列表（内置提示词只读，标注"系统内置"与"默认"）。
2. 用户点击"新建提示词"，填写名称与内容，可点击"插入格式要求"按钮把 JSON 格式片段插入光标处。
3. 保存后出现在列表中；可设为默认、编辑或删除（内置项不可编辑/删除）。

### Flow 2: 单个视频触发 AI 总结时选择提示词

1. 用户在下载任务页点击已完成任务的"立刻/重新 AI 总结"。
2. 弹窗展示提示词选择器，默认选中系统默认提示词（若该视频创作者有绑定则默认选中绑定提示词）。
3. 用户选择提示词，可勾选"设为默认提示词"或"应用到该创作者（mid）"。
4. 点击确认，调用 `POST /api/tasks/:id/summary`（带 `promptId`），任务进入 AI 总结流程并使用所选提示词。

### Flow 3: 批量加入 AI 总结时选择同一提示词

1. 用户在解析结果列表勾选多个视频，点击"加入待下载"。
2. 下载子目录弹框中出现"AI 总结提示词"选择器（默认系统默认），选中后对该批所有开启 AI 总结开关的任务生效。
3. 确认后每个下载任务写入 `prompt_id`；下载完成自动触发总结时使用该提示词。

### Flow 4: 创作者绑定生效

1. 用户在某视频的 AI 总结弹窗中勾选"应用到该创作者"，该视频的 up 主 mid 与所选提示词绑定。
2. 之后该创作者的其他视频（未显式选择提示词）加入 AI 总结队列时，忽略系统默认、使用绑定提示词。

## API Contract

### 提示词管理（新增，全部在 `api/analysis` 下）

- `GET /api/analysis/prompts` → `{ items: [{ id, name, content, isSystem, isDefault, createdAt, updatedAt }] }`，按 `createdAt` 升序（内置提示词排最前）。
- `POST /api/analysis/prompts` body `{ name, content }` → 201 返回创建的提示词；name/content 为空返回 400。
- `PUT /api/analysis/prompts/:id` body `{ name?, content? }` → 返回更新后提示词；非法 id 400、不存在 404、`is_system` 记录 409（`系统内置提示词不可编辑`）。
- `DELETE /api/analysis/prompts/:id` → 非法 id 400、不存在 404、`is_system` 记录 409（`系统内置提示词不可删除`）；若删除的是默认提示词，自动把默认设为内置提示词。
- `PUT /api/analysis/prompts/:id/default` → 设为系统默认（清空其他记录 is_default）；非法 id 400、不存在 404。
- `GET /api/analysis/prompts/format-snippet` → `{ snippet }`（JSON 格式要求片段，服务端单一来源）。
- `GET /api/analysis/prompts/creator?mid=<number>` → `{ mid, promptId } | null`；mid 非法返回 400。
- `PUT /api/analysis/prompts/creator` body `{ mid, promptId }` → upsert 绑定。
- `DELETE /api/analysis/prompts/creator?mid=<number>` → 解除绑定（不存在也返回成功）。

### 触发端点透传 promptId

- `POST /api/tasks/:id/summary` body `{ promptId? }` → 透传 trigger；promptId 非正整数返回 400。
- `POST /api/analysis/trigger` body `{ bvid, cid, promptId? }` → 透传 trigger；无任务且创建下载任务时写入 `prompt_id`。
- `POST /api/download`（DownloadDto 增 `promptId?`）→ 写入 task.prompt_id。
- `POST /api/summary-tasks/:id/retrigger` → 复用该记录 `prompt_id` 作为显式 promptId。
- `GET /api/summary-tasks` / `GET /api/summary-tasks/:id` 视图含 `promptId`（供前端展示与重试）。

### 分析接口

- `POST /api/analysis/run` body 增可选 `promptId` → 未传时按"默认提示词"解析。

## Business Rules

- 系统内置提示词：`is_system=1`，不可编辑、不可删除；空表时播种，幂等。
- 系统默认提示词：`is_default=1` 至多一条；删除默认（非内置）后默认回落到内置提示词。
- 提示词解析优先级：显式 promptId → task.prompt_id → 创作者绑定 → 系统默认 → 内置内容兜底。任一层引用的提示词不存在（已删除）则跳过该层继续向下。
- 创作者绑定按 mid 唯一；后写覆盖先写。

## Edge Cases

- 提示词被删除后：已引用它的任务/总结记录 `prompt_id` 保留数字值，下次解析找不到时按优先级向下回落。
- 解析 mid 失败（B 站接口异常）时跳过创作者绑定层，直接回落到默认。
- 默认提示词被删除（非内置）：自动重置默认到内置提示词。
- 批量中加入队列的任务若未开启 AI 总结开关，`prompt_id` 依然写入但不影响任何分析。
- 无任何提示词（空库、极端情况）：引擎回退内置提示词内容，行为与现状一致。

## Open Questions

- 无（已由用户确认核心决策；创作者绑定入口范围与批量绑定范围按本需求 In Scope 明确）。

## Acceptance Criteria

- [ ] `ai_prompt` / `ai_prompt_creator` 表建表幂等；空库启动自动播种内置提示词（内容与当前硬编码一致），`is_system=1`、`is_default=1`。
- [ ] `task` / `ai_summary_task` 新增 `prompt_id` 列，既有库幂等迁移成功。
- [ ] 提示词 CRUD 与默认/格式片段/创作者绑定 API 契约全部按上文实现；系统内置提示词编辑/删除返回 409。
- [ ] 提示词解析优先级正确：显式 → task → 创作者绑定 → 系统默认 → 内置兜底。
- [ ] 单个触发（下载任务页）弹窗默认选中系统默认；勾选"设为默认/应用到创作者"生效。
- [ ] 批量加入（解析结果列表）弹框为整批选择提示词，任务写入 `prompt_id`。
- [ ] 下载完成自动总结、立即总结、重试总结均使用对应提示词；`ai_summary_task.prompt_id` 记录本次实际使用提示词。
- [ ] `POST /api/analysis/run` 未传 promptId 时按系统默认解析。
- [ ] 前端提示词管理页可创建/编辑/删除/设默认/一键插入格式片段；内置项只读。
- [ ] `pnpm typecheck`、`pnpm build` 通过。