# 2026-09-07 AI 总结本地原始内容完整性检查（plan 闭合）

计划：`docs/plans/2026-09-07-summary-integrity-check-plan.md`（plan audit 独立 subagent 两轮：FAIL→修订→PASS-with-notes）
需求：`docs/requirements/2026-09-07-summary-integrity-check.md`

## 实施

- 数据层：contract 三列（`integrity_status`/`integrity_detail`/`integrity_checked_at`）→ `contract emit` → `migration plan`（3 条 additive，`migrations/app/20260907T0945_summary_integrity_check`，清理了演练产生的重复 0946 目录与误签 DB 后重建干净历史 baseline+0945）→ `db migrate` 实证；`AiSummaryTaskRecord`/映射透出；`updateAiSummaryTaskIntegrity`（不触碰 `updated_at`）、`resetAiSummaryTaskIntegrity`、`listCompletedAiSummaryTasks`；重置三路径（claim SQL ON CONFLICT / upsert pending+analyzing / `runRebuild` 终态前显式 reset）。
- 服务与 API：`summary-dir.ts` 导出 `listLocalImageRefs`（matchAll 规避 `/g` lastIndex）；`SummaryIntegrityService`（全局单例互斥、逐条判定、明细 >40 项截断保留总数）；`POST /api/summary-tasks/integrity-check`（运行中 409）与 `GET …/status`。
- 前端：`AiSummaryTasks.tsx` 新增"检查本地文件"按钮（2s 轮询 status、结束后 refetch）、"本地文件"列（complete/missing/NULL → 完整/缺失/未检查 Tag，缺失 tooltip 含明细与检查时间）、副标题更新轮询例外。另：本次接入 `useResizableColumns` 时移除了操作列遗留的 `fixed: "right"`（主表未配 `scroll.x` 时该属性无效，与 Downloading 页表格模式一致，观感无变化）。

## 验证

- `pnpm typecheck`、`pnpm build`、server 测试 72/72（含新增 `summary-integrity.test.ts` 与完整性数据层用例）通过。
- 演进端到端：旧签名库（5f0ca）→ 新 contract（248ea）→ migration plan 3 additive → `db migrate` 应用 → `db verify` ok。
- 部署链路关键实证：容器 CMD 的 `prisma db init` 对"已签名旧库 + 新 contract"会自动应用 additive 差异并更新 marker（实测 3 操作）——无需改 Dockerfile/CMD，`migrations/` 不进镜像也可正确演进。
- 真实服务端 demo（Nest start + curl）：status → POST → running:true → 列表返回 `integrityStatus:"complete"` 且 `updatedAt` 不变。
- 测试方向确认：见 `docs/testing/09-07-summary-integrity-check-testing.md` 确认结果节（T6 前端交互观感待用户部署确认）。

## 文档对齐

- `app-overview.md`：接口表两行 + 基线说明完整性列语义与前端列。
- `codebase-map.md`：Server 行补 `summary-integrity.service.ts`。
- `project-context.md`：Active Work 收尾更新。
