# 2026-06-15 下载目录指定与查看计划

> Plan Status: completed
> Last Reviewed: 2026-06-15
> Source: `docs/requirements/2026-06-15-download-directory-view.md`
> Related: `docs/design/app-overview.md`
> Audit: required
> Testing: `docs/testing/2026/06-15-download-directory-view-testing.md`

## Current Baseline

- Server 使用 `process.env.OUTPUT_DIR ?? join(process.cwd(), "downloads")` 作为下载根目录。
- Web 入队弹框的 `outputPath` 实际是下载根目录下的相对子目录，不是完整根目录。
- 下载任务表已保存 `outputPath` 与成功后的 `outputFile`，前端类型已有 `outputFile?: string`。
- 下载列表目前不展示 `outputFile`。
- 设置页没有下载根目录展示或复制入口。
- 当前变更会新增 API 并改变设置页、视频详情页和下载列表的用户可见行为，因此需要 full plan 和审计。

## Goals

- 用户能在 Web 设置页查看当前服务端下载根目录。
- 用户能理解入队弹框填写的是相对子目录。
- 用户能在下载列表看到完成任务的实际输出文件路径。
- 后端提供清晰的只读目录配置 API。

## Non-Goals

- 不通过 Web 修改 `OUTPUT_DIR`。
- 不实现本机目录选择器或打开文件夹能力。
- 不改 Docker volume 语义。
- 不改 CLI 行为。

## Infrastructure And Config Prereqs

- No infra prereqs beyond existing baseline.

## Execution Plan

### Phase 1 - 下载目录查看与展示

Status: completed
Targets: `packages/server/src/download/*`, `packages/frontend/src/api/index.ts`, `packages/frontend/src/types/index.ts`, `packages/frontend/src/views/Settings.vue`, `packages/frontend/src/views/Downloading.vue`, `packages/frontend/src/views/VideoDetail.vue`, `docs/design/app-overview.md`

- Item Types: Add | Fix | Decision | Proof
- Prereqs: plan audit passed

- [x] **Add**：在 server 下载模块新增只读目录配置查询能力，返回当前 `outputDir` 与配置来源。
- [x] **Add**：在 frontend API/types 中声明目录配置接口。
- [x] **Add**：在设置页展示当前下载根目录、配置来源和复制操作。
- [x] **Fix**：调整视频详情页入队目录弹框文案，明确字段为相对子目录。
- [x] **Add**：在下载列表展示存在 `outputFile` 的任务输出文件路径。
- [x] **Fix**：更新 `docs/design/app-overview.md`，记录当前支持的下载目录行为。
- [x] **Proof**：运行 `pnpm typecheck`，并记录手动观察设置页/下载列表/入队弹框状态。

Exit Criteria:

- [x] `GET /api/download/config` 可返回当前服务端下载根目录信息。
- [x] 设置页、入队弹框、下载列表的下载目录语义一致。
- [x] owner doc 已更新。
- [x] `docs/testing/` 对应方向已回填验证结果。
- [x] `docs/logs/` 已更新。

## Plan Audit

- Status: passed
- Reviewer / Agent: independent subagent
- Evidence: `General_3881186` 首轮指出测试说明缺少 `GET /api/download/config` 直接验证和复制行为验证；已补齐 API 测试方向、复制测试方向，并明确 API 返回绝对路径、下载列表只要求查看输出文件路径。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run (`pnpm typecheck` plus manual UI/API observation)
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent (or cold-replay proxy documented)
- [x] closure evidence exists in files

## Deferred But Adjudicated

### Web 修改服务端下载根目录

- Classification: out-of-scope improvement
- Why Not Blocking Closure: 修改 `OUTPUT_DIR` 涉及服务端配置持久化、权限和部署语义；当前需求先解决查看与相对子目录说明。
- Successor Required: no

## Closure

Status Note: 下载目录查看、相对子目录说明、完成任务输出路径展示、只读配置 API 与文档更新均已完成，验证通过。

Closure Audit Evidence:

- Reviewer / Agent: independent subagent
- Evidence: `General_3882375` 执行 closure audit，指出 closure evidence 尚未回填；实现、API 边界、需求验收、backlog/context/logs 均通过。已将该审计结果回填为 closure evidence。

Follow-up:

- 无
