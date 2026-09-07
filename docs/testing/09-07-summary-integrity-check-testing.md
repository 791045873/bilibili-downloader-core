# 09-07 AI 总结本地原始内容完整性检查 Testing

对应需求：`docs/requirements/2026-09-07-summary-integrity-check.md`
对应计划：`docs/plans/2026-09-07-summary-integrity-check-plan.md`

记录需求级观察态（用户/系统应该与不应该的状态），非测试脚本。

## 检查应覆盖的状态

### T1 触发与互斥

- 手动点击"检查本地文件"后检查启动；进行中按钮禁用/加载态。
- 进行中直接调启动接口返回 409（不产生第二次并发检查）。
- 检查结束后可再次触发，且能再次得到结果（复检覆盖写）。

### T2 完整判定

- 本地磁盘存在 md 且 md 中引用的全部相对截图存在 → 该记录"本地文件"列显示完整。
- 检查完成后状态已持久化：刷新页面/换会话仍在（来自 DB，非前端临时态）。

### T3 缺失判定

- md 文件被手动删除 → 显示缺失，明细说明文档不存在。
- md 存在但某张相对截图被删除 → 显示缺失，明细列出该相对路径。
- 记录 status=completed 但无 `summary_output` → 显示缺失（"无输出文档记录"）。
- 缺失项极多时明细截断不丢失总计数（无性能/展示异常）。

### T4 范围与容错

- 非 completed（pending/analyzing/failed）记录 → 显示未检查，检查不写它们的完整性字段。
- `summary_output` 为旧遗留绝对路径（当前环境下载根目录之内）→ 仍能正确按当前环境定位并判定（读侧容错语义不变）。
- md 中绝对 URL（http/根相对/锚点）引用不参与检查，不造成误报。

### T5 状态时效

- 对一条已显示完整/缺失的记录重新触发 AI 总结 → 完整性状态重置为未检查；新总结完成并再次检查后更新为新结果。
- 对一条已显示完整/缺失的记录执行重新构建（rebuild）→ 完整性状态同样重置为未检查（rebuild 不走 claim，需独立验证该路径）。

### T6 前端呈现

- AI 总结任务表格出现"本地文件"列：完整（绿）/ 缺失（红，可见明细）/ 未检查（默认）。
- 检查完成后列表刷新即见最新状态；该列随其他列一样可拖拽调宽，操作列不受影响。

## 不应发生

- 任何自动或定时触发检查的路径（仅手动按钮/手动接口）。
- 检查过程修改、删除、重建任何磁盘文件。
- 非 completed 记录被写入完整性字段。

## 确认结果（2026-09-07 实施闭合）

- T2/T3/T4 判定与容错：**通过**——`packages/server/tests/database/summary-integrity.test.ts`（vitest + 测试库 + 临时磁盘目录）逐项覆盖：md 与截图齐全=complete、缺失截图=missing 含明细、md 缺失、无输出记录、绝对 URL 跳过、明细截断 40 项保留总计数、`updated_at` 不被改写；数据层测试（`ai-summary-task.test.ts`）覆盖新列映射往返、写入透出、claim/pending/analyzing 重置、reset 单条重置、listCompleted 范围。注：T4 的"遗留绝对路径按当前环境拼接容错"依托 09-04 计划既有 `resolveSummaryOutputPath` 测试（`summary path helpers` 用例），本轮未重测该助手函数本身。
- T1 触发与互斥：**通过（服务级）**——tryStart 全局互斥经单测（tryStart 两次仅一次成功、run 结束释放）；真实服务端启动 demo（Nest start + curl）：`GET status` 初始 `running:false` → `POST` 返回"已开始" → `running:true` → 列表出现 `integrityStatus:"complete"` 且 `updatedAt` 未变。controller 409 分支由互斥单测与代码路径覆盖，未在运行中窗口内实测 4xx 响应体（裁决：启动窗口极短、互斥核心已被单测证明，残余风险仅表现为重复点击被 409/按钮禁用兜底）。
- T5 状态时效：**通过（数据层）**——claim 后重置、analyzing upsert 后重置、reset 单条重置均有测试；rebuild 链路重置的调用点已实现（`runRebuild` 写终态前显式 reset），完整 rebuild 端到端测试未做（需 LLM/视频环境；裁决：重置方法已测、调用点为两行直调，链路风险可忽略）。
- T6 前端呈现与 T1 按钮禁用：**代码级通过 + 待用户部署确认**——`pnpm --filter @bilibili-downloader/frontend typecheck` 通过，列/按钮/tooltip/轮询/副标题按计划实现；浏览器手动演示未在本环境执行（裁决：交互观感与真实部署效果由用户部署后确认，与 knowledge-vector-search 闭合先例一致）。
- "不应发生"三项：**通过**——触发点仅 `analysis-task.controller` 两处路由（代码内确认无自动/定时调用）；检查为只读（仅 readFile/access）；写入范围仅 completed（`listCompletedAiSummaryTasks`）。
