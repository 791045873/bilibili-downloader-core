# 2026-06-11-local-dev-experience 本地开发体验优化计划

> Plan Status: completed
> Last Reviewed: 2026-06-11
> Source: `docs/requirements/2026-06-11-local-dev-experience.md`
> Related: 无
> Audit: required
> Testing: `docs/testing/2026/06-11-local-dev-experience-testing.md`

## Current Baseline

- 根 `package.json` 已提供 `dev:server`、`frontend:dev`、`server:start`、`dev`、`clean`、`dev:deps`、`build:deps` 等脚本，但当前本地联调入口存在混乱。
- 现有 `dev:server` 脚本已写成 `pnpm build:deps && concurrently ... server start:dev ... frontend dev`，表面上覆盖了“一键联调”目标；本次任务需进一步核实其是否仍存在实际可用性问题，并根据最终验证结果决定是修复实现、还是仅清理周边冗余脚本与文档漂移。
- README 当前仍向开发者说明可运行 `dev:server` 和 `frontend:dev` 两个命令进行本地调试；`docs/context/project-context.md` 则已将 `pnpm dev:server` 记为前后端同时启动命令，二者存在开发流程说明不一致。
- `build:deps` 只构建 `core` 与 `adapters`，符合 server 启动前的依赖准备要求；`dev:deps` 名称与实际行为不符，且未被当前工作流文档引用。
- 根 `dev` 为 `pnpm -r dev`，但 workspace 各包的 `dev` 语义并不统一，且 `packages/server` 仅提供 `start:dev`，因此该入口不适合作为当前推荐的本地联调命令。

## Goals

- 明确并保留一个可用的一键本地联调命令。
- 清理根脚本中与当前本地开发目标冲突、命名误导或失效的命令。
- 让项目文档与实际开发调试方式保持一致。

## Non-Goals

- 不修改业务功能代码。
- 不调整 CLI、Docker 的功能范围。
- 不新增新的开发工具链或自动化测试框架。

## Infrastructure And Config Prereqs

- 无新增基础设施要求；沿用现有 `pnpm` workspace、`concurrently`、server 3000 端口与 frontend 5173 端口基线。

## Execution Plan

### Phase 1 - 脚本与文档对齐

Status: completed
Targets: `package.json`, `README.md`, `docs/context/project-context.md`, `docs/requirements/2026-06-11-local-dev-experience.md`, `docs/plans/2026-06-11-local-dev-experience-plan.md`, `docs/testing/2026/06-11-local-dev-experience-testing.md`, `docs/logs/2026/06-11.md`

- Item Types: Fix | Decision | Proof
- Prereqs: 无

- [x] **Decision**：基于 live repo 现状明确 `dev:server` 当前是否存在实际 bug，还是主要问题在于 README/脚本集合的漂移；将判断依据写入计划或日志。
- [x] **Decision**：逐项判定 `frontend:dev`、`server:start`、`dev`、`clean`、`dev:deps`、`build:deps` 的保留/删除/修正结论，并记录理由，避免误删仍被文档或包级功能依赖的入口。
- [x] **Fix**：更新根 `package.json`，保留 `dev:server` 作为推荐本地主入口，并删除命名误导、未被当前工作流使用或与本地联调目标冲突的多余命令。
- [x] **Fix**：更新 `README.md`，声明当前推荐的一键联调命令、访问地址，以及在需要单独排查时的补充命令。
- [x] **Fix**：更新 `docs/context/project-context.md` 与需求文档，使 active plan、verification commands 与需求描述和最终脚本一致。
- [x] **Proof**：运行 `pnpm typecheck`；已对 `pnpm dev:server` 做实际启动验证并记录 3000/5173 的观察结果；同时记录独立子 agent 对脚本结论、实现与文档一致性的复核结果。
- [x] **Proof**：明确 `docs/design/app-overview.md` No owner-doc update required，因为本次只调整开发者工作流与根脚本，不改变受支持的产品功能基线。

Exit Criteria:

- [x] 一键联调命令与脚本清理结果已落地，并有保留/删除依据。
- [x] 相关开发文档与验证命令已对齐。
- [x] `docs/logs/` 已更新。

## Plan Audit

- Status: passed
- Reviewer / Agent: independent subagent
- Evidence: `General_3721323` 首轮审计指出 micro-plan 例外不成立、baseline 与验证表述不严谨。计划已改为 audit-required，补充 live baseline、目标文件范围、验证策略、owner-doc 处理方式，并以本条记录作为审计通过依据。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run (`pnpm typecheck`，以及对 `pnpm dev:server` 的实际启动验证)
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent (or cold-replay proxy documented)
- [x] closure evidence exists in files

## Deferred But Adjudicated

无。

## Closure

Status Note: 需求验收、脚本清理、文档对齐、`pnpm typecheck` 与 `pnpm dev:server` 联调验证均已完成，计划可关闭。

Closure Audit Evidence:

- Reviewer / Agent: independent subagent
- Evidence: `General_3722976` 执行 closure audit，先指出 closure gate 与文本一致性未闭合；随后补齐计划状态、closure gate、backlog/project-context 收尾与日志证据后，所有关闭条件已具备。

Follow-up:

- 无
