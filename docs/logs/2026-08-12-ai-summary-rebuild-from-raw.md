# 2026-08-12 AI 总结"重新构建总结"（基于已存储 LLM 返回重建报告与截图）

## 变更摘要

在"查看 AI 总结原始记录"弹窗中为 `completed` 记录新增"重新构建总结"按钮：用 `ai_summary_task.raw_response` 中已存储的大模型返回内容重新生成总结报告（Markdown）与截图，**不重新调用 LLM、不解析字幕、不调度低清下载**，异步执行且失败非破坏性。

来源：`docs/requirements/2026-08-12-ai-summary-rebuild-from-raw.md`（已定稿）；计划：`docs/plans/2026-08-12-ai-summary-rebuild-from-raw-plan.md`；测试方向：`docs/testing/2026/08-12-ai-summary-rebuild-from-raw-testing.md`。

## server 变更

- `analysis-engine.ts`：
  - 构造函数 `llmConfig` 改为可选，QwenClient 惰性创建（`ensureLlmClient()`），`rebuild` 路径无需 LLM 配置（无 QWEN 环境变量也能重建）。
  - 抽取 LLM 后共享处理为私有 `buildOutput(input, analysis, rawResponse, modelName, llmMs, startTotalMs)`（规范化 items → 截图 → `generateMarkdown` → 写文件），`analyze()` 与新增 `rebuild()` 复用。
  - 新增 `rebuild(input, rawResponse, modelName)`：`JSON.parse(rawResponse)`（失败抛"存储的原始返回不是有效 JSON"）→ `buildOutput(..., 0)`。
  - `analyze()` 文档 `model` 字段改用实际 `llmResult.model`（顺带修正此前用 llmConfig 默认值的偏差）。
- `analysis-trigger.service.ts`：
  - 新增内存防抖 `rebuildingIds: Set<number>`、`tryStartRebuild(id)`（本次占用成功返回 true）与 `runRebuild(id)`（`finally` 统一释放）。
  - `runRebuild`：执行期重校验（completed + rawResponse 非空）→ `findLatestTaskByBvidAndCid` 定位任务（无任务抛错）→ `outputFile` `fileExists` 校验（缺失抛错）→ 构造 AnalysisInput（videoPath/screenshotVideoPath=outputFile，summaryDir=resolveSummaryDir）→ `new AnalysisEngine(undefined, ...).rebuild(input, rawResponse, modelName ?? "")` → 成功 upsert（completed/summaryOutput/executionTiming/时间戳，**不传 rawResponse/modelName 以保留**）；失败仅记日志、不改写记录状态（非破坏性）。
- `analysis-task.controller.ts`：新增 `POST /api/summary-tasks/:id/rebuild`（`@HttpCode(200)`）——400 非法 id / 404 不存在 / 409 非 completed / 409 raw 为空 / 409 并发防抖 → `void runRebuild(id).catch(记日志)` → `{message:"重新构建已开始"}`；raw 校验用 `databaseService.getAiSummaryTaskById` 完整记录（service 视图已剥离 rawResponse）。

## frontend 变更

- `api/index.ts`：新增 `rebuildAiSummaryTask(id)` → `POST /summary-tasks/:id/rebuild`。
- `views/AiSummaryTasks.vue`：原始记录弹窗记录 `rawDialogTask`；仅 `status === "completed"` 显示"重新构建总结"按钮；点击调 rebuildAiSummaryTask，成功提示"已开始重新构建总结，请刷新任务状态后查看结果"并重拉列表，失败在弹窗内展示错误；`rebuilding` 加载态防重复点击。

## 文档

- `docs/design/app-overview.md`：Integration Points 补充 rebuild 端点说明（不调用 LLM、仅 completed、非破坏性）。
- `docs/context/codebase-map.md`：视频分析路由行验证日期已为 2026-08-12（无改动）。

## 验证

- `pnpm typecheck`（根，全部 workspace）通过；`pnpm build`（根）通过。
- API/DB 冒烟（临时 OUTPUT_DIR、**无 QWEN 配置**、一次性脚本 `$TEMP/opencode/rebuild-smoke/smoke-rebuild.cjs` 未入库）：15/15 PASS——
  - 端点契约：非法 id 400、不存在 404、pending/failed/raw 空 409、completed+raw 200；
  - 重建成功写回：状态保持 completed、raw_response/model_name 保留、summary_output 重写（`-summary.md`）、execution_timing 写入；
  - 并发第二次 409；ffmpeg 失败（dummy 视频）段级吞掉后记录仍 completed；
  - 服务端日志无"缺少 LLM 配置"，含 rebuild 完成/失败记录。

## 残余说明

- 真实 ffmpeg 截图 + 报告内容完整性的运行级验证属人工观察项（冒烟用非法时间戳跳过截图验证写回；无仓库级 e2e 基线）。
- 重建失败错误信息不向前端展示（异步 + 非破坏性），仅服务端日志；重试或走"重新总结"即可。
- 重建与 retrigger 并发竞态（last-writer-wins）已记录为可接受残余风险。

## 审计

- 计划审计：独立 subagent 两轮（首轮 needs revision → 复审 passed），证据 `docs/audits/2026-08-12-plan-audit-ai-summary-rebuild.md`。
- 关闭审计：独立 subagent，证据 `docs/audits/2026-08-12-closure-audit-ai-summary-rebuild.md`。

## 补充：transTimestampToSeconds 健壮性增强（同日下午）

- 抽取为纯函数模块 `packages/server/src/analysis/timestamp.ts`（`analysis-engine.ts` 改用 import），支持 `hh:mm:ss` 与 `mm:ss`，仅接受纯数字段，分/秒校验 < 60，其余输入返回 undefined。
- server 无单元测试设施（仓库基线），采用真实代码断言验证：`node --experimental-strip-types` 直接 import `timestamp.ts`，23 个用例（含 `mm:ss`、`1:2:3` 变长、空白、`01:60:00`/`12:60` 越界、空串/非数字/多段拒绝）全部 PASS。
- `pnpm --filter @bilibili-downloader/server typecheck`、根 `pnpm typecheck`、根 `pnpm build` 通过。
