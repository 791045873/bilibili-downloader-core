# 2026-08-21 任务状态筛选支持多选（下载队列 + AI 总结）

> Plan Status: completed
> Last Reviewed: 2026-08-21
> Source: 用户需求——「总结表格与下载队列两处的状态筛选下拉都支持多选，可同时查看进行中与失败任务」
> Related: `docs/plans/2026-08-13-pagination-and-filter-plan.md`
> Audit: required（独立 subagent，reviewer availability = none）
> Testing: `docs/testing/2026/08-21-task-status-multiselect-filter-testing.md`

## Current Baseline

- 下载队列 `/tasks`：`statusGroup` 查询参数（单值），`parseTaskStatusGroup` 校验 `["all","active","created","downloading","success","failed","stopped"]`（`download.controller.ts:205`）；`buildTaskStatusFilter` 按 switch 生成 `WHERE t.status = ?`（`active` 特判为 `IN (created, downloading)`，`database.service.ts:1010`）。
- AI 总结 `/summary-tasks`：`status` 查询参数（单值），`parseAiSummaryStatus` 校验 `["all","pending","analyzing","failed","completed"]`（`analysis-task.controller.ts:329`）；`buildAiSummaryTaskFilter` 生成 `status = ?`（`database.service.ts:1045`）。
- 前端两页均为单选 `Select`：`AiSummaryTasks.tsx:443`、`Downloading.tsx:449`，状态类型为单个 `TaskStatusGroup` / `AiSummaryTaskStatus`（`types/index.ts:174,209`）。
- 当前无法同时查看"进行中 + 失败"等组合。

## Goals

- 下载队列与 AI 总结两页的状态筛选支持**多选**，可同时查看任意状态组合（如进行中 + 失败）。
- 后端接口支持多状态过滤（`IN` 查询），保持对既有单值调用的向后兼容。
- 空选择 = 查看全部（多选下移除"全部"单选项）。

## Non-Goals

- 不改其他筛选维度（搜索/日期）的单值行为。
- 不引入新的前端组件/依赖（复用 antd `Select mode="multiple"`）。
- 不改动任务状态机的取值集合（新增/删除状态值属另一范围）。
- 不实现"全选/反选"等额外交互。

## Infrastructure And Config Prereqs

- 无新增环境变量/端口/依赖。仅查询参数语义变化。

## Execution Plan

### Phase 1 - 后端多值过滤

Status: completed
Targets: `packages/server/src/download/download.controller.ts`, `packages/server/src/download/download.service.ts`, `packages/server/src/database/database.service.ts`, `packages/server/src/analysis/analysis-task.controller.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`

- Item Types: `Add | Decision | Proof`
- Prereqs: 无

- [x] `Decision`: 多值编码用**逗号分隔**（`statusGroup=active,failed` / `status=analyzing,failed`），单值旧调用自动兼容（单元素数组）。
- [x] `Add`: `download.controller.ts` `parseTaskStatusGroup` 改为解析逗号分隔 → `TaskStatusGroup[]`（空值/`"all"` → `[]` 表示不过滤）；`download.service.ts`、`listTasksPaginated` 参数 `statusGroup` 改为数组。
- [x] `Add`: `database.service.ts` `buildTaskStatusFilter` 改为数组语义：`active` 展开为 `created+downloading`，去重后生成 `t.status IN (?,...)`；空数组不过滤。
- [x] `Add`: `analysis-task.controller.ts` `parseAiSummaryStatus` 改为解析逗号分隔 → `AiSummaryStatus[]`；`analysis-trigger.service.ts` `getAiSummaryTasksPaginated` 的 `filter.status` 改为数组。
- [x] `Add`: `database.service.ts` `buildAiSummaryTaskFilter` 对数组生成 `status IN (?,...)`；空数组不过滤。
- [x] `Proof`: 运行级接口验证——单值、多值、`active` 展开、空/`all`、非法值 400（见 testing 文档）。

Exit Criteria:

- [x] `/tasks?statusGroup=active,failed` 返回 created+downloading+failed 的任务；`/summary-tasks?status=analyzing,failed` 返回对应任务。
- [x] 旧单值调用（`statusGroup=active` / `status=failed`）行为不变；`all`/缺省/空 行为不变（全部）。
- [x] 非法值仍 400；`pnpm typecheck`、`pnpm build` 通过。

### Phase 2 - 前端多选

Status: completed
Targets: `packages/frontend/src/api/index.ts`, `packages/frontend/src/types/index.ts`, `packages/frontend/src/pages/AiSummaryTasks.tsx`, `packages/frontend/src/pages/Downloading.tsx`

- Item Types: `Add | Proof`
- Prereqs: Phase 1

- [x] `Add`: `api/index.ts` `getTasks`/`getAiSummaryTasks` 参数 `statusGroup`/`status` 改为数组，逗号拼接进 query。
- [x] `Add`: `types/index.ts` 保留单值联合类型；页面状态改用 `TaskStatusGroup[]` / `AiSummaryTaskStatus[]`。
- [x] `Add`: `AiSummaryTasks.tsx` 状态 `Select` 改 `mode="multiple"`，选项移除"全部"，空数组=全部；`hasActiveFilter` 相应更新。
- [x] `Add`: `Downloading.tsx` 状态 `Select` 改 `mode="multiple"`，选项移除"全部任务"，空数组=全部；queryKey 含数组。
- [x] `Proof`: 对应 testing 文档方向；`pnpm typecheck`、`pnpm build` 通过；手动/接口验证多选组合查询。

Exit Criteria:

- [x] 两页状态筛选可多选，选中组合（如进行中+失败）后列表仅含对应状态。
- [x] 清空选择回到全部；选中/取消即时生效并回到第 1 页。
- [x] `pnpm typecheck`、`pnpm build` 通过；`docs/logs/2026/08-21.md` 追加记录（或追加至现有条目）。

## Plan Audit

- Status: passed
- Reviewer / Agent: cold-replay proxy（reviewer availability = none）
- Evidence: 冷重放自检——计划 Goals/范围/闭核算门与实施后的真实 diff、验证输出一致；非受保护区域（不涉 deployment/auth/data-deletion），cold-replay 合规。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck`、`pnpm build`、运行级接口验证）
- [x] `docs/testing/2026/08-21-task-status-multiselect-filter-testing.md` exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation（cold-replay proxy）
- [x] micro-plan exception not applicable（API 契约 + 双 feature surface + 多模块，full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（cold-replay proxy 复核）
- [x] closure evidence exists in files

## Decision

### 多值编码：逗号分隔

- 选择：GET query 用逗号分隔单参数（`statusGroup=active,failed`），后端 split + 逐项校验。
- 备选：(a) 重复参数 `?status=a&status=b`——NestJS 默认 `@Query` 只取首个，需改用数组参数解析，改动更大且编码含义隐晦；(b) 新参数名 `statuses[]`——破坏现契约且前端编码复杂。
- 残余风险：状态值本身不含逗号，无歧义；URL 长度受限于有限状态数，可接受。单值旧调用自动兼容（单元素数组）。

### "全部"选项移除，空选择=全部

- 选择：多选下拉不再提供"全部/全部任务"项，未选任何状态即表示全部。
- 备选：保留"全部"作为可选项并互斥——antd multiple 下实现复杂且易误触。空=全部更符合多选惯例。
- 残余风险：用户可能不知道空选=全部；以 placeholder「全部状态/全部任务」提示缓解，可接受。

### "active" 组在数组内的展开

- 选择：多选中出现 `active` 时展开为 `created+downloading` 后并入 IN 集合（去重）。
- 备选：禁止 `active` 与其他值组合——无必要限制。展开更符合直觉。

## Deferred But Adjudicated

### 状态值集合扩展

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 本次仅改筛选能力，不增删状态值；如需新状态（如 `paused`）另立需求。
- Successor Required: `no`

## Closure

Status Note: 全计划完成。后端两接口支持逗号分隔多值过滤（IN 查询、active 展开、去重、空=全部、非法 400、单值兼容）；前端两页状态筛选改多选。冷重放自检通过。

Closure Audit Evidence:

- Reviewer / Agent: cold-replay proxy（reviewer availability = none）
- Evidence: 冷重放复核——对照计划 Goals/Exit Criteria/Closure Gates 逐条核对真实 diff 与运行级接口验证输出（14+4 项 PASS、含 4 项 400），typecheck/build exit 0；testing 文档方向全部确认或裁定；日志 `docs/logs/2026/08-21.md` 一致。未发现受保护项或源真值冲突遗留。

Follow-up:

- 无