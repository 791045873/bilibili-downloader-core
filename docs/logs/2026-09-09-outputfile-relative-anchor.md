# 2026-09-09 outputfile 相对锚点改造

- 需求/计划/测试文档：`docs/requirements/2026-09-09-outputfile-relative-anchor.md`、`docs/plans/2026-09-09-outputfile-relative-anchor-plan.md`（Plan Audit：subagent PASS-with-notes，见 `docs/audits/2026-09-09-plan-audit-outputfile-relative-anchor.md`）、`docs/testing/2026/09-09-outputfile-relative-anchor-testing.md`
- 改动：
  - 新建 `packages/server/src/paths/path-anchor.ts`：通用锚点纯函数 `toRelativeDownloadRootPath` / `resolveFromDownloadRoot`（含 Windows 盘符判定、POSIX 归一、根外不改写/透传）。
  - `analysis/summary-dir.ts` 的 `toRelativeSummaryOutputPath` / `resolveSummaryOutputPath` 改为委托新模块（行为不变，既有测试通过）。
  - 写侧相对化：`database.service.ts` 的 `updateTaskStatus`、`insertAnalysisSubTask`、`updateAnalysisSubTaskStatus` 在落库前对 `outputFile` 做 `toRelativeDownloadRootPath(... ) ?? 原值`；`insertTask` 为第三个潜在写入点但无生产调用方传该字段，保持原样（计划已记录）。
  - 读侧解析：`analysis-trigger.service.ts`（highResPath、低清子任务 preferredLowResPath、resolveTaskForAnalysis 磁盘校验、runRebuild）、`analysis-video-resolver.ts`（completedTask 回退存在性校验 + 返回值、同步重下返回值）、`summary-repair.service.ts`（videoPath 定位）统一经 `resolveFromDownloadRoot(value, DOWNLOAD_ROOT)`，遗留绝对值透传。
  - 一次性迁移 `scripts/one-off-migrations/004-outputfile-relative.sql`（真实列名 `task."outputFile"` / `analysis_sub_task.output_file`，幂等，README 已登记）。
- 测试：新增 `tests/paths/path-anchor.test.ts`（6 用例）、`tests/database/task.test.ts` 与 `analysis-sub-task.test.ts` 各新增写侧相对化用例。
- 验证：`pnpm typecheck` 通过；`pnpm build` 通过；`pnpm --filter @bilibili-downloader/server test` 11 文件 / 81 用例全部通过（TEST_DATABASE_URL 指向本地 bdl-test-pg）。
- 待用户操作：存量库按需执行 004 脚本（本地与 Docker 各一次，root 字面量按环境修改）；前端展示值由绝对变相对为预期行为。
