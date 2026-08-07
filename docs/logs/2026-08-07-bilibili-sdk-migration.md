# 2026-08-07 bilibili-api-sdk 迁移与 API 调用替换

## 变更摘要

将独立仓库 `bilibili-api/bilibili-api-sdk` 迁入本仓库 `packages/bilibili-api-sdk`（pnpm workspace 包），并用其替换 adapters 中全部自研 B 站 API 调用。

## 迁移

- 迁入 `src/`、`tests/`、`vitest.config.ts`、`API.md`、`README.md`；`package.json` 对齐 workspace（typescript ^5.7、@types/node ^22，去掉 npm 发布脚本）。
- 根 `package.json` 的 `build:deps` 增加 `--filter bilibili-api-sdk`，保证 SDK 先于 adapters 构建。
- `packages/adapters` 增加依赖 `"bilibili-api-sdk": "workspace:*"`。

## SDK 扩展（补齐 downloader 所需接口）

- `VideoApi.playurl` 端点改为 `/x/player/wbi/playurl`（与 downloader 原实现一致）。
- 新增 `BangumiApi` / `CheeseApi`（`api/pgc.ts`）：pgc/pugv playurl，兼容 `data`/`result` 两种响应结构。
- 新增 `PlayerApi.playerV2`（`api/player.ts` + `models/player.ts`）：字幕列表。
- `UserApi` 新增 `accInfo`、`spaceArcSearch`、`seasonsSeriesList`、`seasonsArchivesList`（空间信息/投稿/合集）。
- `BilibiliClient` 新增 `setCookies(cookieString)`：整体替换会话 Cookie。
- 修复 `FavoriteApi.resourceList` 参数名 bug：`mediaId` → `media_id`。
- `FavoriteApi.FavResourceListParams` 增加 `platform`。
- `index.ts` 补充导出新增 API 与常用 models。

## adapters 替换

- 删除自研 `web-client.ts`、`wbi-sign.ts`、`types.ts`（手写请求/WBI 签名/响应类型全部由 SDK 承担）。
- 新增 `sdk-client.ts`：`BilibiliSdkClient` 包装器，保留「全局 Cookie + 单次调用覆盖」语义（`setCookieString` / `useCookie`）。
- `stream-provider`、`subtitle-provider`、`favorites-provider`、`space-provider` 改为注入 `BilibiliSdkClient`，调用 SDK 类型化接口；WebPage `__playinfo__` 兜底保留（改用 `client.http.get` raw）。
- `bilibili-auth/auth-provider` 改用 SDK `LoginApi`（qrGenerate/qrPoll/nav），Cookie 持久化流程（extractCookies/saveCookies）不变。
- `resource-parser` 移除未使用的 webClient 构造参数（matcher 均为纯字符串解析）。
- ports 契约（core 包）未改动，各 provider 方法签名保持兼容。

## server / scripts

- `download.service.ts` / `parse.service.ts`：`createBilibiliWebClient` → `createBilibiliSdkClient`，登录成功后调用 `biliClient.setCookieString`。
- `scripts/test-screenshot-no-cookie.mjs` 同步更新。

## 验证

- `pnpm --filter bilibili-api-sdk test`：94 passed。
- `pnpm build:deps`、`pnpm typecheck`（6 个 workspace 包）：全部通过。
- `node scripts/test-screenshot-no-cookie.mjs`（无 Cookie 真实链路）：PASS，成功取流并截图。

## 备注

- 原独立仓库的 `.github/workflows/release.yml` 未迁入；如后续仍需发布 npm，需要在新位置重建发布流水线。
- 历史文档（plans/requirements/logs）中对 `BilibiliWebClient` 的描述属历史记录，不回改。
