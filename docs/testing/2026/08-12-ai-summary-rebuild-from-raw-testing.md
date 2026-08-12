# AI 总结"重新构建总结" — 测试方向

- 关联计划：`docs/plans/2026-08-12-ai-summary-rebuild-from-raw-plan.md`
- 来源需求：`docs/requirements/2026-08-12-ai-summary-rebuild-from-raw.md`
- 环境 / 配置说明：
  - 项目无单元测试设施，验证以 `pnpm typecheck` / `pnpm build` + API/DB 冒烟为准（一次性脚本 `$TEMP/opencode/rebuild-smoke/smoke-rebuild.cjs`，临时 OUTPUT_DIR 隔离真实数据）
  - "不调用 LLM" 通过**不配置任何 QWEN 环境变量**仍可重建来证明（`getLlmConfig()` 抛错路径不触发）
  - 真实 ffmpeg 截图 + 报告内容完整性无仓库级 e2e 基线，属人工运行级残余项；冒烟用非法时间戳跳过截图验证写回路径

## 测试方向

### 1. 重建端点契约

- 覆盖需求：`POST /api/summary-tasks/:id/rebuild` 各分支（AC1）
- 应当可观察：completed 且有 raw_response → 200 `{message:"重新构建已开始"}`；非法 id → 400；不存在 → 404；pending/analyzing/failed → 409；completed 但 raw_response 为空 → 409；同 id 并发第二次 → 409
- 不应可观察：非 completed 记录被接受重建；重复点击触发两次构建
- 状态：passed
- 证据：冒烟 15/15 PASS（非法 id 400、不存在 404、pending/failed/raw 空 409、completed+raw 200、并发 200+409）

### 2. 重建非破坏性与结果写回

- 覆盖需求：重建成功写回、保留 raw（AC2、AC3、AC4）
- 应当可观察：重建后记录仍为 `completed`，`summary_output`/`execution_timing`/`lastCompletedAt` 更新；`raw_response`/`model_name` 保持不变；重建过程无 LLM 调用（无 QWEN 配置也可执行）；报告 `model` 字段为存储的 `model_name`
- 不应可观察：记录状态被改写为 failed/analyzing；raw_response/model_name 被清空或替换
- 状态：passed
- 证据：冒烟——重建后状态 completed、raw_response 与 model_name 保留、summary_output 重写为 `-summary.md`、execution_timing 写入、服务端日志无"缺少 LLM 配置"

### 3. 重建失败路径

- 覆盖需求：视频文件缺失 / 无下载任务 / raw 不可解析（AC5）
- 应当可观察：`outputFile` 缺失时重建失败且记录状态不变；无对应下载任务时失败；记录保持 completed 原状，可再次点击
- 不应可观察：重建失败把记录降级为 failed 或清空 summary_output
- 状态：passed（视频文件缺失/无任务分支为代码路径 + typecheck；ffmpeg 失败非破坏性由冒烟验证）
- 证据：冒烟——并发记录 ffmpeg 对 dummy 视频失败（段级吞掉）后仍 completed；`runRebuild` 对缺失 outputFile/无任务抛错仅记日志（代码核对 + 日志含 "Summary rebuild failed"）

### 4. 前端弹窗交互

- 覆盖需求：弹窗内"重新构建总结"按钮（AC6）
- 应当可观察：仅 completed 记录弹窗显示该按钮；点击后异步返回"已开始重新构建总结"，并自动重拉任务列表；失败时弹窗内展示错误信息
- 不应可观察：failed/pending/analyzing 记录弹窗出现可用按钮；无刷新反馈
- 状态：passed（编译级）
- 证据：`AiSummaryTasks.vue` 按钮条件 `rawDialogTask.status === 'completed'`、成功/失败处理 + `loadTasks()`；`vue-tsc` 通过（真实前端交互为人工运行级残余项）

### 5. 编译与构建

- 覆盖需求：AC7
- 应当可观察：`pnpm typecheck`（全部 workspace）、`pnpm build` 通过
- 不应可观察：新增重构引入类型错误或构建失败
- 状态：passed
- 证据：根 `pnpm typecheck` 6 workspace 全 Done；根 `pnpm build` frontend/adapters/server 全 Done

## 人工运行级确认（留给用户）

- 对真实 completed 记录（含有效 raw_response 与存在的视频文件）点击"重新构建总结"，确认 summary_output/时间更新、截图与报告重新生成、`model` 字段正确。
- 删除视频文件后重建，确认记录不变且错误可见于服务端日志。
- 在弹窗对 failed 记录确认无"重新构建总结"按钮。
