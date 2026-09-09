# 2026-09-09 读侧路径锚点移除绝对值透传

- 计划/审计：`docs/plans/2026-09-09-anchor-read-join-only-plan.md`（Plan Audit PASS-with-conditions，`docs/audits/2026-09-09-plan-audit-anchor-read-join-only.md`；Closure Audit `docs/audits/2026-09-09-closure-audit-anchor-read-join-only.md`）
- 背景：用户确认 DB 遗留绝对值已全部清理；`/abc` 这类根相对形态的 DB 值此前被 `isAbsoluteAnchorPath` 误判为绝对并透传，导致 `join` 被跳过、磁盘找不到文件
- 改动：`paths/path-anchor.ts` `resolveFromDownloadRoot` 非空值一律 `join(downloadRoot, value)`，删除透传分支；写侧 `toRelativeDownloadRootPath`/`isAbsoluteAnchorPath` 不变；`summary-dir.resolveSummaryOutputPath` 委托后语义随动；`app-overview.md` 两处（:46 约定行、:74 markdown 接口行）"遗留绝对值容错透传"表述改为"读侧恒 join，不透传绝对值"
- 测试同步：`tests/paths/path-anchor.test.ts` 透传用例改为 join 断言；`tests/database/ai-summary-task.test.ts` resolve 用例同步
- 验证：`pnpm typecheck`、`pnpm build`、server 测试 12 文件 / 87 用例全绿
- 残余风险（已裁决）：未清理库中残留绝对值会得到 join 后的错误路径并明确失败（fileExists 前置），不再静默透传
