# 2026-09-04 解析历史卡片（首页快捷进入）实施日志

## Summary

- 新增 `packages/frontend/src/stores/parseHistory.ts`：Zustand persist store（key `bilibili-downloader-parse-history`），条目 `{ key, type, title, coverUrl?, params, parsedAt }`；`record` 按 key 去重置顶并截断 12 条，`remove` 单卡删除；`merge` 用 `isValidEntry` 过滤损坏数据，localStorage 异常由 zustand persist 静默降级。
- `packages/frontend/src/pages/ParseResult.tsx`：新增 `toHistoryEntry`，解析成功后各 redirect 分支（video / video∈合集 / ugc-season / favorites）与 user-space 分支统一记录入口信息；条目参数与 redirect 目标一致（user-space 按用户确认直达 `user-videos&mid=` 投稿视频列表）。
- `packages/frontend/src/pages/Home.tsx`：输入框下方新增"最近解析"卡片区（空缓存不渲染）；封面经 `/api/video/cover?url=` 代理；含类型徽标、相对时间、单卡删除（stopPropagation 防误触导航）。

## Decisions

- 缓存粒度与 user-space 卡片去向由用户确认，见 `docs/discussions/2026-09-04-parse-history-cache-granularity.md`；需求同步修订于 `docs/requirements/2026-09-04-parse-history-cards.md`。
- 不缓存完整解析结果：4 种类型中仅 `video`（非合集）路径再次进入会重复 parseLink，但列表页仍需 `checkTasks` 实时状态，收益有限且引入 pages 过期风险。

## Verification

- `pnpm typecheck` 通过（首轮发现 `toHistoryEntry` 联合类型推断与 `Record<string, string>` 不兼容，补充显式返回类型 `ParseHistoryEntry` 后通过）。
- `pnpm build` 通过。
- 未运行浏览器端手动验证（本会话无运行环境）；建议用户自测：解析各类型 → 首页出现卡片 → 点击直达 → 重复解析去重置顶 → 删除卡片 → 清空 localStorage 后不崩溃。

## Docs

- `docs/requirements/2026-09-04-parse-history-cards.md`（需求）
- `docs/discussions/2026-09-04-parse-history-cache-granularity.md`（缓存粒度讨论）
- `docs/plans/2026-09-04-parse-history-cards-plan.md`（plan，micro-plan 例外跳过独立审计，closure 走 cold-replay 自检）
- `docs/design/app-overview.md`（当前基线说明补充解析历史卡片行为）
