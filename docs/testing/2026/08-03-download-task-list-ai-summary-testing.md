# 2026-08-03 下载任务列表分页、过滤与 AI 总结入口测试说明

- Linked Plan: `docs/plans/2026-08-03-download-task-list-ai-summary-plan.md`
- Source Requirement: `docs/requirements/2026-08-03-download-task-list-ai-summary.md`

## Environment / Notes

- 使用现有 Web + NestJS 本地开发环境。
- 当前文档已按方案 B 重写；除非明确标注为历史证据，否则所有方向初始状态均为 `pending`。
- 验证重点是需求级可观察状态与 forbidden states，而不是实现细节。
- 旧方案下基于本地 `taskId` 的刷新恢复和 build/runtime 记录，不再自动视为本切片 proof。

## Testing Directions

### 1. 下载任务列表按服务端分页拉取

- Requirement / Change: 下载任务列表页改为服务端分页任务列表，不再依赖浏览器本地 `taskId` 集合作为页面主数据源。
- Should Be Observable: 页面首次进入时用默认 `page` 与 `pageSize` 请求服务端任务列表，并展示当前页结果与分页信息。
- Should Not Be Observable: 页面仍先读取本地 `taskId` 再逐条调用详情接口拼装列表，或页面在本地队列为空时无法展示服务端已有任务。
- Status: pending
- Evidence: pending

### 2. 下载任务状态过滤替代“清空已完成”

- Requirement / Change: 下载任务页必须提供过滤操作，以现有任务集合为对象进行筛选，并替代“清空已完成”行为。
- Should Be Observable: 页面存在至少按下载状态过滤的控件；切换过滤条件后重新请求第一页数据并展示过滤后的当前页结果。
- Should Not Be Observable: 页面仍显示“清空已完成”按钮，或通过本地删除/隐藏终态任务来模拟过滤结果。
- Status: pending
- Evidence: pending

### 3. 页大小切换重置分页上下文

- Requirement / Change: 下载任务列表页切换 `pageSize` 后，必须回到新的合法分页上下文，并重新建立当前页轮询集合。
- Should Be Observable: 用户修改 `pageSize` 后，页面按新的 `pageSize` 请求任务列表，并重置到预期页码后展示结果。
- Should Not Be Observable: 修改 `pageSize` 后仍停留在旧分页上下文，导致空页、错页，或继续沿用旧页的轮询集合。
- Status: pending
- Evidence: pending

### 4. 当前页非终态任务轮询与释放

- Requirement / Change: 页面自动轮询范围仅限当前页中的非终态任务，且翻页、切换过滤或组件卸载时必须释放旧轮询。
- Should Be Observable: 当前页中的 `created`、`downloading` 等非终态任务被轮询；任务进入终态或列表上下文变化后，对应轮询停止。
- Should Not Be Observable: 已离开当前页的任务继续被轮询，或终态任务仍长期保留轮询计时器。
- Status: pending
- Evidence: pending

### 5. 下载任务列表与详情共享服务端真相

- Requirement / Change: 列表接口与详情接口应共享数据库真相，而不是列表读内存、详情读数据库的双真相。
- Should Be Observable: 同一任务在列表页和详情刷新后展示一致的状态与 AI 总结字段。
- Should Not Be Observable: 列表中出现旧状态而详情接口已返回新状态，或仅因内存缓存差异导致列表/详情不一致。
- Status: pending
- Evidence: pending

### 6. 已完成下载任务存在 AI 总结入口

- Requirement / Change: 下载任务列表页中，只有已完成下载的任务可以发起 AI 总结。
- Should Be Observable: `status = success` 的任务展示 AI 总结入口。
- Should Not Be Observable: `created`、`downloading`、`stopped`、`failed` 等未完成下载任务出现可点击的 AI 总结入口。
- Status: pending
- Evidence: pending

### 7. 按钮文案区分“立刻 AI 总结”与“重新 AI 总结”

- Requirement / Change: 下载任务列表页的按钮文案应反映资源是否已有 AI 总结记录。
- Should Be Observable: 资源从未存在 AI 总结任务记录时显示“立刻 AI 总结”；资源已有 AI 总结记录且当前不在进行中时显示“重新 AI 总结”。
- Should Not Be Observable: 页面仅依据下载任务是否完成来固定显示同一文案，或把失败/完成过的资源仍显示为“立刻 AI 总结”。
- Status: pending
- Evidence: pending

### 8. taskId 触发已完成任务的 AI 总结

- Requirement / Change: 用户从下载任务列表页点击 AI 总结按钮时，应通过任务级接口触发，并复用现有 AI 总结链路。
- Should Be Observable: `POST /api/tasks/:id/summary` 能对已完成下载任务成功触发 AI 总结。
- Should Not Be Observable: 前端必须额外回到解析结果列表或重新拼装 `bvid + cid` 才能触发。
- Status: pending
- Evidence: pending

### 9. 进行中的同一资源不能重复触发

- Requirement / Change: AI 总结进行中时，用户不能对同一资源重复提交。
- Should Be Observable: 当同一资源状态为“总结中”时，下载任务列表页按钮进入禁用态或替换为不可重复提交文案。
- Should Not Be Observable: 同一资源在进行中仍能被重复点击并产生并发触发。
- Status: pending
- Evidence: pending

### 10. 重跑覆盖同一资源的 AI 总结任务记录

- Requirement / Change: 同一 `bvid + cid` 只能保留唯一 1 条 AI 总结任务记录，再次触发时覆盖原状态。
- Should Be Observable: 对同一资源再次发起 AI 总结后，AI 总结任务列表仍只有 1 条该资源记录，且状态、结果、更新时间更新为最新一次执行。
- Should Not Be Observable: 同一资源在 AI 总结任务列表中出现多条历史记录。
- Status: pending
- Evidence: pending

### 11. AI 总结任务列表页存在且仅手动刷新

- Requirement / Change: 前端新增独立的 AI 总结任务列表页，并提供手动刷新按钮。
- Should Be Observable: 页面存在单独路由与导航入口，首次进入时加载数据，点击“刷新任务状态”后才重新请求列表。
- Should Not Be Observable: 页面自动轮询、自动定时刷新，或没有手动刷新入口。
- Status: pending
- Evidence: pending

### 12. AI 总结任务四类状态映射

- Requirement / Change: AI 总结任务至少支持待总结、总结中、总结失败、总结完成四类用户态。
- Should Be Observable: 列表页能把后端状态稳定映射到上述四类可理解文案。
- Should Not Be Observable: 用户看到裸数据库值、空白状态，或同一状态在不同页面文案不一致。
- Status: pending
- Evidence: pending

### 13. 下载任务列表与 AI 总结任务列表共享同一资源级状态真相

- Requirement / Change: 下载任务列表页的按钮文案与 AI 总结任务列表页的状态应基于同一资源级 AI 总结主记录。
- Should Be Observable: 当 AI 总结任务列表显示某资源已完成或失败后，回到下载任务列表页看到与之匹配的“重新 AI 总结”或进行中禁用态。
- Should Not Be Observable: 两个页面各自显示不同状态，或一个页面显示有记录而另一个页面仍按无记录处理。
- Status: pending
- Evidence: pending

### 14. 现有 AI 总结执行链路不分叉

- Requirement / Change: 新入口和新列表页不能引入第二套 AI 总结执行编排。
- Should Be Observable: 新的任务级触发入口最终仍复用既有 `AnalysisTriggerService` / `AnalysisEngine` 链路，成功和失败结果与现有 AI 总结一致落地。
- Should Not Be Observable: 新入口绕开现有链路，出现第二套独立状态机或结果写回逻辑。
- Status: pending
- Evidence: pending

### 15. 服务端分页与过滤接口负向契约

- Requirement / Change: 下载任务列表查询接口必须校验分页与过滤参数，避免无效请求进入服务端查询逻辑。
- Should Be Observable: 非法 `page`、`pageSize` 或不支持的 `statusGroup` 返回明确错误；合法参数返回稳定分页结果。
- Should Not Be Observable: 非法分页参数被静默纠正为随机值，或未知过滤值被当作成功请求继续执行。
- Status: pending
- Evidence: pending

### 15a. 服务端分页与状态过滤成功路径

- Requirement / Change: 下载任务列表接口需要返回分页结果，并按 `statusGroup` 过滤现有任务。
- Should Be Observable: `GET /api/tasks?page=1&pageSize=2&statusGroup=all` 返回 `items/page/pageSize/total/hasMore`；`statusGroup=success` 只返回已完成任务；`statusGroup=active` 只返回 `created` 或 `downloading` 任务。
- Should Not Be Observable: 分页结果缺少 `total` 或 `hasMore`；`statusGroup=success` 混入非完成任务；`statusGroup=active` 混入终态任务。
- Status: pending
- Evidence: pending

### 16. 页面刷新后的服务端恢复语义

- Requirement / Change: 下载任务列表页刷新后的恢复语义必须基于服务端分页与过滤重新取数，而不是依赖本地 `taskId` 是否仍存在。
- Should Be Observable: 刷新页面后，下载任务列表仍能根据当前分页与过滤条件重新显示服务端任务；AI 总结任务列表页刷新后仍能查看服务端 AI 总结任务状态。
- Should Not Be Observable: 下载任务列表页只有本地 `taskId` 仍存在时才能恢复，或 AI 总结任务列表页依赖本地下载队列才能显示任务。
- Status: pending
- Evidence: pending

### 17. 类型与构建门禁

- Requirement / Change: 新增数据表、API、前端页面和类型扩展不能破坏现有工作区构建。
- Should Be Observable: `pnpm typecheck` 与 `pnpm build` 通过。
- Should Not Be Observable: TypeScript 报错、路由懒加载错误或前后端 DTO 不一致。
- Status: pending
- Evidence: pending

### 18. API 负向契约: 无效 taskId 与未完成任务

- Requirement / Change: 任务级 AI 总结触发接口必须拒绝非法输入和不允许的任务状态。
- Should Be Observable: 对不存在的任务 ID 返回明确任务不存在错误；对 `status != success` 的任务返回明确状态不允许错误。
- Should Not Be Observable: 非法 taskId 被静默忽略，或未完成下载任务仍进入 AI 总结流程。
- Status: pending
- Evidence: 已运行 `curl.exe -i -X POST http://127.0.0.1:3000/api/tasks/999999/summary`，返回 `404` 与 `{"message":"任务不存在"...}`；未完成任务的 `409` 分支尚未在运行时复验。

### 19. API 负向契约: 进行中重复触发与资源唯一性

- Requirement / Change: 同一资源 AI 总结进行中时不能重复触发，且重跑后仍只能保留唯一 1 条资源级 AI 总结记录。
- Should Be Observable: 当资源处于“总结中”时，重复调用任务级接口返回明确冲突或禁止重复触发结果；在完成或失败后再次触发，列表中仍只有同一条资源记录并更新为最新状态。
- Should Not Be Observable: 进行中重复调用生成并发分析，或重跑后出现第二条同资源 AI 总结任务记录。
- Status: pending
- Evidence: pending

## Historical Note

- 2026-08-03 旧方案下曾记录过 `/api/summary-tasks` 与 `/api/tasks/:id/summary` 的运行时探测，以及一次 `pnpm typecheck` / `pnpm build` 通过结果。
- 上述记录产生于“本地下载队列视图补入口”的旧方案阶段，不自动构成方案 B 的 closure evidence；若后续实现继续复用这些接口，也仍需按本测试文档重新验证。
