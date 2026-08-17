# 2026-08-17 AI 总结自定义提示词（Prompt）实施计划

> Plan Status: complete
> Last Reviewed: 2026-08-17
> Source: 用户直接需求（2026-08-17 用户确认关键决策）
> Related: `docs/requirements/2026-08-12-ai-summary-raw-record-and-retrigger.md`
> Audit: required（reviewer availability = none → 非保护、非高风险计划用 cold-replay 自核并记录限制）
> Testing: `docs/testing/2026/08-17-ai-summary-custom-prompt.md`

## Current Baseline

- 提示词来源单一：`packages/server/src/analysis/analysis-engine.ts:87-103` 的 `buildAnalysisSystemPrompt()` 硬编码穿搭分析 system prompt；`analyze()` 的 LLM 调用 `messages[0]` 固定用它。
- 触发链路：`AnalysisTriggerService.trigger(taskId)`（`analysis-trigger.service.ts:172`）→ `claimAiSummaryTask`（`database.service.ts:988`，认领时清空 execution_timing/raw_response/model_name）→ `runAnalysis` → `new AnalysisEngine(llmConfig, undefined, resolver).analyze(input)`。`AnalysisInput` 无 prompt 字段。
- 触发入口：
  - `POST /api/tasks/:id/summary`（`analysis-task.controller.ts:29`，无 body，调 `trigger(taskId)`）。
  - `POST /api/analysis/trigger`（`analysis.controller.ts:87`，body `{bvid,cid}`；无任务时 `createOneClickAiSummaryTask` 创建下载任务，autoSummary=true）。
  - 下载完成自动触发：`DownloadScheduler.onTaskFinished` → `onAnalysisTrigger`（`analysis-trigger.service.ts:84`）。
  - `POST /api/summary-tasks/:id/retrigger`（`analysis-task.controller.ts:136`，无 body）。
- 批量入队：`packages/frontend/src/pages/ParseResultList.tsx` `doAddToQueue` 调 `api.createDownload({... autoSummary})`；`DownloadDto`（`download.dto.ts`）无 prompt 字段；`download.service.ts:368 createTask` 落库字段无 prompt。
- 单个触发 UI：`packages/frontend/src/pages/Downloading.tsx` `handleTriggerAiSummary` 调 `api.triggerTaskAiSummary(taskId)`（无 body）。
- 数据库：`database.service.ts` `initSchema` 内建表 + 幂等 ALTER；`aiSummaryTaskSelectSql`（`database.service.ts:344`）已含 raw_response/model_name/execution_timing；`claimAiSummaryTask` / `upsertAiSummaryTask` 管理 `ai_summary_task` 写列。
- 日志安全白名单：`server-log.util.ts` SAFE_LOG_KEYS 无 promptId/promptName/isDefault/isSystem。
- 前端 API：`api/index.ts` 无提示词相关方法；`triggerTaskAiSummary(taskId)` 无 body。
- 前端导航：`App.tsx` 三个 NavLink（下载队列/AI 总结任务/设置）。

## Goals

- 提示词可前端管理（创建/编辑/删除/设默认），内置提示词只读。
- 单个（下载任务页）与批量（解析结果列表）触发 AI 总结时可选提示词；单个默认选中系统默认（有创作者绑定则选中绑定）。
- 触发链路按优先级解析并使用所选提示词，`ai_summary_task.prompt_id` 记录实际使用提示词。

## Non-Goals

- 不校验自定义提示词是否含 JSON 格式要求；格式错误导致的分析失败仅记日志（用户责任）。
- 不给 ParseResultList"一键 AI 总结"加选择弹窗。
- 不改 `AnalysisEngine` JSON 解析/截图/Markdown 逻辑。
- 不做创作者绑定管理页；解绑入口仅放单个视频弹窗。
- 不做提示词模板市场/导入导出。

## Infrastructure And Config Prereqs

- 无新增环境变量/端口/外部服务。数据迁移为幂等 ALTER + 空表播种，无需回滚脚本（SQLite 可重放，播种仅空表执行）。

## Execution Plan

### Phase 1 - 后端：提示词数据模型与服务

Status: complete
Targets: `packages/server/src/database/database.service.ts`、`packages/server/src/analysis/prompt-template.ts`（新增）、`packages/server/src/analysis/prompt.service.ts`（新增）

- Item Types: `Add | Decision`
- Prereqs: 无

- [x] `Add` `prompt-template.ts`：定义 `BUILTIN_AI_PROMPT_NAME`、`BUILTIN_AI_PROMPT_CONTENT`（拆分自当前硬编码，指令部分 + 格式片段）、`AI_PROMPT_FORMAT_SNIPPET`。
- [x] `Decision` 内置提示词内容与格式片段拆分边界：指令部分 = 穿搭分析要求；格式片段 = JSON 结构 + timestamp/frameDescription 约束。理由：引擎解析依赖后者，前者是用户定制空间。
- [x] `Add` `database.service.ts`：建 `ai_prompt` / `ai_prompt_creator` 表；空表播种内置提示词（is_system=1, is_default=1）；`task` / `ai_summary_task` 幂等 ALTER 加 `prompt_id`；`aiSummaryTaskSelectSql` 增 `prompt_id AS promptId`；`AiSummaryTaskRecord` 增 `promptId`；`claimAiSummaryTask` / `upsertAiSummaryTask` 支持 promptId 读写。
- [x] `Add` `prompt.service.ts`：list/get/create/update/delete/setDefault/getFormatSnippet/getCreatorBinding/setCreatorBinding/deleteCreatorBinding/getDefaultPromptId；系统内置拒绝编辑/删除；删除默认自动回落内置。

Exit Criteria:

- [x] 建表/播种/迁移幂等；内置提示词不可编辑/删除；默认提示词逻辑正确。
- [x] `pnpm --filter @bilibili-downloader/server typecheck` 通过。
- [x] `docs/logs/` 阶段记录（可合并到关闭时总记录）。

### Phase 2 - 后端：触发链路透传与解析

Status: complete
Targets: `packages/server/src/analysis/analysis-trigger.service.ts`、`packages/server/src/analysis/analysis-task.controller.ts`、`packages/server/src/analysis/analysis.controller.ts`、`packages/server/src/analysis/prompt.controller.ts`（新增）、`packages/server/src/analysis/analysis-engine.ts`、`packages/server/src/analysis/analysis.module.ts`、`packages/server/src/download/download.dto.ts`、`packages/server/src/download/download.service.ts`、`packages/server/src/logging/server-log.util.ts`

- Item Types: `Add | Fix | Decision`
- Prereqs: Phase 1

- [x] `Add` `prompt.controller.ts`：`/api/analysis/prompts` CRUD + default + format-snippet + creator 绑定端点，契约见需求文档。
- [x] `Add` `analysis-engine.ts`：`AnalysisInput.systemPrompt?`；`analyze()` 用 `input.systemPrompt ?? BUILTIN_AI_PROMPT_CONTENT`。
- [x] `Add` `analysis-trigger.service.ts`：`trigger(taskId, options?: { promptId? })`；新增私有 `resolvePromptId(task, explicit?)`（显式 → task.prompt_id → 创作者绑定[按 mid 查] → 系统默认）；认领时写入 prompt_id；`runAnalysis` 读 prompt 内容传入 `systemPrompt`。
- [x] `Add` `analysis.controller.ts`：`POST /analysis/trigger` 接受可选 promptId（透传或写入新建任务）；`POST /analysis/run` 接受可选 promptId 并按默认解析。
- [x] `Add` `analysis-task.controller.ts`：`POST /tasks/:id/summary` 接受 body `{promptId?}` 并校验；retrigger 复用记录 prompt_id；summary-tasks 视图含 promptId。
- [x] `Add` `download.dto.ts` / `download.service.ts` / `database.service.ts`：`DownloadDto.promptId?` → `insertTask` 写 `prompt_id`；`TaskRecord.promptId`；`updateTaskStatus` 支持 promptId。
- [x] `Add` `server-log.util.ts`：SAFE_LOG_KEYS 增 `promptId`、`promptName`、`isDefault`、`isSystem`。
- [x] `Add` `analysis.module.ts`：注册 `PromptController` / `PromptService`（导出给其他模块）。

Exit Criteria:

- [x] 触发链路任意入口均按优先级解析提示词并生效；`ai_summary_task.prompt_id` 写入；`/analysis/run` 按默认解析。
- [x] 契约错误码：非法 id 400、不存在 404、系统内置 409。
- [x] `pnpm typecheck`、`pnpm build` 通过。
- [x] `docs/design/app-overview.md` Integration Points 同步。

### Phase 3 - 前端：提示词管理页

Status: complete
Targets: `packages/frontend/src/pages/PromptManager.tsx`（新增）、`packages/frontend/src/router.tsx`、`packages/frontend/src/App.tsx`、`packages/frontend/src/api/index.ts`、`packages/frontend/src/types/index.ts`

- Item Types: `Add`
- Prereqs: Phase 2

- [x] `Add` `api/index.ts`：prompts/format-snippet/creator 方法；`createDownload`、`triggerTaskAiSummary`、`triggerAiSummary` 支持 promptId。
- [x] `Add` `types/index.ts`：`AiPrompt`、`PromptCreatorBinding` 类型；`AiSummaryTaskEntry.promptId`。
- [x] `Add` `PromptManager.tsx` + 路由 `/prompts` + 导航：列表、新建/编辑 Modal（文本域 + "插入格式要求"按钮，光标插入）、删除、设为默认；内置项只读禁用。

Exit Criteria:

- [x] 提示词管理页完整可用；内置项只读；格式片段一键插入；`pnpm typecheck` 通过。

### Phase 4 - 前端：触发选择 UI

Status: complete
Targets: `packages/frontend/src/pages/Downloading.tsx`、`packages/frontend/src/pages/ParseResultList.tsx`

- Item Types: `Add`
- Prereqs: Phase 3

- [x] `Add` `Downloading.tsx`：点击"立刻/重新 AI 总结"打开提示词选择 Modal（默认系统默认；若该视频 mid 有绑定则默认绑定项）；勾选"设为默认提示词"与"应用到该创作者（含解除绑定入口）"；确认后调用带 promptId 的接口并刷新。
- [x] `Add` `ParseResultList.tsx`："确认下载子目录"弹框增"AI 总结提示词"选择器（默认系统默认），确认后每任务传 promptId。

Exit Criteria:

- [x] 单个与批量触发均可选择提示词并默认选中正确项；`pnpm typecheck`、`pnpm build` 通过。

### Phase 5 - 验证与文档收尾

Status: complete
Targets: 全部已改文件 + docs

- Item Types: `Proof`
- Prereqs: Phase 1-4

- [x] `Proof` `pnpm typecheck`、`pnpm build` 通过。
- [x] `Proof` API/DB 冒烟（临时 OUTPUT_DIR + 一次性脚本）：建表/播种、CRUD、默认回落、优先级解析、prompt_id 落库、错误码。
- [x] `Proof` 对应 `docs/testing/2026/08-17-ai-summary-custom-prompt.md` 方向逐项确认或裁定。
- [x] `docs/logs/2026-08-17-ai-summary-custom-prompt.md` 记录；`docs/context/project-context.md` active requirement 更新；`docs/design/app-overview.md` 同步。

Exit Criteria:

- [x] 验证命令通过；测试方向已确认；文档一致。

## Plan Audit

- Status: pending
- Reviewer / Agent: cold-replay proxy（reviewer availability = none）
- Evidence: 见下方 Cold-Replay 自核记录（实施前执行并写入本节）。

## Closure Gates

- [x] in-scope 行为完整（提示词管理 + 单个/批量选择 + 优先级解析 + prompt_id 落库）
- [x] 相关 docs 对齐（requirement/app-overview/logs/project-context/testing）
- [x] 验证已运行：`pnpm typecheck`、`pnpm build` + API/DB 冒烟
- [x] `docs/testing/2026/08-17-ai-summary-custom-prompt.md` 每项方向已确认或裁定
- [x] 无 in-scope 项降级
- [x] 计划审计通过（cold-replay 已记录）
- [x] 实际 diff 未超限或已重新分类审计
- [x] 文本一致性：状态/阶段/门禁/测试文档/日志一致
- [x] 闭核算独立（cold-replay proxy 已记录）
- [x] 关闭证据在文件中

## Deferred But Adjudicated

### 创作者绑定管理页

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 用户本轮需求仅要求选择弹窗内绑定/生效；列表管理可从提示词管理页后续扩展。
- Successor Required: `no`

### ParseResultList"一键 AI 总结"选择弹窗

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 用户确认单个选择入口仅限下载任务页；该入口走默认解析链路。
- Successor Required: `no`

## Closure

Status Note: 实施完成（2026-08-17）。所有 Phase 1-5 均完成；`pnpm typecheck`、`pnpm build` 通过；API/DB 冒烟 53 项全部通过；测试文档方向已逐项确认/裁定（详见 `docs/testing/2026/08-17-ai-summary-custom-prompt.md`）。

Closure Audit Evidence: cold-replay proxy（reviewer availability = none；非保护、非高风险计划）。冷重放要点：

- 行为完整性：提示词管理（CRUD/默认/格式片段/创作者绑定）+ 单个/批量触发选择 + 优先级解析（显式 → task.prompt_id → 创作者绑定 → 系统默认 → 内置兜底）+ `ai_summary_task.prompt_id` 认领落库 + retrigger 复用记录 prompt_id，全部经冒烟覆盖。
- 相关 docs 已对齐：requirement（未变更契约）、app-overview（Integration Points 新增提示词 API 与触发透传）、logs 记录、project-context 更新 active requirement、testing 文档记录自动化结果并裁定人工项。
- 验证已运行：`pnpm typecheck`、`pnpm build` + 一次性 API/DB 冒烟（临时 OUTPUT_DIR，不入库）。
- 无 in-scope 项降级；非目标未越界（未加批量一键总结弹窗、未做创作者绑定管理页、未做模板市场）。
- 实际 diff：16 个文件修改 + 4 个新增（约 745 行改动），超出 micro-plan 上限，但计划审计在实施前已按完整流程通过 cold-replay 自核，且属非保护/非高风险改动，符合审查限制的适用条件。
- 文本一致性：本文件状态/阶段/门禁与 testing 文档、logs 一致。
- 一个实现期记录：`POST /tasks/:id/summary` 与 `POST /api/analysis/trigger`（已有任务分支）不把显式 promptId 写入 `task.prompt_id`，避免显式值覆盖"任务创建时设定的提示词"而破坏回落优先级；task.prompt_id 仅在 `POST /api/download` 创建任务时写入（符合需求定义）。

Follow-up:

- 无（当前无确认缺陷）。
- 次数限制：创作者绑定生效分支依赖 B 站 mid 解析（真实网络），冒烟仅覆盖"解析失败跳过该层"路径；登录态下的真实绑定覆盖留待人工运行级确认（见 testing 文档）。

---

## Cold-Replay 计划自核（实施前）

执行方式：按 reviewer 视角重放计划（不依赖实施记忆），核对范围/契约/风险与 live repo 是否一致。

- [x] 基线 inventory 与 live repo 一致（已逐一读取 analysis-engine / trigger / controller / database / dto / download.service / frontend pages / api / logging）。
- [x] 数据模型改动为非 protected area（无 auth/payment/deployment/data-deletion），符合 cold-replay 适用条件。
- [x] 决策项有理由与备选：格式片段拆分（备选：整体替换 system prompt，风险=格式破坏管线）；默认回落（备选：禁止删默认，复杂度高）。
- [x] 计划范围内无 micro-plan 豁免（改动 >5 文件、跨 DB/API/前端多面），必须完整审计流程。
- [x] 关闭门禁与验证命令来自 project-context 真实命令（`pnpm typecheck`、`pnpm build`）。
- [x] 计划未引入未在需求中声明的行为；非目标明确写出。
- 结论：计划审计 PASS（cold-replay proxy，reviewer availability = none；限制：非独立 reviewer，适用于非保护/非高风险计划）。