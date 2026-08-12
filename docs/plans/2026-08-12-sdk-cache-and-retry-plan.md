# 2026-08-12-sdk-cache-and-retry-plan bilibili-api-sdk 接口缓存与 -412 自动重试

> Plan Status: completed
> Last Reviewed: 2026-08-12
> Source: `docs/requirements/2026-08-12-sdk-cache-and-retry.md`（2026-08-12 定稿，开放问题已经用户确认）
> Related: 无
> Audit: required
> Testing: `docs/testing/2026/08-12-sdk-cache-and-retry-testing.md`

## Current Baseline

Live 基线盘点（2026-08-12，与需求文档"SDK 现状分析"一致）：

- SDK 请求路径：`BilibiliClient` → 12 个 API 模块 → `BaseApi.request()/postForm()` → `unwrap()`（code≠0 抛 `BiliError`）→ `BilibiliHttp`（fetch 薄封装，不检查 HTTP 状态码）。
- 无任何接口响应缓存；唯一先例是 `WbiKeyManager` 内部 key 缓存 + `pending` 并发去重。
- 现有重试两层：http 层网络异常重试（默认 1 次）、`BaseApi` v_voucher 重试一次（复用旧 `w_rid` 的既有怪癖）。业务错误码（-412 等）无重试。
- 归一化缺陷两处：HTTP 412 + 非 JSON 非空 body → `BiliError.code === undefined`；HTTP 412 + 空 body → `BiliError(-1, '空响应')`。
- 绕过 `BaseApi.request` 的接口（已全量排查）：danmaku buffer 接口、login 模块全部、`bangumi/cheese playurl`（自行解包）、`search.suggest`（不解包不抛错）、`fetchNav`/`wbi.refresh`/`fetchBuvid`。`danmaku.historyIndex` 经 `request()`，属覆盖范围。
- `history.delete(aid)` 是 GET 语义的写操作（全量排查 `request('GET')` 调用点，当前仅此一处）。
- `BiliTicketManager.get()` 有 3 天缓存，强制刷新需 `reset()`（已 public）后 `get()`；`fetchBuvid` 失败静默本地兜底。
- SDK 原生登录路径（`qrPoll`/`applyTvPollResult`/`logout`）直接改 session，不经过 `client.setCookies()`。
- 下游：`createBilibiliSdkClient(cookieString)` 无缓存配置通道；server 的 `parse.service.ts` 与 `download.service.ts` 各自创建 client；`DatabaseService` 使用 `OUTPUT_DIR`（默认 `cwd/downloads`），`tasks.db` 位于 `join(OUTPUT_DIR, 'tasks.db')`。
- 测试基建：vitest + `tests/helpers/mockFetch.ts`（支持 status/text/buffer/Set-Cookie 与调用计数）；无缓存/业务重试相关用例。
- 缺口：上述缓存与 -412 重试能力完全不存在；HTTP 412 归一化缺陷待修。

## Goals

- SDK 默认对 GET 读接口做接口级缓存：key = method+URL+签名前业务参数+身份指纹，TTL 默认 24h，仅缓存成功响应。
- 提供 `MemoryCacheStore`（默认）与 `FileCacheStore`（磁盘持久化、原子写、损坏自愈、容量淘汰）两种存储，经 `ClientOptions.cache.store` 注入。
- -412（含 HTTP 412 全部 body 形态）自动重试：指数退避 + 抖动 + 首次重试前刷新 buvid/bili_ticket，总共最多 5 次请求，耗尽后抛 `BiliError(-412)`。
- 修复 HTTP 412 两处归一化缺陷。
- 下游接线：adapters 支持注入缓存 store；server parse/download 共用 `join(OUTPUT_DIR, 'bili-api-cache')`。
- 文档同步：SDK `README.md`/`API.md`、`docs/architecture/`、`docs/context/codebase-map.md`。

## Non-Goals

- 其他错误码（-352、-799 等）重试。
- `bangumi/cheese playurl`、`search.suggest`、danmaku buffer、login 模块的缓存与 -412 重试（用户确认本期不覆盖）。
- 跨进程文件锁、缓存 in-flight 并发去重、分级 TTL、磁盘持久化之外的持久层。
- 现有 v_voucher 重试签名怪癖的修复。
- 下游超出缓存接线的任何业务行为改动。

## Infrastructure And Config Prereqs

- 沿用现有 `OUTPUT_DIR` 环境变量（`DatabaseService` 既有约定，默认 `process.cwd()/downloads`）；缓存目录 `join(OUTPUT_DIR, 'bili-api-cache')`，首次写入时自动创建。
- No infra prereqs beyond existing baseline：无新端口、无新环境变量、无外部服务、无 secrets。

## Execution Plan

### Phase 1 — SDK 缓存模块与 BaseApi 集成

Status: completed
Targets: `packages/bilibili-api-sdk/src/cache/`、`src/api/base.ts`、`src/client.ts`、`src/index.ts`

- Item Types: Add | Fix（默认缓存会改变同参数重复调用的存量用例行为，Fix 项仅影响受影响的存量用例）
- Prereqs: 无

- [x] Add: `ApiCacheStore` 接口 + `MemoryCacheStore`（Map + TTL + `maxEntries` 容量上限 + 插入顺序淘汰）
- [x] Add: `FileCacheStore(dir)`：每条目一文件（`sha1(cacheKey).json`）、内容 `{ version, key, data, expiresAt, createdAt }`、读取校验 version/key、原子写（临时文件 + rename）、超限按 createdAt 淘汰、写失败静默降级
- [x] Add: 缓存 key 序列化——method + url + cleanParams 后/WBI 签名前的参数（key 排序、值按 http 层 `String(value)` 语义归一）+ 身份指纹（SESSDATA 短哈希 / `guest`）
- [x] Add: `ClientOptions.cache`（`enabled` 默认 true、`ttlMs` 默认 24h、`maxEntries` 默认 500、`store` 注入）+ `client.clearCache()` + `index.ts` 导出
- [x] Add: `BaseApi.request()` 缓存读写——WBI 签名前查缓存、`unwrap()` 成功后写缓存；内置排除清单（全部写操作含 GET 语义的 `history.delete`、`video.playurl`、`fetchNav`/nav、login 模块）；单次调用 `cache?: boolean | { ttlMs }` 只能关闭或缩短 TTL；失效机制按需求"已定决策/设计约束"：TTL 过期 + 指纹隔离 + `clearCache()`，**`setCookies()` 不绑定全量清空缓存**（避免多 cookie 交替调用命中率崩塌，见需求文档）
- [x] Decision: 排除规则按"写操作"而非 HTTP method 划分。理由：`history.delete` 为 GET 语义删除，按 method 划分会缓存删除结果导致重复调用不执行；备选"仅排除 POST"（遗漏 GET 写操作，否决）、"按接口 allow-list 白名单开启"（与需求"默认开启"冲突且维护成本高，否决）；残余风险：未来新增 GET 写接口需手工加入排除清单——由 testing 方向 3 与代码评审兜底
- [x] Add: `tests/cache.test.ts` 覆盖 AC1-5、AC12-14（命中计数、参数/身份/TTL 隔离、`123` 与 `'123'` 同 key、WBI 命中、排除项逐项、enabled=false、clearCache、磁盘跨实例命中、损坏文件自愈、磁盘写失败静默降级）
- [x] Fix: 适配受默认缓存影响的 SDK 存量用例（逐例判断：改用独立 client / 关闭缓存 / 更新断言，不得删除断言规避）——必须在本相位完成，使全量 SDK 测试通过

Exit Criteria:

- [x] 缓存命中/未命中/排除/持久化行为落地（成功模式：命中零请求；失败模式：缓存 I/O 故障不影响接口主流程）
- [x] `pnpm --filter bilibili-api-sdk test` 与 `pnpm --filter bilibili-api-sdk typecheck` 通过
- [x] No owner-doc update required（SDK README/API.md 统一在 Phase 4）
- [x] `docs/logs/` updated

### Phase 2 — -412 归一化与自动重试

Status: completed
Targets: `packages/bilibili-api-sdk/src/api/base.ts`、`src/client.ts`、`tests/`

- Item Types: Add | Fix
- Prereqs: Phase 1（缓存与重试在 `request()` 内的交互规则需一次成型：命中短路、仅成功写缓存）

- [x] Fix: HTTP 412 归一化——`res.status === 412` 时无论 body 形态（JSON/非 JSON/空）统一抛 `BiliError(-412)`，修复基线两处缺陷
- [x] Add: -412 重试循环——`maxRetries` 默认 4（总共最多 5 次请求，用户已确认语义）；指数退避 `baseDelayMs(默认 1000) × 2^n` + 0~250ms 抖动；首次重试前刷新凭据（`fetchBuvid` + `biliTicket.reset()` 后 `get()`，失败静默，可配置关闭）；每次重试重新执行完整流程（含用当前 WBI key 重新签名）；不复用现有 v_voucher 重试闭包；耗尽抛出最后一次 `BiliError(-412)`（保留 raw）；作用于 `request()` 与 `postForm()`
- [x] Add: `ClientOptions.retry`（`enabled` 默认 true、`maxRetries` 默认 4、`baseDelayMs` 默认 1000、`codes` 预留默认 `[-412]`、`refreshCredentials` 默认 true）
- [x] Add: `tests/retry412.test.ts` 覆盖 AC6-9——连续 -412 耗尽（目标端点 5 次请求）、第 N（N≤4）次重试成功、HTTP 412 三种 body 形态、非 -412 不重试、退避序列（fake timers）、凭据刷新计数；用 mockFetch `byUrl` 仅计目标端点，nav/spi/GenWebTicket 辅助请求不计入

Exit Criteria:

- [x] 归一化与重试语义落地（成功模式：中途恢复返回数据；失败模式：5 次后抛 `BiliError(-412)`）
- [x] `pnpm --filter bilibili-api-sdk test` 与 typecheck 通过
- [x] No owner-doc update required（统一在 Phase 4）
- [x] `docs/logs/` updated

### Phase 3 — 下游接线与全量验证

Status: completed
Targets: `packages/adapters/src/bilibili/sdk-client.ts`、`packages/server/src/parse/parse.service.ts`、`packages/server/src/download/download.service.ts`

- Item Types: Add | Proof
- Prereqs: Phase 1（store 注入能力）

- [x] Add: `createBilibiliSdkClient(cookieString, options?)` 支持注入 `ApiCacheStore`（透传到 `ClientOptions.cache.store`），不改变现有无参调用行为
- [x] Add: server `parse.service.ts` 与 `download.service.ts` 创建 client 时注入共用 `FileCacheStore(join(OUTPUT_DIR, 'bili-api-cache'))`，OUTPUT_DIR 读取方式与 `DatabaseService` 一致（`process.env.OUTPUT_DIR ?? join(process.cwd(), 'downloads')`）。注：`createBilibiliApiAdapter`（`adapters/src/bilibili/bilibili-api.ts`）创建的 client 不注入 store，按无参路径获得默认内存缓存（行为与现状一致，属预期）
- [x] Proof: 全量回跑 `pnpm typecheck`（根）、`pnpm build`、`pnpm --filter bilibili-api-sdk test`、`pnpm --filter @bilibili-downloader/server typecheck`（覆盖 Phase 1 已适配的存量用例）

Exit Criteria:

- [x] 两个服务共用同一缓存目录；无参调用路径行为不变
- [x] 根 typecheck/build 与 SDK 测试全部通过
- [x] No owner-doc update required（统一在 Phase 4）
- [x] `docs/logs/` updated

### Phase 4 — 文档同步与完成证明

Status: completed
Targets: `packages/bilibili-api-sdk/README.md`、`API.md`、`docs/architecture/`、`docs/context/codebase-map.md`、testing 文档、`docs/logs/`

- Item Types: Add | Proof
- Prereqs: Phase 1-3

- [x] Add: SDK `README.md` 与 `API.md` 增补 cache/retry 配置说明、`FileCacheStore` 用法、排除清单与已知覆盖缺口（PGC playurl 等）
- [x] Add: `docs/architecture/`（system-baseline 或相应模块文档）与 `docs/context/codebase-map.md` 中 SDK 能力描述更新
- [x] Proof: testing 文档 10 个方向逐条确认 passed，或显式裁决 out of scope 并记录理由
- [x] Proof: 真实执行 `pnpm --filter bilibili-api-sdk test`、`pnpm typecheck`、`pnpm build` 并记录输出位置
- [x] Proof: 独立 closure audit（证据存入 `docs/audits/` 并链接）

Exit Criteria:

- [x] 所有文档与实现一致，testing 方向全部确认
- [x] 验证命令真实执行通过
- [x] `docs/logs/` 完成记录（含 testing 文档链接）

## Plan Audit

- Status: passed（首轮 needs revision 已修订，详见审计记录）
- Reviewer / Agent: 独立 subagent（task `ses_009c0c9d2ffeT8lyxEZVGDqBxN`）
- Evidence: `docs/audits/2026-08-12-plan-audit-sdk-cache-and-retry.md`

首轮审计结论 `needs revision`，唯一阻断问题：Phase 1 门禁（全量 SDK 测试通过）与 Phase 3 的"存量用例适配"存在阶段序矛盾。修订：将存量用例适配 Fix 项移入 Phase 1（缓存默认开启落地的同一相位），Phase 3 改为全量回跑验证；同时吸收非阻断建议（testing 方向 7 补凭据刷新观测、Phase 1 用例补磁盘写失败降级、setCookies 不清缓存引用、createBilibiliApiAdapter 默认内存缓存注记）。修订后阻断项消解。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm --filter bilibili-api-sdk test`、`pnpm typecheck`、`pnpm build`、`pnpm --filter @bilibili-downloader/server typecheck`）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed or micro-plan exception documented before implementation
- [x] micro-plan actual diff stayed within exception limits, or plan was reclassified and audited（本计划为 full plan，不适用 micro-plan 例外）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent (or cold-replay proxy documented)
- [x] closure evidence exists in files

## Deferred But Adjudicated

### PGC playurl / search.suggest 的 -412 重试与缓存覆盖

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 用户 2026-08-12 确认本期不覆盖；相关接口行为与现状一致（AC10 验证），无回归
- Successor Required: `yes`（触发条件：PGC 下载在真实环境频繁触发 -412 风控时重新立项）

### 高变化端点分级 TTL

- Classification: `optimization candidate`
- Why Not Blocking Closure: 用户确认统一 24h；单次调用 TTL 覆盖机制已具备，后续调整仅需改内置默认值
- Successor Required: `no`（重开事件：产品侧对 video.view 新分 P / space 新投稿 24h 不可见提出异议）

### 缓存 in-flight 并发去重

- Classification: `optimization candidate`
- Why Not Blocking Closure: 不影响正确性，仅影响并发同 key 的重复请求量；可参考 `WbiKeyManager.pending` 模式后续实现
- Successor Required: `no`（重开事件：并发场景重复请求被观测到引发风控或明显流量浪费）

### v_voucher 重试未重新签名怪癖

- Classification: `out-of-scope improvement`（既有行为已随本期 `runWithRetry` 重构顺带修复——voucher 重试现用新 WBI key 重新签名）
- Why Not Blocking Closure: 属改进非回归；本期目标（-412 重试）已达成，未对 v_voucher 单独立项
- Successor Required: `no`（重开事件：无，已随重构修复）

## Closure

Status Note: 实施与验证全部完成，关闭审计通过（approved）。AC1-14 全部满足，5 条验证命令真实执行通过，SDK 测试 126 全绿，testing 文档 10 个方向全部 passed。

Closure Audit Evidence:

- Reviewer / Agent: 独立 subagent（task `ses_009ae8b8bffehXYPfeU3rolXRG`）
- Evidence: `docs/audits/2026-08-12-closure-audit-sdk-cache-and-retry.md`、`docs/logs/2026-08-12-sdk-cache-and-retry.md`

Follow-up:

- 无阻断性后续项。残余观察：server 运行时真实风控行为无 e2e 基线，属人工观察残余项；单次调用 TTL 放大未加限制（规格宽松，调用方自担）。
