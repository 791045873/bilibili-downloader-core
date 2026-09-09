# 2026-09-09 读侧路径锚点移除绝对值透传计划

> Plan Status: completed
> Last Reviewed: 2026-09-09
> Source: 用户直接请求（DB 遗留绝对值已由用户手工清理；`/abc` 形态值被误判绝对导致透传找不到文件）
> Related: `docs/plans/2026-09-09-outputfile-relative-anchor-plan.md`（引入该语义的批次）
> Audit: required
> Testing: 本文件内含（见 Phase 2 Proof；行为为纯读侧语义收敛，测试文件同步更新）

## Current Baseline

- `paths/path-anchor.ts` 的 `resolveFromDownloadRoot`（:49-59）当前逻辑：`isAbsoluteAnchorPath(value)`（POSIX `/` 开头或 Windows 盘符，win32/posix 双语义）命中则**原样透传**，否则 `join(downloadRoot, value)`。
- 问题：DB 中存在 `/abc` 这类值（用户环境写入的根相对形态）被判为绝对 → 透传 → 当前环境磁盘不存在 `/abc` → 找不到视频文件。
- 写侧 `toRelativeDownloadRootPath`（:21-40）依赖 `isAbsoluteAnchorPath` 把进程内计算的绝对路径转相对；**该写侧判定必须保留**（否则相对值会被 resolve(cwd)+relative 误算）。
- 消费方：`resolveFromDownloadRoot` 被 download.service（去重门 :453）、analysis-trigger（4 处）、analysis-video-resolver（2 处）、summary-repair（2 处）使用；`summary-dir.resolveSummaryOutputPath` 委托它 → `summary_output` 读侧同步受影响（ai_summary_task 的 003 迁移与 task 表 004 迁移均已由用户在库中执行/清理）。
- 透传语义测试：`tests/paths/path-anchor.test.ts:43-46`（"/tmp/x.mp4" 与 join(root,"a.mp4") 透传用例）、`tests/database/ai-summary-task.test.ts:335`（summary-dir resolve 透传用例）。
- 文档：`docs/design/app-overview.md` 锚点约定行、`paths.service.ts` 头注释、`path-anchor.ts`/`summary-dir.ts` 注释均含"遗留绝对路径值原样容错透传"表述。

## Goals

- 读侧（`resolveFromDownloadRoot`）：非空值一律 `join(downloadRoot, value)`，**删除绝对值透传分支**——任何 DB 值（含 `/abc`、`E:/x` 形态）都按相对锚点拼接。
- 写侧 `toRelativeDownloadRootPath` 与 `isAbsoluteAnchorPath` 不变（仅服务写侧"进程内绝对值 → 相对值"转换）。

## Non-Goals

- 不改 DB schema、不改写侧相对化逻辑、不改任何消费方调用点（签名不变）。
- 不为"绝对值仍残留"的库做兼容（用户已清理；若未来再出现，将得到 join 后的错误路径并明确失败，而非静默透传）。

## Execution Plan

### Phase 1 - 读侧语义收敛

Status: completed
Targets: `paths/path-anchor.ts`、`tests/paths/path-anchor.test.ts`、`tests/database/ai-summary-task.test.ts`、注释同步（`analysis/summary-dir.ts`、`paths/paths.service.ts`）、`docs/design/app-overview.md`

- Item Types: `Fix | Decision`

- [x] Fix: `resolveFromDownloadRoot` 简化为 `value ? join(downloadRoot, value) : undefined`；模块头与函数注释同步（读侧恒 join、无透传）。
- [x] Fix: 两个测试文件透传用例改为"一律 join"断言（`/tmp/x.mp4` → `join(root, "/tmp/x.mp4")`；`join(root,"a.mp4")` 亦按 join 语义断言）；roundtrip 用例不受影响（写侧输出恒为相对值）。
- [x] Fix: 注释与 owner doc 同步——app-overview 锚点约定行（:46）与 `/api/summary-tasks/:id/markdown` 行（:74 的"2026-09-04 前遗留绝对值原样容错读取"）改为"读侧恒按相对锚点 join（2026-09-09 起不再透传绝对值，遗留值须迁移清理）"；path-anchor/summary-dir 注释同步（paths.service 头注释本为中性表述，无需改）。
- [x] Decision: 不保留任何绝对值豁免（包括 Windows 盘符形态）。备选：仅去掉 POSIX `/` 判定保留盘符豁免（否决——`/abc` 与 `E:/x` 同为用户已清理的遗留形态，保留豁免会把问题留在另一半）；加 env 开关兼容（否决——无真实存量需求，徒增分支）。残余风险：未清理库中残留绝对值会以 join 错误路径失败（用户已确认清理完毕；全部 10 处 call site 输入均为 DB 值，fileExists 前置兜底）。
- [x] Proof: `pnpm typecheck`、`pnpm build`、`pnpm --filter @bilibili-downloader/server test` 全绿。

Exit Criteria:

- [x] `/abc` 形态 DB 值读侧解析为 `join(DOWNLOAD_ROOT, "/abc")`
- [x] 写侧相对化行为不变（既有写侧测试通过）
- [x] owner doc 与代码注释与实现一致
- [x] `docs/logs/` 更新

## Plan Audit

- Status: passed（PASS-with-conditions；M1 补 app-overview :74 处残留"透传"表述、m1 修正 paths.service 无需改的前提、m2 补记 knowledge-backfill.service:117 为 DB 值消费方无行为风险。证据见审计文件）
- Reviewer / Agent: subagent（独立审计）
- Evidence: `docs/audits/2026-09-09-plan-audit-anchor-read-join-only.md`

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（typecheck / build / server 测试）
- [x] testing directions confirmed（本计划内含，见 Phase 1 Proof）
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] text consistency verified
- [x] closure audit was independent（subagent，PASS）
- [x] closure evidence exists in files

## Deferred But Adjudicated

（无）

## Closure

Status Note: 读侧 `resolveFromDownloadRoot` 非空值恒 `join(downloadRoot, value)`，透传分支删除；写侧不变；两处测试与 owner doc 两处表述同步；typecheck/build/server 测试（12 文件 87 用例）全绿并由 closure audit 独立复跑。残余风险：未清理库中残留绝对值将得到 join 后错误路径并明确失败（已裁决，用户确认存量已清理）。

Closure Audit Evidence:

- Reviewer / Agent: subagent（独立 closure audit，PASS）
- Evidence: `docs/audits/2026-09-09-closure-audit-anchor-read-join-only.md`（diff 与计划范围逐项一致、win32 join 断言独立验证、"透传"残留表述 sweep 干净、验证命令独立复跑）

Follow-up:

- （无）
