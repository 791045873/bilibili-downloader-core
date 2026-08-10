# 2026-08-10 下载入队去重 UX 调整（移除拦截，保留"已下载"标记）

> Plan Status: completed
> Last Reviewed: 2026-08-10
> Source: `docs/discussions/2026-08-10-download-file-naming.md`（决策 4）
> Related: `docs/plans/2026-08-10-download-file-name-uniqueness-plan.md`（P0）
> Audit: skipped under micro-plan exception
> Testing: `docs/testing/2026/08-10-download-enqueue-dedup-ux-testing.md`

## Current Baseline

- `packages/frontend/src/views/VideoDetail.vue`：
  - 加载时调用 `api.checkTasks`（:80-81），`markEnqueued`（:104-118）基于 DB 记录把有下载记录的分P标记为 `enqueued=true`，且 `status === "success"` 且 24h 内（`isOldSuccess`）**不**标记。
  - 拦截点：`toggleSection`/`toggleEpisode` 中 `!p.data.enqueued` 守卫（:170、:196）；`doAddToQueue` 过滤（:275）；加入成功后 `p.data.enqueued = true`（:304）；复选框 `:disabled="node.data.enqueued"`（:384）；"已入队"角标（:392）。
- `packages/frontend/src/views/ParseResultList.vue`：
  - `markEnqueued`（:249-269）标记 `enqueued = Boolean(task)`，并把 `selected` 置为 false；记录 `queuedTaskId` 与 `autoSummaryEnabled`。
  - 拦截点：`toggleSelect` 守卫（:276）；`doAddToQueue` 过滤（:286）；加入成功后 `enqueued=true`（:311）；复选框 `:disabled="item.enqueued"`（:439）；"已入队"角标（:448）；一键 AI 总结按钮禁用条件 `item.autoSummaryEnabled && item.enqueued`（:463-464）。
- 服务端 `DownloadExecutionUseCase.execute`（core）以磁盘文件存在性为跳检裁决（文件在跳过、不在重新下载），DB 记录不参与；本计划不改服务端。
- `POST /api/tasks/check` 接口保留：前端"已下载"标记仍依赖它查询 DB 记录。

## Goals

- 有下载记录的视频在前端展示"已下载"标记（展示性，不拦截）。
- 用户可随时选择并加入任意视频，不受 DB 下载记录与 24h 门控拦截。
- 是否真正下载由服务端磁盘文件存在性裁决：文件存在则执行时跳过，文件缺失则重新下载。

## Non-Goals

- 不改服务端：`checkTasks` 接口、`DownloadExecutionUseCase` 跳检逻辑、任务创建/调度均不动。
- 不改 AI 总结相关 UX 语义：一键 AI 总结按钮判断条件随字段改名同步更新，但行为不变。
- 不做 P0（文件名唯一化）与 P2（模板/命名模块）工作。

## Infrastructure And Config Prereqs

No infra prereqs beyond existing baseline.

## Execution Plan

### Phase 1 - 前端去重拦截移除

Status: completed
Targets: `packages/frontend/src/views/VideoDetail.vue`、`packages/frontend/src/views/ParseResultList.vue`

- Item Types: `Fix`（本阶段 Fix-only）
- Prereqs: none

- [x] Fix: 将 `enqueued` 的"拦截"语义改为"已下载"展示语义（字段改为 `downloaded`）。
- [x] Fix: `VideoDetail.vue` 移除全部拦截点：`toggleSection`/`toggleEpisode`/`doAddToQueue` 不再因该标记过滤或阻止；复选框不再 `:disabled`；"已入队"角标改为"已下载"；加入成功后标记为"已下载"。
- [x] Fix: `VideoDetail.vue` `markEnqueued` 移除 24 小时 success 门控：有 DB 记录即标记"已下载"（函数改为 `markDownloaded`）。
- [x] Fix: `ParseResultList.vue` 同样移除拦截：`toggleSelect` 不再因记录阻止；`doAddToQueue` 不过滤；复选框不再 `:disabled`；角标改为"已下载"；加入成功后标记"已下载"；`selectedCount` 统计全部选中。
- [x] Fix: `ParseResultList.vue` 一键 AI 总结按钮的禁用条件随字段改名同步更新（`enqueued→downloaded`），行为保持不变。
- [x] Proof: 运行 `pnpm --filter @bilibili-downloader/frontend typecheck` 通过。
- [x] Proof: 按 `docs/testing/2026/08-10-download-enqueue-dedup-ux-testing.md` 验证（代码级；运行级留用户手动）。

Exit Criteria:

- [x] 行为落地：有下载记录的视频展示"已下载"且可被再次勾选加入；加入成功后立即标记"已下载"；24h 门控消失。
- [x] 相关文档：`docs/discussions/2026-08-10-download-file-naming.md` 决策 4 已记录（已存在）；`docs/design/app-overview.md` 无需更新。
- [x] `docs/logs/2026/08-10.md` 已记录。

## Micro-Plan Exception Justification

- 仅改动 2 个非生成文件（两个 Vue 视图），预期改动行数远低于 200。
- 无 API、数据库/模型、auth、集成、部署、权限、公共契约变更：`checkTasks` 接口保留，服务端零改动。
- 跨功能面：本计划只改前端下载入队 UX，服务端行为不变；同页面的 AI 总结按钮仅做字段改名同步，不改行为。
- 需求与决策已由用户明确（决策 4 + 范围确认），owner 行为清晰。
- 现有验证命令（`pnpm typecheck`）加手动 UI 验证足以证明结果。

`Audit: skipped under micro-plan exception`。

## Plan Audit

- Status: skipped under micro-plan exception
- Reviewer / Agent: N/A
- Evidence: 上述 exception 理由逐条成立；closure 时执行冷回放自查。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm --filter @bilibili-downloader/frontend typecheck` 通过 + 代码级验证）
- [x] corresponding `docs/testing/2026/08-10-download-enqueue-dedup-ux-testing.md` 存在且每条 testing direction 已确认（代码级 passed；运行级留用户手动并记录原因）
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit skipped under micro-plan exception 且已在计划中写明理由
- [x] micro-plan actual diff 仍在 exception 限制内（2 文件、<200 行）
- [x] text consistency verified：status、phases、gates、testing document、log 一致
- [x] closure audit：micro-plan 冷回放自查已记录
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 服务端任务创建层去重

- Classification: `watch-only residual`
- Why Not Blocking Closure: 用户确认以"执行时磁盘存在性检查"为唯一裁决，创建层不做去重；可能产生重复任务行（均按跳过/下载落盘），当前可接受。
- Successor Required: `no`

## Closure

Status Note: UI 去重微计划完成。冷回放自查：以全新视角重放计划 —— 计划要求移除两个视图全部基于 DB 记录的入队拦截（含 24h 门控）、保留"已下载"展示标记、AI 总结按钮仅改名不改行为、`checkTasks` 接口保留；实际 diff 正是如此：`VideoDetail.vue` 与 `ParseResultList.vue` 中 `enqueued` 全部改为展示性 `downloaded`，拦截点（守卫/过滤/禁用/选中清零）移除，`selectedCount` 同步，AI 按钮仅字段改名；`markEnqueued` 24h 门控删除并更名 `markDownloaded`。grep 确认两视图已无 `enqueued`/`已入队` 残留；frontend typecheck 通过。真实 diff 未超出微计划限制（2 文件、远低于 200 行）。

Closure Audit Evidence:

- Reviewer / Agent: 冷回放自查（`none` reviewer，非 protected、非高风险）
- Evidence: 见本 Closure 说明；grep 无残留 + frontend typecheck 通过；运行级 UI/下载交互留用户手动执行（记录于测试文档与日志）。

Follow-up:

- 无
