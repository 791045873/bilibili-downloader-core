# 2026-08-03 下载任务列表 AI 总结入口与任务列表测试说明

- Linked Plan: `docs/plans/2026-08-03-download-task-list-ai-summary-plan.md`
- Source Requirement: `docs/requirements/2026-08-03-download-task-list-ai-summary.md`

## Environment / Notes

- 使用现有 Web + NestJS 本地开发环境。
- 当前文档在计划创建阶段编写，所有方向初始状态均为 `pending`。
- 验证重点是需求级可观察状态与 forbidden states，而不是实现细节。

## Testing Directions

### 1. 已完成下载任务存在 AI 总结入口

- Requirement / Change: 下载任务列表页中，只有已完成下载的任务可以发起 AI 总结。
- Should Be Observable: `status = success` 的任务展示 AI 总结入口。
- Should Not Be Observable: `created`、`downloading`、`stopped`、`failed` 等未完成下载任务出现可点击的 AI 总结入口。
- Status: pending
- Evidence: pending

### 2. 按钮文案区分“立刻 AI 总结”与“重新 AI 总结”

- Requirement / Change: 下载任务列表页的按钮文案应反映资源是否已有 AI 总结记录。
- Should Be Observable: 资源从未存在 AI 总结任务记录时显示“立刻 AI 总结”；资源已有 AI 总结记录且当前不在进行中时显示“重新 AI 总结”。
- Should Not Be Observable: 页面仅依据下载任务是否完成来固定显示同一文案，或把失败/完成过的资源仍显示为“立刻 AI 总结”。
- Status: pending
- Evidence: pending

### 3. taskId 触发已完成任务的 AI 总结

- Requirement / Change: 用户从下载任务列表页点击 AI 总结按钮时，应通过任务级接口触发，并复用现有 AI 总结链路。
- Should Be Observable: `POST /api/tasks/:id/summary` 能对已完成下载任务成功触发 AI 总结。
- Should Not Be Observable: 前端必须额外回到解析结果列表或重新拼装 `bvid + cid` 才能触发。
- Status: pending
- Evidence: pending

### 4. 进行中的同一资源不能重复触发

- Requirement / Change: AI 总结进行中时，用户不能对同一资源重复提交。
- Should Be Observable: 当同一资源状态为“总结中”时，下载任务列表页按钮进入禁用态或替换为不可重复提交文案。
- Should Not Be Observable: 同一资源在进行中仍能被重复点击并产生并发触发。
- Status: pending
- Evidence: pending

### 5. 重跑覆盖同一资源的 AI 总结任务记录

- Requirement / Change: 同一 `bvid + cid` 只能保留唯一 1 条 AI 总结任务记录，再次触发时覆盖原状态。
- Should Be Observable: 对同一资源再次发起 AI 总结后，AI 总结任务列表仍只有 1 条该资源记录，且状态、结果、更新时间更新为最新一次执行。
- Should Not Be Observable: 同一资源在 AI 总结任务列表中出现多条历史记录。
- Status: pending
- Evidence: pending

### 6. AI 总结任务列表页存在且仅手动刷新

- Requirement / Change: 前端新增独立的 AI 总结任务列表页，并提供手动刷新按钮。
- Should Be Observable: 页面存在单独路由与导航入口，首次进入时加载数据，点击“刷新任务状态”后才重新请求列表。
- Should Not Be Observable: 页面自动轮询、自动定时刷新，或没有手动刷新入口。
- Status: pending
- Evidence: pending

### 7. AI 总结任务四类状态映射

- Requirement / Change: AI 总结任务至少支持待总结、总结中、总结失败、总结完成四类用户态。
- Should Be Observable: 列表页能把后端状态稳定映射到上述四类可理解文案。
- Should Not Be Observable: 用户看到裸数据库值、空白状态，或同一状态在不同页面文案不一致。
- Status: pending
- Evidence: pending

### 8. 下载任务列表与 AI 总结任务列表共享同一资源级状态真相

- Requirement / Change: 下载任务列表页的按钮文案与 AI 总结任务列表页的状态应基于同一资源级 AI 总结主记录。
- Should Be Observable: 当 AI 总结任务列表显示某资源已完成或失败后，回到下载任务列表页看到与之匹配的“重新 AI 总结”或进行中禁用态。
- Should Not Be Observable: 两个页面各自显示不同状态，或一个页面显示有记录而另一个页面仍按无记录处理。
- Status: pending
- Evidence: pending

### 9. 现有 AI 总结执行链路不分叉

- Requirement / Change: 新入口和新列表页不能引入第二套 AI 总结执行编排。
- Should Be Observable: 新的任务级触发入口最终仍复用既有 `AnalysisTriggerService` / `AnalysisEngine` 链路，成功和失败结果与现有 AI 总结一致落地。
- Should Not Be Observable: 新入口绕开现有链路，出现第二套独立状态机或结果写回逻辑。
- Status: pending
- Evidence: pending

### 10. 类型与构建门禁

- Requirement / Change: 新增数据表、API、前端页面和类型扩展不能破坏现有工作区构建。
- Should Be Observable: `pnpm typecheck` 与 `pnpm build` 通过。
- Should Not Be Observable: TypeScript 报错、路由懒加载错误或前后端 DTO 不一致。
- Status: passed
- Evidence: `pnpm typecheck` 通过；`pnpm build` 通过。frontend 新增 `AiSummaryTasks.vue`、`Downloading.vue` 按钮状态扩展、router 懒加载与 server 新接口类型面全部通过工作区编译验证。

### 11. API 负向契约: 无效 taskId 与未完成任务

- Requirement / Change: 任务级 AI 总结触发接口必须拒绝非法输入和不允许的任务状态。
- Should Be Observable: 对不存在的任务 ID 返回明确任务不存在错误；对 `status != success` 的任务返回明确状态不允许错误。
- Should Not Be Observable: 非法 taskId 被静默忽略，或未完成下载任务仍进入 AI 总结流程。
- Status: pending
- Evidence: 已运行 `curl.exe -i -X POST http://127.0.0.1:3000/api/tasks/999999/summary`，返回 `404` 与 `{"message":"任务不存在"...}`；未完成任务的 `409` 分支尚未在运行时复验。

### 12. API 负向契约: 进行中重复触发与资源唯一性

- Requirement / Change: 同一资源 AI 总结进行中时不能重复触发，且重跑后仍只能保留唯一 1 条资源级 AI 总结记录。
- Should Be Observable: 当资源处于“总结中”时，重复调用任务级接口返回明确冲突或禁止重复触发结果；在完成或失败后再次触发，列表中仍只有同一条资源记录并更新为最新状态。
- Should Not Be Observable: 进行中重复调用生成并发分析，或重跑后出现第二条同资源 AI 总结任务记录。
- Status: pending
- Evidence: pending

### 13. 页面刷新后的恢复边界

- Requirement / Change: 页面刷新恢复语义必须与页面角色一致。
- Should Be Observable: 下载任务列表页在浏览器仍保存 `taskId` 的前提下，刷新后能恢复相应任务的 AI 总结按钮文案与状态；AI 总结任务列表页无需依赖本地 `taskId`，刷新页面后仍能查看全量 AI 总结任务状态。
- Should Not Be Observable: 下载任务列表页在本地 `taskId` 丢失后仍被要求承担历史全量视图职责，或 AI 总结任务列表页依赖本地下载队列才能显示任务。
- Status: pending
- Evidence: pending

## 2026-08-03 Implementation Evidence

- Runtime proof: `curl.exe -i http://127.0.0.1:3000/api/summary-tasks` 返回 `HTTP/1.1 200 OK` 与 `[]`，确认新列表接口已挂载并可返回 JSON。
- Runtime proof: `curl.exe -i -X POST http://127.0.0.1:3000/api/tasks/999999/summary` 返回 `HTTP/1.1 404 Not Found` 与 `{"message":"任务不存在","error":"Not Found","statusCode":404}`，确认新任务级触发接口的 not-found 负向契约有效。
- Build proof: `pnpm typecheck` 与 `pnpm build` 在 2026-08-03 当前实现后均通过。
