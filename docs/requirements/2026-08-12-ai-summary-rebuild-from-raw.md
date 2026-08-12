# AI 总结"重新构建总结"（基于已存储的大模型返回内容重建报告与截图）— 需求文档

- 日期：2026-08-12
- 状态：已定稿（开放问题已于 2026-08-12 经用户确认）
- 来源：用户直接需求（2026-08-12）：在"查看 AI 总结原始记录"弹窗中增加"重新构建总结"按钮；点击后使用数据库中已存储的大模型返回内容，再次尝试生成总结报告以及截图
- 前置：`2026-08-12-ai-summary-raw-record-and-retrigger` 已落地（`raw_response` 存储、`/raw-response` 查看端点、`/retrigger` 全管线重跑）

## SDK/管线现状（事实基线）

- `ai_summary_task.raw_response` 语义：`completed` 记录 = LLM 返回的 content 原文（可解析 JSON，形如 `{summary:[{title,content,timestamp,frameDescription}]}`）；`failed` 记录 = 错误信息文本（不可构建）。
- 现有 `POST /api/summary-tasks/:id/retrigger` 走完整 `AnalysisTriggerService.trigger()` 管线：重新认领（会**清空** raw_response/model_name）、重新解析视频/字幕、**重新调用 LLM**。
- `AnalysisEngine.analyze()` 流程：解析字幕 → LLM 多模态分析 → 规范化 summary items → 按时间戳截图（`FfmpegScreenshot`）→ `generateMarkdown` 写 Markdown 报告。
- 截图与报告生成发生在 LLM 之后，**只需要视频文件与 LLM 返回内容**，不需要字幕、不需要低清 LLM 视频、不需要 LLM 调用。
- 视频截图源：下载任务记录的 `outputFile`（高清），`AnalysisTriggerService.resolveSummaryDir(task)` 决定 summary 输出目录。
- 前端"查看原始"弹窗（`AiSummaryTasks.vue` 的 `rawDialog*` 状态）已能展示任意记录的 rawResponse。

## Goal

在"查看原始"弹窗中为 `completed` 记录提供"重新构建总结"按钮：点击后**不重新调用 LLM**，使用 `ai_summary_task.raw_response` 中已存的大模型返回内容，重新生成总结报告（Markdown）与截图，异步执行。

## 已定决策（2026-08-12 用户确认）

1. **交互方式：异步**。点击按钮立即返回"重新构建已开始"，由用户手动刷新任务列表查看结果（与现有"重新总结"按钮一致，前端可自动重拉一次列表）。
2. **可用条件：仅 `completed` 记录**。`pending`/`analyzing`/`failed` 记录禁用（`failed` 的 raw_response 是错误文本，不可构建）。

## In Scope

### 1. AnalysisEngine 重构与 rebuild 能力（`packages/server/src/analysis/analysis-engine.ts`）

- 将 `analyze()` 中 LLM 之后的处理（规范化 items、按时间戳截图、生成 Markdown）抽取为共享私有方法，供 `analyze()` 与新增 `rebuild()` 复用；文档 `model` 字段改用实际 LLM 返回模型名（`analyze()` 一并修正此前用 llmConfig 默认值的偏差）。
- 新增 `rebuild(input, rawResponse, modelName)`：
  - `JSON.parse(rawResponse)` → 分析结果对象（解析失败抛明确错误）；
  - 规范化 summary items；空内容走空总结路径；
  - 截图循环 + 生成 Markdown（用传入的 `modelName`）。
  - 不创建/不使用 QwenClient（构造参数 `llmConfig` 改为可选，`rebuild` 路径无需 LLM 配置）。
  - 返回 `AnalysisOutput`（`llmMs` 为 0，`rawResponse`/`modelName` 原样透传）。

### 2. AnalysisTriggerService（`analysis-trigger.service.ts`）

- 新增 `rebuildSummaryTask(id)`：
  - 校验记录存在、`status === "completed"`、`rawResponse` 非空；
  - 经 `findLatestTaskByBvidAndCid` 定位下载任务，取 `outputFile`；文件不存在则抛"视频文件不存在，无法重新构建截图"；
  - 以 `outputFile` 同时作为截图源与回退视频路径，`resolveSummaryDir(task)` 作为 summary 目录，构造 `AnalysisInput`；
  - `new AnalysisEngine(undefined, ...)` 调 `rebuild()`（不依赖 LLM 配置）；
  - 成功后 `upsertAiSummaryTask` 写 `status=completed`、`summaryOutput`、`executionTiming`、`lastTriggeredAt`/`lastCompletedAt`；**保留** `rawResponse`/`modelName`（不传即保留，upsert 既有语义）；
  - 失败：服务端记错误日志，**不改写记录状态**（保持既有 completed 有效记录，非破坏性），供用户重试。
- 新增内存并发防抖 `rebuildingIds: Set<number>`，`tryStartRebuild(id)` 返回是否本次抢占成功，防止同一记录并发重复构建。

### 3. 新端点（`analysis-task.controller.ts`）

- 新增 `POST /api/summary-tasks/:id/rebuild`（`@HttpCode(200)`）：
  - 非法 id → 400 `无效的任务 ID`；
  - 记录不存在 → 404 `AI 总结任务不存在`；
  - 状态非 `completed` → 409 `仅已完成的 AI 总结可使用存储内容重新构建`；
  - `rawResponse` 为空 → 409 `无可用的大模型返回内容，无法重新构建`；
  - 并发防抖命中 → 409 `正在重新构建中`；
  - 否则 `void rebuildSummaryTask(id).catch(记日志)` 异步执行，返回 `{ message: "重新构建已开始" }`。

### 4. 前端（`packages/frontend/src/`）

- `api/index.ts`：新增 `rebuildAiSummaryTask(id): Promise<{ message: string }>` → `POST /summary-tasks/:id/rebuild`。
- `views/AiSummaryTasks.vue` 原始记录弹窗：
  - 弹窗记录当前任务（`rawDialogTask`）；
  - 弹窗内新增"重新构建总结"按钮，**仅 `rawDialogTask.status === "completed"` 时显示/可用**；
  - 点击后调 `rebuildAiSummaryTask`，成功显示提示"已开始重新构建总结，请刷新任务状态后查看"并重拉任务列表；失败在弹窗内展示错误。

### 5. 文档

- `docs/design/app-overview.md`：Integration Points 补充 `POST /api/summary-tasks/:id/rebuild`；`ai_summary_task` 记录字段说明补充"rebuild 使用 raw_response 重建报告与截图，不调用 LLM"。
- `docs/context/codebase-map.md`：视频分析路由行验证日期更新。
- `docs/logs/2026-08-12.md`：追加实施记录（或独立日志文件）。
- 新增 `docs/testing/2026/08-12-ai-summary-rebuild-from-raw-testing.md`。

## Out Of Scope

- 重新调用 LLM（那是现有 `/retrigger` 的职责）。
- 对 `pending`/`analyzing`/`failed` 记录重建（`failed` 的 raw_response 为错误文本，不可构建）。
- 字幕重新解析、低清 LLM 视频调度（重建不需要）。
- 保留多版本历史总结；修改删除/认领语义。
- 视频文件缺失时的降级构建（截图明确要求，文件缺失即报错）。

## Main User Flows

### 1. completed 记录重建成功

1. 用户在 AI 总结任务列表点击"查看原始"，弹窗展示该记录的模型原始返回。
2. 点击"重新构建总结"（仅 completed 显示）。
3. 服务端用已存 raw_response 重新截图并生成 Markdown 报告，写回 `summaryOutput`/`executionTiming`/`lastCompletedAt`，保留 raw_response/modelName。
4. 前端提示"已开始重新构建总结"，重拉列表；用户刷新后看到新的总结输出与时间。

### 2. 重建失败（视频文件缺失等）

1. 同上点击。
2. 服务端校验不通过（如 `outputFile` 已删除）→ 抛错并记日志，**记录保持 completed 原状**。
3. 前端重拉列表，记录未变（无破坏）；用户可再次尝试或走"重新总结"重跑全管线。

## Business Rules

- "重新构建"只使用 `raw_response` + 视频文件，不调用 LLM、不解析字幕、不调度低清下载。
- 仅 `completed` 且 `raw_response` 非空的记录可重建；重建后状态保持 `completed`。
- 重建不改变 `raw_response` / `model_name`；成功时刷新 `summary_output` / `execution_timing` / 时间戳。
- 重建失败不降级记录状态（非破坏性），仅服务端记录错误日志。
- 同一记录并发重建由内存防抖拒绝（409）。

## Roles / Permissions

- 无用户角色差异；不触及 auth/permissions、数据删除、支付、部署。

## Edge Cases

- `raw_response` 不是有效 JSON：抛"存储的原始返回不是有效 JSON，无法重新构建"（正常情况不可能，仅当 DB 被手动改写）。
- 存储内容为空总结（无有效 summary item）：走空总结文档路径，与 `analyze()` 一致。
- `outputFile` 缺失或已被删除：重建失败并给出明确错误，不写任何记录变化。
- 下载任务记录已被删除：`findLatestTaskByBvidAndCid` 找不到 → 重建失败，提示"无对应的下载任务，无法重新构建"。
- 重建期间用户再次点击：409 防抖。
- 重建期间记录被删除：`rebuildSummaryTask` 内 upsert 基于 bvid/cid，记录不存在则新建；属可接受的竞态，服务端记录日志。

## Acceptance Criteria

1. `POST /api/summary-tasks/:id/rebuild`：completed 且有 raw_response → 200 `{message:"重新构建已开始"}`；非法 id → 400；不存在 → 404；pending/analyzing/failed → 409；completed 但 raw_response 为空 → 409；同 id 并发第二次 → 409。
2. 重建后记录保持 `completed`，`summary_output`/`execution_timing`/`lastCompletedAt` 更新，`raw_response`/`model_name` 不变。
3. 重建生成的 Markdown 报告包含与 raw_response 内容对应的段落与截图，`model` 字段为存储的 `model_name`。
4. 重建过程**不发起任何 LLM 调用**（无视觉代理/QWEN 请求），且**不需要 LLM 配置**（无 QWEN_API_KEY 也能重建）。
5. `outputFile` 缺失时重建失败且记录状态不变。
6. 前端弹窗仅在 completed 记录显示"重新构建总结"按钮；点击后异步返回并重拉列表。
7. `pnpm typecheck`、`pnpm build` 通过（server 无单测设施，以编译 + API/DB 冒烟为准）。

## Open Questions

- 无阻塞性开放问题。重建失败的错误信息是否在列表展示（当前异步且非破坏性，仅日志）列为后续优化，不阻塞本次。
