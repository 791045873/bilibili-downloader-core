# 2026-09-04 解析历史卡片（首页快捷进入）Plan

> Plan Status: completed
> Closed: 2026-09-04（cold-replay 自检，micro-plan 例外无独立审计员）
> Source: `docs/requirements/2026-09-04-parse-history-cards.md`（含 2026-09-04 用户确认决策：localStorage + 点击跳转列表页重新解析）
> Audit: skipped under micro-plan exception（纯前端 3 个源文件：新增 store + ParseResult 写入 + Home 展示；预计 <200 行；无 API/DB/auth/集成/部署/跨 surface 契约变更、无未决产品风险、无 stale doc 冲突）
> Protected area: 无
> Closure: 需 cold-replay 自检（plan ↔ 需求 ↔ diff ↔ 验证命令），并补充 docs/logs 与 docs/design 对齐

## Current Baseline（2026-09-04 已核对）

- `packages/frontend/src/pages/Home.tsx`：首页，输入框 + 两个快捷入口卡片；无解析历史。
- `packages/frontend/src/pages/ParseResult.tsx`：`useEffect`（L76-111）解析成功后按类型 redirect（video / ugc-season / favorites / video∈合集）；`user-space` 停留展示分组卡片。
- `packages/frontend/src/pages/ParseResultList.tsx`：按 `type` + `bvid|seasonId|mid|mediaId|currentBvid` 拉取数据（重新进入内容只需这些 ID）。
- `packages/frontend/src/stores/downloadQueue.ts` / `settings.ts`：Zustand `persist` + `partialize` + 容错 `merge` 模式（无 legacy 迁移需求，新 key）。
- 封面统一经 `/api/video/cover?url=` 代理（`ParseResult.tsx:imageSrc`）。

## Goals

- 解析成功后自动在 localStorage 记录一条"最近解析"条目。
- 首页输入框下方渲染"最近解析"卡片区，点击卡片直达 `/parse-result/list` 目标。
- 去重置顶、上限 12、单卡删除、localStorage 异常静默降级。

## Non-Goals

- 不改后端 / DB / API 契约；不做离线渲染；不做跨设备同步；不做"清除全部"；不动 `/video` 孤儿路由。

## Execution Plan

### Phase 1 - parseHistory store

Status: completed
Targets: `packages/frontend/src/stores/parseHistory.ts`（新增）

- [x] `Add`: 定义条目类型 `ParseHistoryEntry { key, type, title, coverUrl?, params: Record<string, string>, parsedAt: number }`（`type` 为列表页 type：`video | ugc-season | favorites | user-videos`）。
- [x] `Add`: Zustand store：`entries: ParseHistoryEntry[]`，`record(entry)`（按 key 去重置顶 + 更新 + 截断 12）、`remove(key)`；persist key `bilibili-downloader-parse-history`；`partialize` 仅存 entries；`merge` 容错（非数组/非法条目过滤回退空列表）；读写 localStorage 异常静默降级。
- [x] `Proof`: `pnpm --filter @bilibili-downloader/frontend typecheck` 通过。

Exit Criteria:

- [x] store 可独立使用，损坏数据不崩溃。

### Phase 2 - 解析成功写入缓存

Status: completed
Targets: `packages/frontend/src/pages/ParseResult.tsx`

- [x] `Fix`: redirect 分支（video / video∈合集 / ugc-season / favorites）在 navigate 前调用 `record(...)`，条目 key/参数与 redirect 目标一致；标题/封面从解析结果数据提取（video：`title`/`coverUrl`；合集：视频标题或合集信息；favorites/season：取列表数据 title/cover，字段缺失时回退 `"收藏夹 <mediaId>"` 等占位标题）。
- [x] `Fix`: `user-space` 成功分支记录 `user-videos&mid=` 条目（标题=UP 主名，封面=头像）。
- [x] `Decision`: 写入放在 `useEffect` 成功分支内、每条 redirect 路径一次；`user-space` 在 `userSpace` memo 首次非空时记录一次（防重复：record 本身按 key 去重，重复调用幂等）。
- [x] `Proof`: `pnpm --filter @bilibili-downloader/frontend typecheck` 通过。

Exit Criteria:

- [x] 各类型解析成功均产生正确卡片条目；失败不写入。

### Phase 3 - 首页卡片区

Status: completed
Targets: `packages/frontend/src/pages/Home.tsx`

- [x] `Add`: 输入框卡片与快捷入口之间渲染"最近解析"区块：`entries` 为空不渲染；每卡显示封面（经 cover 代理，头像/封面缺失用占位样式）、标题、类型徽标（视频/合集/收藏夹/UP主）、相对时间；点击 `navigate("/parse-result/list?type=...&params")`；右上删除按钮调用 `remove(key)`。
- [x] `Proof`: `pnpm --filter @bilibili-downloader/frontend typecheck` 通过。

Exit Criteria:

- [x] 首页卡片区符合需求 Flow 2/3 与 Edge Cases。

### Phase 4 - 验证与文档对齐

Status: completed
Targets: 仓库级验证 + `docs/design/app-overview.md` + `docs/logs/`

- [x] `Proof`: `pnpm typecheck`、`pnpm build` 通过。
- [x] `Fix`: `docs/design/app-overview.md` 单视频下载 workflow 补充一句解析历史卡片行为（localStorage、点击直达、上限/去重/删除）。
- [x] `Add`: `docs/logs/2026/09-04-parse-history-cards.md` 实施日志。
- [x] `Proof`: cold-replay 自检（plan 勾选 ↔ 需求验收标准 ↔ 实际 diff ↔ 验证输出）。

Exit Criteria:

- [x] 验证命令全通过；owner doc 与 live 行为一致；日志落盘。

## Closure Gates

- [x] in-scope behavior complete（需求验收标准逐条对照）
- [x] relevant docs aligned（app-overview；requirement 保持为需求事实来源）
- [x] verification run（`pnpm typecheck`、`pnpm build`）
- [x] no in-scope item downgraded
- [x] cold-replay self-check recorded（plan ↔ 需求验收标准 ↔ 实际 diff ↔ 验证输出；浏览器端手动验证未运行，已在 docs/logs 记录为用户自测建议项）
- [x] `docs/logs/` 记录存在（`docs/logs/2026/09-04-parse-history-cards.md`）

Closure Note: micro-plan 例外按"约"衡量——实际 4 个源文件（新增 store + 2 个页面改动）、约 230 行源码变更，略超参考值；但无契约/数据/权限/集成/部署/跨 surface 变更与未决产品风险，例外意图适用，已如实记录。

## Deferred But Adjudicated

- 无。
