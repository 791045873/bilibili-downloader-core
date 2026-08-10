# 2026-08-10 下载输出文件名唯一化（P0）

> Plan Status: completed
> Last Reviewed: 2026-08-10
> Source: `docs/discussions/2026-08-10-download-file-naming.md`
> Related: `docs/plans/2026-08-10-download-file-name-template-plan.md`（P2，后续在此之上收敛命名模块）
> Audit: skipped under micro-plan exception
> Testing: `docs/testing/2026/08-10-download-file-name-uniqueness-testing.md`

## Current Baseline

- `packages/server/src/download/download.service.ts:490`：`const fileName = \`${sanitizeFileName(task.title!)}.mp4\`;`，主流程文件名只含标题。
- 同名视频在同一目录下文件名必然相同；`DownloadExecutionUseCase.execute`（core）对已存在文件静默返回成功 `文件已存在, 跳过下载`，导致同标题第二个视频"假成功"且落盘为第一个视频。
- `executeLowResDownload`（download.service.ts:311）已采用 `{title}-{bvid}-{cid}-q{quality}.mp4`，与本次目标命名一致。
- 任务无自动化测试（验证基线为 `pnpm typecheck` + 手动验证）。

## Goals

- 不同视频即使标题相同，也必须落到不同的、可预期的稳定文件名。
- 同一视频重复入队时，因文件名稳定一致，继续命中现有"已存在即跳过"逻辑，行为可预期。
- 文件名包含实际选中的清晰度，使同一视频不同画质可并存。

## Non-Goals

- 不做标题清洗增强（保留设备名/结尾点空格/控制字符），不做长度截断守卫 —— 按讨论结论，当前数据源标题为已正常使用的合法字符串。
- 不改变"已存在即跳过"的语义。
- 不做 `fileNameTemplate` / 命名模块收敛 —— 归 P2 计划。
- 不做 DB 迁移，不迁移历史任务 `outputFile`。
- 不修改 `executeLowResDownload` 的命名（其模式已符合目标）。

## Infrastructure And Config Prereqs

No infra prereqs beyond existing baseline.

## Execution Plan

### Phase 1 - 主流程文件名唯一化

Status: completed
Targets: `packages/server/src/download/download.service.ts`

- Item Types: `Fix`（唯一项均为 Fix 性质，本阶段声明 Fix-only）
- Prereqs: none

- [x] Fix: 在 `executeTask` 完成流选择之后（download.service.ts:489 附近），将文件名构建改为
  `${sanitizeFileName(task.title!)}-${task.bvid}-${task.cid}-q${videoStream.quality}.mp4`，
  并使用该文件名构建 `outputFile`。`videoStream` 已在 :474 校验非空，`:474-487` 已完成选择。
- [x] Fix: 同步更新日志字段（`Resolved task output file` 日志补充 `quality: videoStream.quality`）。
- [x] Proof: 运行 `pnpm typecheck` 通过。
- [x] Proof: 按 `docs/testing/2026/08-10-download-file-name-uniqueness-testing.md` 验证（逻辑级 + 代码检查；运行级留用户手动）。

Exit Criteria:

- [x] 行为落地：同标题不同视频下载后生成 `{title}-{bvid}-{cid}-q{quality}.mp4` 两个不同文件；同视频重复入队命中"已存在即跳过"。
- [x] 相关文档：`docs/discussions/2026-08-10-download-file-naming.md` 已记录决策（已存在）；`docs/design/app-overview.md` 无需更新（workflow 描述不含具体文件名格式）。
- [x] `docs/logs/2026/08-10.md` 已记录。

## Micro-Plan Exception Justification

- 仅改动 1 个非生成文件（`packages/server/src/download/download.service.ts`），改动行数约 3-5 行。
- 无 API、数据库/模型、auth、集成、部署、权限、公共契约或跨功能面行为变更：文件名是服务端落盘行为，前端无对应改动；下游分析读 DB 中存储的 `outputFile`，不依赖命名格式。
- 需求与决策文档已明确预期行为（讨论存档 + 用户确认）。
- 现有验证命令（`pnpm typecheck`）加手动下载验证足以证明结果。

`Audit: skipped under micro-plan exception`。

## Plan Audit

- Status: skipped under micro-plan exception
- Reviewer / Agent: N/A
- Evidence: 上述 exception 理由逐条成立；closure 时执行冷回放自查。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck` 通过 + 逻辑级验证；运行级下载留用户手动，原因记录于测试文档与 Closure）
- [x] corresponding `docs/testing/2026/08-10-download-file-name-uniqueness-testing.md` 存在且每条 testing direction 已确认（逻辑级 passed；运行级留用户手动并记录原因）
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit skipped under micro-plan exception 且已在计划中写明理由
- [x] micro-plan actual diff 仍在 exception 限制内（1 文件、<200 行）
- [x] text consistency verified：status、phases、gates、testing document、log 一致
- [x] closure audit：micro-plan 冷回放自查已记录
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 命名模块与模板能力

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: P0 目标是修复同名冲突，模板能力在 `docs/plans/2026-08-10-download-file-name-template-plan.md`（P2）中独立处理。
- Successor Required: `yes`

## Closure

Status Note: P0 微计划完成。冷回放自查：以全新视角重放计划，逐项核对 —— 计划要求文件名 `{title}-{bvid}-{cid}-q{videoStream.quality}.mp4` 且取实际选中流；实际 diff 正是该一行改动（+日志 quality 字段），位置在流选择校验（:474）之后；`pnpm typecheck` 通过；测试文档 5 条方向均以逻辑级/代码检查确认，运行级真实下载因需要运行中的 server + 真实 B 站视频而留给用户手动执行（已在测试文档与日志记录）。真实 diff 未超出微计划限制（单文件、约 3 行）。

Closure Audit Evidence:

- Reviewer / Agent: 冷回放自查（`none` reviewer，非 protected、非高风险）
- Evidence: 见本 Closure 说明；逻辑验证脚本输出 `测试视频-BV1xx411c7mD-123-q80.mp4` / `测试视频-BV1yy222c7mD-456-q80.mp4` / `测试视频-BV1xx411c7mD-123-q64.mp4` 等，符合计划预期。

Follow-up:

- 无（P2 已在独立计划中跟进，不在此列非阻塞项）
