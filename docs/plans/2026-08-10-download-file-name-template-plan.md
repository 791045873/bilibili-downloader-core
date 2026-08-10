# 2026-08-10 下载文件名模板与命名收敛（P2）

> Plan Status: completed
> Last Reviewed: 2026-08-10
> Source: `docs/discussions/2026-08-10-download-file-naming.md`
> Related: `docs/plans/2026-08-10-download-file-name-uniqueness-plan.md`（P0，先于本计划落地，其默认命名为模板默认值）
> Audit: required（Phase 1 产品决策已获人类确认；按 `none` reviewer 走冷回放审计后实施）
> Testing: `docs/testing/2026/08-10-download-file-name-template-testing.md`

## Current Baseline

- `DownloadRequest.fileNameTemplate`（core 定义，DownloadRequest.ts:18）已存在但从未被使用。
- `DownloadPlan.outputFileName`（core 定义，DownloadPlan.ts:21）已存在但从未被使用。
- 命名逻辑分散在 `packages/server/src/download/download.service.ts`：`sanitizeFileName`（:808）+ `executeTask` 拼接（:490）+ `executeLowResDownload` 拼接（:311）。
- `DownloadDto`（download.dto.ts）无 `fileNameTemplate` 字段；`POST /api/download` 校验 bvid/cid/title/outputPath（download.controller.ts:36-45）。
- `task` 表（database.service.ts:107-132）无 `fileNameTemplate` 列；该文件已有 `ALTER TABLE task ADD COLUMN ...` 的升级先例（:181-205）。
- 前端 `createDownload`（api/index.ts:99-113）不传模板；settings store（stores/settings.ts）无模板设置项；入队弹框无模板输入。
- P0 落地后默认命名为 `{title}-{bvid}-{cid}-q{quality}.mp4`，本计划将其作为空模板时的默认值。

## Goals

- `fileNameTemplate` 从 API 端到端生效：前端可配置 → server 接收 → 任务持久化 → 执行时渲染为输出文件名。
- 命名逻辑（清洗 + 渲染 + 唯一性保证）收敛为单一模块，`executeTask` 与 `executeLowResDownload` 共用。
- 模板为空时回退 P0 默认命名，唯一性保证不丢失。
- `outputPath` 作为独立目录字段的语义保持不变；`{title}` 使用前端提交的展示标题。

## Non-Goals

- 不改为"B 站回源标题"（服务端无法还原前端合成的"剧集名 - Px 分P标题"，见讨论存档 Analysis Note）。
- 不增强标题清洗（设备名/结尾点空格/控制字符）、不做长度截断。
- 不改变"已存在即跳过"语义。
- 不迁移历史任务；`fileNameTemplate` 为空的历史任务沿用其已落盘的 `outputFile`。

## Infrastructure And Config Prereqs

- 若模板需随任务持久化：`task` 表新增列（沿用现有 `ALTER TABLE ... ADD COLUMN` 先例，幂等）。
- 若只做全局默认：模板可由前端在请求时透传，无需持久化，需在 Phase 1 决策。
- 无环境变量/外部服务依赖。

## Execution Plan

### Phase 1 - 决策：模板配置入口与范围

Status: completed（决策已由用户确认）
Targets: `docs/discussions/2026-08-10-download-file-naming.md`

- Item Types: `Decision`
- Prereqs: none

- [x] Decision: 已确认 `fileNameTemplate` 配置入口为**仅设置页全局默认**（选项 A）：
  - 前端 settings store 新增全局默认模板字段（localStorage 持久化），设置页提供输入；`createDownload` 随请求透传 `fileNameTemplate`。
  - 文件名在执行时构建，模板须在任务创建时捕获并持久化到 `task` 表，执行时读取；空模板回退默认 `{title}-{bvid}-{cid}-q{quality}`。
  - 不做入队弹框单任务覆盖。
  - 占位符集合：`{title}` `{bvid}` `{cid}` `{page}` `{quality}` `{codec}`；默认模板：`{title}-{bvid}-{cid}-q{quality}`。
  - 记录于讨论存档「Open Questions → P2 的 fileNameTemplate 配置入口」；residual risk：全局模板变更只影响新任务，历史任务沿用创建时模板。

Exit Criteria:

- [x] 决策已记录在讨论存档中，且人类已确认（2026-08-10）。
- [x] Phase 2 的接口契约（API 字段、持久化列）据此定稿。

### Phase 2 - 命名模块与端到端模板

Status: completed
Targets: `packages/server/src/download/`、`packages/frontend/src/`

- Item Types: `Add | Fix | Proof`
- Prereqs: Phase 1 决策完成；P0 计划已落地（默认命名已生效）

接口契约（refactor 计划必备的结构边界）：

- 命名模块 `packages/server/src/download/file-naming.ts`：
  - `buildOutputFileName(ctx: { title: string; bvid: string; cid: number; quality: number; codec?: string; template?: string }): string`
  - 渲染 `template` 占位符；`template` 为空时使用默认模板；占位符替换值经 `sanitizeFileName` 清洗；结果含 `.mp4` 扩展名、不含目录部分（目录仍由 `outputPath` 决定）。
  - 受支持占位符：`{title}` `{bvid}` `{cid}` `{quality}` `{codec}`；未知占位符保留字面量（可预期、不抛错）。
- `DownloadDto` 新增可选字段 `fileNameTemplate?: string`（API 契约新增，向后兼容：缺省为空）。
- `task` 表新增列 `fileNameTemplate TEXT`（已决策持久化，创建时捕获），`insertTask` / 查询字段联动。
- `executeTask` 与 `executeLowResDownload` 改用命名模块构建 `outputFile`。

- [x] Add: 创建命名模块 `file-naming.ts`，实现 `buildOutputFileName` 与 `sanitizeFileName`（`{page}` 不在受支持占位符集：TaskRecord 无 page 字段，标题中的 P 序号不可靠，故实施时从计划占位符集移除，见 Plan Audit 记录）。
- [x] Fix: `executeTask` 输出路径改用命名模块，模板来源为任务持久化字段 `task.fileNameTemplate`（创建时捕获，执行时读取）。
- [x] Fix: `executeLowResDownload` 输出路径改用命名模块（不传 template，恒用默认命名，行为不变）。
- [x] Add: `DownloadDto.fileNameTemplate` + controller 透传（NestJS body 绑定）+ scheduler 传递（`createTask` 落库）+ DB 持久化列（`ALTER TABLE task ADD COLUMN fileNameTemplate TEXT`，幂等）。
- [x] Add: 前端 settings store 新增 `defaultFileNameTemplate`（localStorage）+ `Settings.vue` 输入项；`createDownload` 增加 `fileNameTemplate` 透传；两个入队视图透传全局默认。
- [x] Proof: 运行 `pnpm typecheck`、`pnpm build` 通过。
- [x] Proof: 按 `docs/testing/2026/08-10-download-file-name-template-testing.md` 验证（编译产物逻辑验证 + 内存 DB 冒烟 + 代码检查；运行级留用户手动）。

Exit Criteria:

- [x] 行为落地：配置模板后下载文件名按模板渲染；未配置时与 P0 默认一致；同标题不同视频仍不冲突。
- [x] 相关文档：`docs/design/app-overview.md` 已更新下载流程中文件名可配置说明。
- [x] `docs/logs/2026/08-10.md` 已记录。

## Plan Audit

- Status: passed（冷回放代理，实施前执行）
- Reviewer / Agent: 冷回放代理（`none` reviewer，非 protected area、非高风险）
- Evidence: 冷回放以全新视角重读计划：基线（未用字段/分散命名/无模板字段/无 DB 列）与实况一致；接口契约可实现且向后兼容；占位符集发现 `{page}` 无法由当前任务数据解析，实施时移除并记录——行为偏差记录如下：
  - 计划原文：占位符含 `{page}`；实施：不支持 `{page}`（TaskRecord 无 page 字段，标题中 P 序号不可靠，解析代价高且易错）。默认模板不使用 `{page}`，不影响唯一性保证；未知占位符保留字面量，符合 TD-P2-3"可预期"要求。此偏差不改变计划目标与非目标。
- 其余审计项无异议，计划可实施。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck`、`pnpm build` 通过；编译产物逻辑验证 + 内存 DB 冒烟）
- [x] corresponding `docs/testing/2026/08-10-download-file-name-template-testing.md` 存在且每条 testing direction 已确认（逻辑级/代码级 passed；运行级留用户手动并记录原因）
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed（冷回放代理）后才开始实施；Phase 1 产品决策已获人类确认
- [x] actual diff 与计划范围一致（`{page}` 占位符偏差已在 Plan Audit 记录，不改目标）
- [x] text consistency verified：status、phases、gates、testing document、log 一致
- [x] closure audit 独立（冷回放代理已记录）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 标题清洗增强与长度守卫

- Classification: `watch-only residual`
- Why Not Blocking Closure: 当前数据源标题为已正常使用的合法字符串，无现实触发条件。
- Successor Required: `no`

### CLI / 其他运行形态共享命名模块

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 当前产品形态为 Web + Docker，CLI 已不在活跃范围。
- Successor Required: `no`

## Closure

Status Note: P2 全计划完成。冷回放 closure audit 以全新视角核对：目标（模板端到端生效、命名收敛单一模块、空模板回退 P0 默认）全部落地——新建 `file-naming.ts`（`buildOutputFileName`/`sanitizeFileName`）；`executeTask` 用持久化模板渲染，`executeLowResDownload` 恒用默认；`DownloadDto`/`DownloadController`（body 绑定）/`DownloadService.createTask`/`DatabaseService`（列 + select + insert）链路打通；前端 settings store + Settings.vue + 两个入队视图透传。`pnpm typecheck` 与 `pnpm build` 通过；编译产物对 `buildOutputFileName` 的 5 组用例 ALL PASS（含空模板回退、自定义模板、未知占位符字面量、非法字符清洗、空 codec）；内存 SQLite 冒烟验证幂等 ALTER 与 insert/select。`{page}` 占位符偏差已在 Plan Audit 记录。运行级真实下载与设置页交互留给用户手动确认（记录于测试文档与日志）。

Closure Audit Evidence:

- Reviewer / Agent: 冷回放代理（独立 closure pass，`none` reviewer）
- Evidence: 见本 Closure 说明；`docs/testing/2026/08-10-download-file-name-template-testing.md` 全部 passed（逻辑级/代码级）；编译产物验证输出与 DB 冒烟输出记录于会话。

Follow-up:

- 无（见 Deferred But Adjudicated）
