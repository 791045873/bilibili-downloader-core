# 2026-08-12 bilibili-api-sdk 接口级缓存与 -412 自动重试

## 变更摘要

为 `bilibili-api-sdk` 增加两个横切能力：接口级缓存（默认开启，TTL 24h，内存/磁盘两种存储）与业务错误码自动重试（默认 `-412`/HTTP 412，指数退避，总共最多 5 次请求），并接入 server 磁盘缓存。

来源：`docs/requirements/2026-08-12-sdk-cache-and-retry.md`（已定稿）；计划：`docs/plans/2026-08-12-sdk-cache-and-retry-plan.md`（已通过计划审计并关闭）；测试方向：`docs/testing/2026/08-12-sdk-cache-and-retry-testing.md`（10 个方向全部 passed）。

## SDK 变更（packages/bilibili-api-sdk）

- 新增 `src/cache/cacheStore.ts`：
  - `ApiCacheStore` 接口 + `MemoryCacheStore`（默认，Map+TTL+容量上限+插入顺序淘汰）
  - `FileCacheStore(dir)`：磁盘持久化，每条目一个 JSON 文件（`sha1(key).json`），原子写（临时文件+rename）、损坏/版本/key 不匹配自愈删除、容量淘汰、I/O 失败静默降级
  - `buildCacheKey`（method+url+签名前参数 key 排序+String(value) 归一+身份指纹）、`identityFingerprint`（SESSDATA 短哈希/guest）、`isCacheableRequest`（内置排除清单：写操作含 GET 语义的 `history.delete`、playurl、nav、登录模块、POST）
- `src/api/base.ts`：`ApiContext` 增加 `cache`/`retry`/`biliTicket`；`request()` 缓存读写（签名前查缓存、成功写缓存）+ 统一 `runWithRetry`（v_voucher 一次性重试内层 + 业务错误码指数退避外层）；HTTP 412 归一化为 `BiliError(-412)`（修复非 JSON/空 body 漏判）；`postForm()` 同样 412 归一化 + 重试；首次重试前刷新 buvid + bili_ticket（`reset()` 后 `get()`，失败静默）
- `src/client.ts`：`ClientOptions.cache`（enabled/ttlMs/maxEntries/store）与 `ClientOptions.retry`（enabled/maxRetries=4/baseDelayMs/codes/refreshCredentials）+ `client.clearCache()`
- `src/index.ts`：导出 `MemoryCacheStore`、`FileCacheStore`、`buildCacheKey`、`identityFingerprint`、`isCacheableRequest`、`ApiCacheStore`
- 测试：`tests/cache.test.ts`（24 用例）、`tests/retry412.test.ts`（7 用例）

## adapters / server 接线

- `packages/adapters/src/bilibili/sdk-client.ts`：`createBilibiliSdkClient(cookieString, options?)` 支持注入 `cacheStore`（透传 `ClientOptions.cache.store`），无参路径行为不变
- `packages/adapters/src/bilibili/index.ts`：再导出 `FileCacheStore`/`MemoryCacheStore`/`ApiCacheStore`（server 不直接依赖 SDK，保持依赖方向）
- `packages/server`：`parse.service.ts` 与 `download.service.ts` 创建 client 时注入共用 `FileCacheStore(join(OUTPUT_DIR, 'bili-api-cache'))`，两服务跨实例共享磁盘缓存

## 文档

- `packages/bilibili-api-sdk/README.md`、`API.md`：新增「接口级缓存」「自动重试」章节与配置说明
- `docs/architecture/system-baseline.md`：Stable Rules 增补 SDK 缓存/重试能力与 server 缓存目录约定
- `docs/context/codebase-map.md`：SDK 行与「修改 B站 API 适配」行更新（Last Verified 2026-08-12）

## 验证

- `pnpm --filter bilibili-api-sdk test`：126 passed（13 文件，含新增 32 用例）；存量用例无需适配
- `pnpm --filter bilibili-api-sdk typecheck`、`pnpm --filter @bilibili-downloader/adapters typecheck`、`pnpm --filter @bilibili-downloader/server typecheck`、根 `pnpm typecheck`、根 `pnpm build` 全部通过
- 说明：server 运行时行为（真实 B 站请求生成 `OUTPUT_DIR/bili-api-cache` 目录）为残余人工观察项，仓库无 server e2e 基线；SDK 层行为由自动化用例证明

## 关闭审计期间的顺带修复

- `client.ts` 构造时若 `cookies` 携带 SESSDATA 且未显式传 `session.sessData`，则同步到 session——保证接口缓存身份指纹（SESSDATA 短哈希）在多账号共享磁盘缓存场景下正确隔离（关闭审计非阻断观察 1）。
- `FileCacheStore.clear()` 同时清理 `.tmp` 残留（非阻断观察 5）。
- v_voucher 重试随 `runWithRetry` 重构顺带修复"复用旧 w_rid"怪癖——voucher 重试现用新 WBI key 重新签名（非阻断观察 2，属改进非回归）。

## 评审/审计

- 需求文档经独立 subagent 评审（需修订后通过）后定稿
- 计划经独立 subagent 计划审计（首轮 needs revision → 修订后 passed），证据 `docs/audits/2026-08-12-plan-audit-sdk-cache-and-retry.md`
- 关闭审计（独立 subagent，approved）：证据 `docs/audits/2026-08-12-closure-audit-sdk-cache-and-retry.md`
