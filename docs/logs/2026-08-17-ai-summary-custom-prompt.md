# 2026-08-17 AI 总结自定义提示词（Prompt）

## 变更摘要

AI 总结的 system prompt 从 `analysis-engine.ts` 硬编码改为前端可管理（创建/编辑/删除/设默认），并支持用户在单个触发（下载任务页）与批量触发（解析结果列表加入待下载）时选择提示词；触发链路按"显式 → task.prompt_id → 创作者绑定（按 mid）→ 系统默认 → 内置兜底"解析，并把实际使用的提示词写入 `ai_summary_task.prompt_id`。

来源：`docs/requirements/2026-08-17-ai-summary-custom-prompt.md`；计划：`docs/plans/2026-08-17-ai-summary-custom-prompt-plan.md`；测试方向：`docs/testing/2026/08-17-ai-summary-custom-prompt.md`。

## server 变更

- **新增 `analysis/prompt-template.ts`**：`BUILTIN_AI_PROMPT_NAME` / `BUILTIN_AI_PROMPT_CONTENT`（拆分为指令部分 + `AI_PROMPT_FORMAT_SNIPPET` 格式片段；完整内容与旧硬编码逐字一致）。
- **新增 `analysis/prompt.service.ts`**：提示词 CRUD（内置拒绝编辑/删除）、设默认（唯一默认）、删除默认自动回落内置、格式片段、创作者绑定（mid 唯一，后写覆盖）、`resolveForRun`（显式 → 系统默认 → 空，供 `/analysis/run` 使用）。
- **`database/database.service.ts`**：新建 `ai_prompt` / `ai_prompt_creator` 表；空表播种内置（is_system=1, is_default=1，幂等）；`task` / `ai_summary_task` 幂等 ALTER 加 `prompt_id`；相关 SELECT/INSERT/更新与 `claimAiSummaryTask` / `upsertAiSummaryTask` 支持 prompt_id（upsert 未提供时保留既有值）。
- **`analysis/analysis-engine.ts`**：`AnalysisInput.systemPrompt?`；`analyze()` 用 `input.systemPrompt ?? BUILTIN_AI_PROMPT_CONTENT`（未传回退内置，行为与旧版一致）；移除硬编码 `buildAnalysisSystemPrompt()`。
- **`analysis/analysis-trigger.service.ts`**：`trigger(taskId, options?: { promptId? })`；新增 `resolvePromptId(task, explicit?)`（显式 → task.prompt_id → 创作者绑定[`getVideoInfo` 解析 mid，失败跳过] → 系统默认 → undefined 由引擎兜底）；认领时写入解析出的 prompt_id；`runAnalysis` 按记录的 prompt_id 取内容传入 `systemPrompt`。
- **`analysis/analysis.controller.ts`**：`POST /analysis/run` 接受可选 `promptId` 并按默认解析（日志记录实际使用的 promptId/promptName）；`POST /analysis/trigger` 接受可选 `promptId`（无任务时写入新建任务，有任务时透传 trigger）。
- **`analysis/analysis-task.controller.ts`**：`POST /tasks/:id/summary` 接受 body `{promptId?}`（400 校验，不覆盖 task.prompt_id）；summaries 视图含 `promptId`；retrigger 复用记录 prompt_id。
- **`download/download.dto.ts` / `download.service.ts`**：`DownloadDto.promptId?` → `insertTask` 写 `task.prompt_id`（下载完成自动总结时使用）。
- **`analysis/prompt.controller.ts`**（新增）：`/api/analysis/prompts` CRUD + `/:id/default` + `/format-snippet` + `/creator` 绑定端点；字面路由先于 `:id` 参数路由声明避免捕获。
- **`logging/server-log.util.ts`**：SAFE_LOG_KEYS 增 `promptId` / `promptName` / `isDefault` / `isSystem` / `explicitPromptId` / `hasCustomSystemPrompt`。
- **`analysis/analysis.module.ts` / `index.ts`**：注册并导出 `PromptController` / `PromptService`。

实现期修正记录：`POST /tasks/:id/summary` 与 `POST /api/analysis/trigger`（已有任务分支）**不**把显式 promptId 写入 `task.prompt_id`——任务创建时设定的提示词应保持独立，以免显式值覆盖后破坏"显式 → task → ..."优先级；task.prompt_id 仅在 `POST /api/download` 创建任务时写入。

## frontend 变更

- **`api/index.ts`**：提示词管理/格式片段/创作者绑定方法；`createDownload`、`triggerTaskAiSummary(taskId, promptId?)`、`triggerAiSummary` 支持 promptId。
- **`types/index.ts`**：`AiPrompt`、`PromptCreatorBinding`；`AiSummaryTaskEntry.promptId`。
- **`pages/PromptManager.tsx`**（新增）+ 路由 `/prompts` + 导航"AI 提示词"：列表（内置项只读禁用）、新建/编辑 Modal（"插入格式要求"光标插入）、删除确认、设为默认。
- **`pages/Downloading.tsx`**：完成任务"立刻/重新 AI 总结"打开提示词选择 Modal（默认系统默认，有创作者绑定则选中绑定；"设为默认提示词"、"应用到该创作者"勾选、绑定提示与解除入口）→ 确认后调用带 promptId 的接口。
- **`pages/ParseResultList.tsx`**："确认下载子目录"弹框新增"AI 总结提示词"选择器（默认系统默认），整批任务写入 `prompt_id`。

## 文档

- `docs/design/app-overview.md`：Integration Points 新增提示词 API 与各触发端点 promptId 透传说明。
- `docs/context/project-context.md`：active requirement 切换为本需求。

## 验证

- `pnpm typecheck`（根，全部 workspace）通过；`pnpm build`（根）通过。
- API/DB 冒烟（临时 OUTPUT_DIR、一次性脚本 `$TEMP/opencode/prompt-smoke/smoke-prompt.cjs` 未入库）：53/53 PASS——建表/播种/迁移幂等、提示词 CRUD 与错误码、默认唯一与回落、格式片段一致性、创作者绑定 CRUD、task.prompt_id 落库、优先级解析（显式/显式删除回落/任务默认/任务删除回落系统默认/删除默认回落内置）、summary 认领记录 prompt_id、retrigger 复用、`/analysis/run` 默认解析日志断言。
- 受限说明：创作者绑定命中路径依赖 B 站 mid 解析（真实网络），冒烟仅覆盖"解析失败跳过该层"路径；绑定内容的真实生效留待人工运行级确认。

## 审计

- 计划审计：cold-replay proxy（reviewer availability = none，非保护/非高风险计划），计划文件内已记录。
- 关闭审计：cold-replay proxy，证据已写入计划文件 Closure 节（含实现期修正记录与受限说明）。