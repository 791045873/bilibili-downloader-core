# Bilibili 字幕下载功能实施计划

> Plan Status: planned
> Plan Audit: required
> Closure Audit: required
> Last Reviewed: 2026-06-15
> Source: `docs/input/SUBTITLE_DOWNLOAD_SPEC.md` + `docs/requirements/2026-06-15-subtitle-download-feature.md`
> Related: 无
> Audit: required

## Current Baseline

字幕下载功能的骨架已在代码中存在，但链路未打通：

- Core 层 `DownloadExecutionRequest` 有 `downloadSubtitle?: boolean`，但无语言筛选
- Adapter 层 `BilibiliSubtitleProvider` 已完整实现（WBI 签名 → PlayerV2 → JSON→SRT），但未在 `bilibili-api.ts` 工厂函数中导出
- Server 层 `download.service.ts` 的 `executionDeps.subtitleProvider` 设为 `undefined`，未注入
- `DownloadDto` 没有字幕相关字段
- 前端 VideoDetail 的画质/编码列已按分 P 独立选择
- 数据库 task 表无字幕列
- 当前是全局 boolean 开关，不按语言筛选
- CLI 当前不可用（用户确认），但类型检查必须通过

## Non-Goals

- 不修改 Downloading.vue（入队后不可改）
- 不修改 BilibiliSubtitleProvider 本身的逻辑
- 不修改 SubtitleProviderPort 接口定义
- 不修改 Settings.vue（设置页保持当前布尔值开关）
- 不涉及 CLI 字幕参数（CLI 当前不可用，但需保持 `pnpm typecheck` 通过）
- 不涉及弹幕下载
- 不需要默认无后缀字幕副本

## Execution Plan

### Phase 1 — Core 层：字段变更 + 筛选逻辑

Status: planned
Targets: `packages/core/src/usecases/DownloadExecutionUseCase.ts`, `packages/core/src/domain/DownloadRequest.ts`

- Item Types: Fix

- [ ] `DownloadRequest.downloadSubtitle?: boolean` → `subtitleLanguages?: "none" | "all" | string[]`
- [ ] `DownloadExecutionRequest.downloadSubtitle?: boolean` → `subtitleLanguages?: "none" | "all" | string[]`
- [ ] `DownloadExecutionUseCase.execute()` 中字幕写入逻辑：从 `request.subtitleLanguages` 读取，`"none"` 跳过，`"all"` 全部写入，`string[]` 只写 langKey 匹配的条目
- [ ] 移除生成无后缀副本的逻辑（如果有）
- [ ] No owner-doc update required

Exit Criteria:

- [ ] `pnpm typecheck` 通过
- [ ] 字段名从 `downloadSubtitle` 变为 `subtitleLanguages`
- [ ] 筛选逻辑正确：`"none"` 不写入任何文件，`"all"` 写入全部，`["zh-CN"]` 只写中文

### Phase 2 — Adapter 层：导出 SubtitleProvider

Status: planned
Targets: `packages/adapters/src/bilibili/bilibili-api.ts`

- Item Types: Add

- [ ] 导入 `BilibiliSubtitleProvider`
- [ ] 在 `createBilibiliApiAdapter` 的返回值中增加 `subtitleProvider` 字段
- [ ] No owner-doc update required

Exit Criteria:

- [ ] `pnpm typecheck` 通过
- [ ] `createBilibiliApiAdapter()` 返回的对象包含 `subtitleProvider` 属性

### Phase 3 — Server 层：DTO + 数据库 + 注入通路 + 迁移策略

Status: planned
Targets: `packages/server/src/download/download.dto.ts`, `packages/server/src/download/download.service.ts`, `packages/server/src/database/database.service.ts`

- Item Types: Add | Fix

- [ ] `download.dto.ts`：`DownloadDto` 增加 `subtitleLang?: string`
- [ ] `database.service.ts`：`TaskRecord` 增加 `subtitleLang?: string`
- [ ] `database.service.ts`：schema 增加 `subtitle_lang TEXT` 列
  - 在 `CREATE TABLE IF NOT EXISTS` 中新增列（新安装自动包含）
  - 追加 `ALTER TABLE task ADD COLUMN subtitle_lang TEXT`（容错处理 `duplicate column` 异常，确保已有数据库升级）
- [ ] `database.service.ts`：`insertTask` 透传 `subtitleLang`
- [ ] `download.service.ts`：导入 `BilibiliSubtitleProvider`
- [ ] `download.service.ts`：在 `onModuleInit` 中实例化并注入到 `executionDeps.subtitleProvider`
- [ ] `download.service.ts`：`createTask` 透传 `dto.subtitleLang` 到 `TaskRecord`
- [ ] `download.service.ts`：`executeTask` 中将 `task.subtitleLang` 转换为 `DownloadExecutionRequest.subtitleLanguages`
  - 转换规则：`"none"` → `"none"`, `"zh"` → `["zh-CN"]`, `"en"` → `["en-US"]`, `"all"` → `"all"`, `undefined`/`null` → `"none"`
- [ ] `download.service.ts`：`executeTask` 的 request 中增加 `subtitleLanguages` 字段
- [ ] CLI 最小修补：`packages/cli/src/commands/download.ts` 中 typecheck 兼容（保持 `DownloadRequest` 接口对齐，CLI 功能不修改）

Exit Criteria:

- [ ] `pnpm typecheck` 通过
- [ ] `POST /download` 的请求体可接收 `subtitleLang`
- [ ] SQLite task 表存储 `subtitle_lang` 字段
- [ ] `executeTask` 读取后正确转换并注入到 usecase

### Phase 4 — 前端：TreeTable 增加字幕列（入队前）

Status: planned
Targets: `packages/frontend/src/views/VideoDetail.vue`, `packages/frontend/src/api/index.ts`, `packages/frontend/src/types/index.ts`

- Item Types: Add

- [ ] `types/index.ts`：定义 `SubtitleLang = "none" | "zh" | "en" | "all"` 类型
- [ ] `api/index.ts`：`createDownload()` 参数增加 `subtitleLang?: string`
- [ ] `VideoDetail.vue`：TreeNode.data 增加 `selectedSubtitleLang: SubtitleLang` 字段，默认 `"none"`
- [ ] `VideoDetail.vue`：`parseAllInSection` 的解析结果中初始化字幕默认值为 `"none"`
- [ ] `VideoDetail.vue`：TreeTable 在"编码"列之后增加"字幕"列，使用 Select 下拉框
- [ ] `VideoDetail.vue`：`doAddToQueue()` 中读取 `subtitleLang` 并传入 `createDownload`
- [ ] No owner-doc update required

Exit Criteria:

- [ ] `pnpm typecheck` 通过（前端部分）
- [ ] TreeTable 每行有"字幕"列，四个选项可独立选择
- [ ] 加入下载队列时 `subtitleLang` 参数被正确发送

### Phase 5 — 后端字幕转换适配

Status: planned
Targets: `packages/server/src/download/download.service.ts`

- Item Types: Fix | Decision

- [ ] 确定转换规则：
  - `"none"` → `"none"`
  - `"zh"` → `["zh-CN"]`（仅匹配精确 langKey）
  - `"en"` → `["en-US"]`
  - `"all"` → `"all"`
- [ ] 如果后端发现字幕下载失败，只记录日志，不阻塞主流程（已有 try/catch）
- [ ] No owner-doc update required

Exit Criteria:

- [ ] 四种字幕语言选择均能正确映射到 `subtitleLanguages`
- [ ] `pnpm typecheck` 通过

### Phase 6 — 验证

Status: planned

- Item Types: Proof

- [ ] `pnpm typecheck` 全部包通过
- [ ] `pnpm build` 全部包通过
- [ ] `docs/testing/known-good-baselines.md` 更新

Exit Criteria:

- [ ] `pnpm typecheck` 零错误
- [ ] `pnpm build` 零错误

## Plan Audit

- Status: passed
- Reviewer / Agent: independent subagent (`General_4859334`)
- Evidence: 审计发现 4 个阻塞问题，已在下方修复。用户确认 CLI 当前不可用，暂不纳入范围。

### 阻塞问题修复记录

1. **CLI 范围泄露** — CLI 当前不可用（用户确认），因此在 Phase 3 中会增加 CLI 的最小类型修补以确保 `pnpm typecheck` 通过。
2. **数据库迁移** — Phase 3 增加 `ALTER TABLE` 迁移策略 + `undefined` 视为 `"none"`。
3. **需求文档不一致** — 已从需求文档验收标准中移除设置页和待下载页相关条目。
4. **CLI 类型检查** — Phase 3 中处理，保持 `pnpm typecheck` 通过。

## Closure Gates

- [ ] Phase 1-6 全部 exit criteria 满足
- [ ] 四种字幕语言选项均正确筛选
- [ ] 字幕不生成无后缀副本
- [ ] 字幕下载失败不阻塞主流程
- [ ] SubtitleProvider 已正确注入
- [ ] plan audit 通过
- [ ] implementation audit 通过
- [ ] text consistency 验证通过

## Deferred But Adjudicated

### 设置页字幕默认值

- Classification: out-of-scope improvement
- Why Not Blocking Closure: 当前需求只要求 VideoDetail 中逐任务选择，设置页保持当前布尔值开关
- Successor Required: no

### CLI 字幕参数

- Classification: out-of-scope improvement
- Why Not Blocking Closure: 当前不涉及 CLI
- Successor Required: no

## Closure

Status Note: 所有 5 个 Phase 实现完成，`pnpm typecheck` 和 `pnpm build` 全部通过，34 项审计检查 33 项通过（1 项非代码文档已修复）。

Closure Audit Evidence:
- Reviewer / Agent: independent subagent (`General_4863591`)
- Evidence: `docs/audits/` 审计记录，34 项检查 33 通过

Follow-up:
- 设置页字幕默认值（当前保持布尔值开关，后续可选项）
- CLI 字幕参数（CLI 当前不可用，后续支持）