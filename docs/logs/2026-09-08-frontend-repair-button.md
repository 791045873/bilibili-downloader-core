# 2026-09-08 AI 总结任务页新增"修复本地文件"按钮

## 变更

- `packages/frontend/src/api/index.ts`：新增 `repairSummaryTasks()` 与
  `SummaryRepairReport`/`SummaryRepairItem` 类型（POST /api/summary-tasks/repair）
- `packages/frontend/src/pages/AiSummaryTasks.tsx`：工具栏"检查本地文件"旁新增
  "修复本地文件"按钮（loading/disabled 防重复触发）；同步接口无需轮询，响应后
  弹出"本地文件修复报告"Modal（总数/四分组计数 + deferred 提示"下载完成后再次
  点击修复"）；完成后 `query.refetch()` 刷新列表；错误走既有红色提示条
  （409"修复流程进行中"亦由其展示）

遵循页面既有模式：useState loading/error + async handler + refetch + 受控
Modal + 硬编码中文（未引入 useMutation/message.useApp）。micro 级低风险直改，
未建正式计划（AGENTS micro 例外）。

## 验证

- `pnpm --filter @bilibili-downloader/frontend typecheck` ✅
- `pnpm --filter @bilibili-downloader/frontend build` ✅
- 真实环境点击验证（同步耗时场景/409 并发）待用户执行
