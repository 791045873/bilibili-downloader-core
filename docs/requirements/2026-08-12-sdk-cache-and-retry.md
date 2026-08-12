# bilibili-api-sdk 接口级缓存与 -412 自动重试 — 需求与技术方案

- 日期：2026-08-12
- 状态：已定稿（开放问题已于 2026-08-12 经用户确认，见"已定决策"；对应计划：`docs/plans/2026-08-12-sdk-cache-and-retry-plan.md`）
- 来源：用户直接需求（2026-08-12）：1) 接口级缓存，同一接口 24 小时内复用缓存；2) 接口 code 返回 -412 时自动重试，最多 5 次，超出后调用失败
- 影响包：`packages/bilibili-api-sdk/`（磁盘持久化缓存需要下游 `packages/adapters/` 与 `packages/server/` 少量接线改动，见实施影响面）

## SDK 现状分析（事实基线）

以下事实均来自 live 代码（2026-08-12 核对，并经独立评审逐项验证）：

### 分层结构

- `BilibiliClient`（`src/client.ts`）：入口，持有 `BilibiliHttp`、`Session`、`WbiKeyManager`、`BiliTicketManager` 和 12 个 API 模块（login/video/user/comment/dynamic/search/favorite/history/danmaku/bangumi/cheese/player）。
- `BaseApi`（`src/api/base.ts`）：所有 API 模块基类。`request()` 负责 cleanParams → 可选 WBI 签名 → `http.get/post` → `unwrap()`；`unwrap()` 在 `body.code !== 0` 时抛 `BiliError(code, message, raw)`。`postForm()` 处理 POST 表单（自动注入 csrf，无 v_voucher 重试逻辑）。`fetchNav()` 特判 nav 接口（允许 code=-101）。
- `BilibiliHttp`（`src/http/http.ts`）：fetch 薄封装。负责 cookie jar、超时（默认 15s）、raw/buffer 模式。**不检查 HTTP 状态码**，非 2xx 响应照常解析 body 返回。

### 现有重试机制（均不覆盖业务错误码）

1. `BilibiliHttp.request`：仅捕获 fetch 抛出的网络/超时异常，`retries` 默认 1，线性退避 `300ms × attempt`。
2. `BaseApi.request`：WBI 签名失效（data 含 `v_voucher`）时强制刷新 WBI key 并重试一次。注意既有怪癖：该重试复用首次签名的 `w_rid`（未用新 key 重新签名），本方案的 -412 重试不得复用该闭包。
3. 业务错误码（如 -412、-352）目前直接抛出，无任何重试。

### 缓存现状

- 无任何接口响应缓存。唯一类似的机制是 `WbiKeyManager` 内部的 key 缓存（1 小时）与并发去重（`pending` 模式，可供后续缓存击穿优化参考）。

### -412 的产生路径

- 正常路径：B 站返回 JSON `{code: -412, ...}` → `unwrap()` 抛 `BiliError`，`err.code === -412`（`src/errors.ts` 已定义 -412 为"请求被拦截（风控，检查 buvid3/cookie）"）。
- 边界缺陷一：B 站风控也可能直接返回 HTTP 412 + 非 JSON 非空 body。此时 http 层不检查状态码，body 为字符串，`body.code` 为 `undefined`，抛出的 `BiliError.code` 是 `undefined` 而非 -412（message 退化为字符串 `"undefined"`），任何按 `code === -412` 判断的逻辑都会漏判。
- 边界缺陷二：HTTP 412 + 空 body 时走 `unwrap()` 的 `!body` 分支，抛 `BiliError(-1, '空响应')`，同样漏判。

### 绕过 `BaseApi.request` 的接口（缓存/重试覆盖边界，已全量排查）

- `danmaku.realtime/history/historySeg`：buffer 响应（XML/protobuf），直连 `http.get`。
- `login.qrGenerate/qrPoll/tvQrGenerate/tvQrPoll/logout`：直连 `http.get/post`（轮询/写语义，不可缓存）。
- `bangumi.playurl` / `cheese.playurl`（`src/api/pgc.ts`）：JSON 响应但直连 `http.get` 并自行解包（`data ?? result`），不经 `request()`——**因此也不在 -412 重试覆盖内**，见 Open Questions。
- `search.suggest`：直连 `http.get` 且不解包（`return res.body ?? {}`，code≠0 也不抛错），-412 在此接口不会以 `BiliError` 形式出现。
- `fetchNav`、`wbi.refresh`、`fetchBuvid`：鉴权基础设施，直连 http 层。
- 注意：`danmaku.historyIndex` 经过 `request()`，属于正常覆盖范围。

### 缓存设计的关键约束

1. WBI 签名接口每次调用都会附加 `wts`/`w_rid`（时间相关，见 `src/auth/wbi.ts`），**缓存 key 必须基于签名前的业务参数**，否则永远 miss。
2. `playurl`（UGC 与 PGC）返回的 CDN 下载地址带时效签名，24 小时缓存会导致下载链接过期失效，必须排除或给远小于 24h 的 TTL。
3. **存在 GET 语义的写操作**：`history.delete(aid)` 用 `request('GET', .../history/delete)` 执行删除（2026-08-12 已全量排查 `request('GET')` 调用点，当前仅此一处）。缓存排除规则必须按"写操作"而非"HTTP method"划分。
4. 缓存 key 的参数序列化必须与 http 层 `buildUrl` 的 `String(value)` 语义对齐：number `123` 与 string `'123'` 是同一请求，必须产生同一 key。
5. `BiliTicketManager.get()` 有 3 天缓存且无 force 参数；强制刷新需先调 `reset()`（已是 public 方法）再 `get()`。
6. SDK 原生登录路径（`qrPoll`/`applyTvPollResult`/`logout`）直接改 `session`，**不经过** `client.setCookies()`；身份失效模型不能依赖 setCookies 钩子。

## Goal

为 `bilibili-api-sdk` 增加两个横切能力，对调用方透明、可配置、可关闭：

1. **接口级缓存**：同一接口（相同 URL + 相同业务参数 + 相同登录身份）在 24 小时内复用缓存响应，默认开启；支持内存与磁盘两种存储，磁盘缓存跨进程重启保留、可跨多个 client 实例共享。
2. **-412 自动重试**：接口返回 code = -412（含 HTTP 412）时自动重试，总共最多 5 次请求（首次 + 最多 4 次重试）；仍失败则本次接口调用以 `BiliError(-412)` 失败。

## In Scope

### 1. 缓存（`BaseApi.request` 层，GET 读接口）

- 新增 `ApiCacheStore` 接口与两个内置实现，不引入新依赖（仅用 node:fs / node:crypto）：
  - `MemoryCacheStore`（默认）：per-client 实例内存 `Map` + TTL + 容量上限 + 插入顺序淘汰，跨实例不共享。
  - `FileCacheStore(dir)`（磁盘持久化）：每个缓存条目一个 JSON 文件，文件名 `sha1(cacheKey).json`（key 含 URL，避免转义问题）；文件内容 `{ version, key, data, expiresAt, createdAt }`，读取时校验 version 与 key，不匹配或损坏视为 miss 并自动删除该文件；写入为原子写（临时文件 + rename）；写入时若条目数超过 `maxEntries`，按 `createdAt` 删除最旧条目（best-effort）。
- 磁盘缓存对指向同一目录的多个 client 实例经文件系统天然共享（server 的 parse/download 可共用同一缓存目录）；v1 假设单进程独占缓存目录，不做跨进程文件锁。
- 缓存位置：`BaseApi.request()` 内、WBI 签名之前查询缓存；`unwrap()` 成功后写入缓存。缓存值为解包后的 `data`。
- 缓存 key：`method + url + 稳定序列化的业务参数（cleanParams 之后、WBI 签名之前，key 排序、值按 http 层 String(value) 语义归一）+ 身份指纹`。
- 身份指纹：已登录取 `SESSDATA` 的短哈希，未登录为固定值 `guest`。指纹隔离即保证账号间不串数据，是唯一正确性机制。
- 默认 TTL：24 小时（`86_400_000` ms），支持全局配置与单次调用覆盖。
- 仅缓存 `code === 0` 的成功响应；错误响应（含 -412）不缓存。
- SDK 内置不缓存清单：
  - 所有写操作（无论 HTTP method）：全部 POST/`postForm` + GET 语义的 `history.delete`；
  - 时效敏感接口：`video.playurl`（PGC playurl 本就不经 `request()`，天然不缓存）；
  - 登录态探测与会话接口：`fetchNav`/nav、`login` 模块全部；
  - buffer/raw 直连接口（danmaku 等）与 `search.suggest`（本就不经过 `request()`）。
- 单次调用级 `cache?: boolean | { ttlMs?: number }` 只能关闭缓存或缩短 TTL，不能为内置排除项开启缓存。
- 失效：TTL 过期自动失效 + 指纹切换自然隔离（登录/登出/换号均改变指纹）；提供 `client.clearCache()` 手动清空。`setCookies()` **不**绑定全量清空——多 cookie 交替调用场景（adapters `useCookie`）下全量清空会导致命中率崩塌，且原生登录路径本就不经过该钩子。
- 配置入口：`ClientOptions.cache`（`enabled` 默认 true、`ttlMs` 默认 24h、`maxEntries` 默认 500）；`store?: ApiCacheStore` 为唯一存储注入点，SDK 导出 `MemoryCacheStore` 与 `FileCacheStore` 两个实现。SDK 自身不预设磁盘目录（库不应猜测数据路径），由调用方传入 `FileCacheStore(dir)`。
- 磁盘缓存写入失败（权限、磁盘满）不影响接口调用主流程：静默降级为不缓存。
- 下游接线（磁盘缓存生效所必需）：adapters 的 `createBilibiliSdkClient` 支持注入缓存 store；server 的 parse/download 创建 client 时沿用现有 `OUTPUT_DIR` 数据目录约定（见 `DatabaseService`，SQLite 位于 `join(OUTPUT_DIR, 'tasks.db')`），使用 `join(OUTPUT_DIR, 'bili-api-cache')` 作为缓存目录并共用。

### 2. -412 自动重试（`BaseApi.request` / `postForm` 层）

- 触发条件：`BiliError` 且 `code === -412`。同时在 `BaseApi` 层做归一化：`res.status === 412` 时无论 body 形态（JSON/非 JSON/空）均按 `BiliError(-412)` 抛出，堵住上述两个边界缺陷。
- 次数语义（2026-08-12 用户确认）：总共最多 5 次请求 = 首次尝试 + 最多 4 次重试；`maxRetries` 默认 4，可配置。
- 退避策略：指数退避 `baseDelayMs × 2^n`（`baseDelayMs` 默认 1000）+ 0~250ms 随机抖动，即约 1s/2s/4s/8s。风控场景立即重试无意义且加重风控。
- 重试前凭据刷新：首次遇到 -412 时刷新 buvid + bili_ticket，即 `fetchBuvid(http)` + `biliTicket.reset()` 后 `get()`（`reset()` 已是 public，无需修改 `biliTicket.ts`；两者失败均静默不阻断重试）。可配置关闭，默认开启（-412 官方提示与 buvid3/cookie 相关）。
- 每次重试重新执行完整流程（含 WBI 用当前 key 重新签名），不复用旧 `wts`/`w_rid`，不复用现有 v_voucher 重试闭包。
- 重试耗尽：抛出最后一次的 `BiliError(-412)`（保留 `raw`），对外表现为普通接口失败，不引入新错误类型。
- 仅默认作用于 -412；配置项预留 `codes?: number[]`，其他错误码（-352、-799 等）不在本期范围。
- 覆盖范围：`request()` 与 `postForm()`。`bangumi/cheese playurl`、`search.suggest`、danmaku buffer 接口、login 模块等直连路径本期不覆盖（见 Open Questions）。

### 3. 缓存与重试的交互规则

- 缓存命中时直接返回，不发起请求、不触发任何重试逻辑。
- 缓存 miss → 走重试包装的请求流程 → 仅最终成功（code === 0）才写缓存。
- http 层网络重试保持不变，作为内层重试。单次调用最坏请求数：WBI GET 接口为 `(1 + httpRetries) × 2（v_voucher） × 5 = 20` 次；`postForm` 无 v_voucher 逻辑，为 `(1 + httpRetries) × 5 = 10` 次（均按默认 httpRetries=1 计）。

## Out Of Scope

- 跨进程文件锁与多进程并发写（v1 假设单进程独占缓存目录，与 server 单进程假设一致）。
- 其他错误码（-352 风控校验失败、-799 请求过于频繁等）的自动重试。
- 缓存的并发 in-flight 去重（同一 key 并发请求合并为一次 fetch）。后续优化可参考 `WbiKeyManager.pending` 模式。
- `bangumi/cheese playurl`、`search.suggest`、danmaku buffer 接口、login 模块的缓存与 -412 重试（覆盖缺口见 Open Questions）。
- `packages/adapters/`、`packages/server/` 超出磁盘缓存接线（见实施影响面）的任何业务行为改动。
- http 层网络重试行为、现有 v_voucher 重试签名怪癖的修复（可单独立项）。

## Main User Flows

### 1. 缓存命中复用

1. 调用方首次调用 `client.video.view({ bvid })`，SDK 正常请求并缓存 `data`。
2. 24 小时内以相同参数、相同登录身份再次调用（即使 WBI 签名的 `wts`/`w_rid` 已变化），SDK 直接返回缓存，不再请求 B 站。
3. 24 小时后再次调用，缓存过期，重新请求并刷新缓存。

### 2. -412 自动恢复

1. 调用方调用某接口，B 站返回 `code: -412`（或 HTTP 412）。
2. SDK 刷新 buvid + bili_ticket（reset 后重新拉取），退避约 1s 后重试。
3. 重试成功则正常返回数据（并按缓存规则写缓存）；持续 -412 则按 2s/4s/8s 退避继续重试。
4. 第 5 次请求（第 4 次重试）仍 -412，SDK 抛出 `BiliError(-412)`，调用方按现有失败路径处理。

### 3. 身份切换

1. 调用方扫码登录（`qrPoll` 成功）或调用 `setCookies()`，会话身份变化。
2. 后续请求的身份指纹随之变化，自然与旧身份的缓存隔离；旧条目在 TTL 内仍占容量但不会被新身份命中。
3. 需要立即释放或强制 fresh 数据时，调用方显式调用 `client.clearCache()`。

### 4. 磁盘缓存跨重启复用

1. server 进程首次调用 `video.view`，响应写入磁盘缓存目录（`OUTPUT_DIR/bili-api-cache`）。
2. 进程重启后（或共用同一目录的另一个 client 实例），TTL 内再次调用同参数接口直接命中磁盘缓存，不请求 B 站。

## Business Rules

- 缓存键三要素：接口（method + URL）、业务参数、登录身份，三者任一不同即视为不同缓存项。
- 参数序列化与 http 层 `String(value)` 语义对齐：`123` 与 `'123'` 产生同一 key。
- 缓存只存成功结果；任何错误响应都不得进入缓存。
- 写操作（含 GET 语义的 `history.delete`）、轮询、登录态探测、播放地址一律不缓存（内置清单，不可通过配置放开）。
- -412 重试对 POST 写操作同样安全：-412 表示请求被风控拦截、未在服务端执行，重试不产生重复写。
- 重试退避必须带随机抖动，避免多任务同时被风控后同步重试。
- 缓存与重试均为 SDK 内建行为，对调用方透明，不传新参数即获得默认行为。
- 磁盘缓存与内存缓存遵循完全相同的 key、TTL、排除清单与身份隔离规则，仅存储介质不同。
- 缓存 I/O 失败（读损坏、写失败）不得影响接口调用主流程。

## Roles / Permissions

- 无用户角色差异。本需求不触及 auth/permissions 产品行为、数据删除、支付、部署。
- 登录身份仅用于缓存隔离（指纹），不改变任何鉴权流程。

## Edge Cases

- **HTTP 412 非 JSON / 空 body**：`res.status === 412` 归一化为 `BiliError(-412)` 后参与重试（同时修复两个现状缺陷）。
- **GET 语义写操作**：`history.delete` 内置排除，重复调用会真实重复执行删除。
- **WBI 签名参数时间漂移**：缓存 key 基于签名前参数；重试时用当前 key 重新签名。
- **playurl 24h 缓存会失效**：`video.playurl` 内置排除不缓存；PGC playurl 不经 `request()` 天然不缓存。
- **原生登录路径不经 setCookies**：`qrPoll`/`applyTvPollResult`/`logout` 直接改 session，正确性完全由指纹隔离保证，不依赖任何清空钩子。
- **同一 SESSDATA 失效/吊销**：缓存仍在 TTL 内有效，属于可接受的 TTL 语义；`clearCache()` 是唯一主动失效入口。
- **内存增长**：`maxEntries` 上限 + 插入顺序淘汰兜底；内存缓存 per-client 实例，进程重启自然清空。
- **磁盘缓存损坏/版本漂移**：JSON 解析失败、version 或 key 不匹配的文件视为 miss 并自动删除，不崩溃。
- **磁盘写失败**：权限不足/磁盘满时降级为不缓存，主流程继续。
- **共享目录并发读写**：临时文件 + 原子 rename 保证不读到半截文件；跨进程并发写不在 v1 范围。
- **重试与内层重试叠加**：WBI GET 最坏 20 次请求、单次调用最长阻塞约 16s 退避（1+2+4+8s + 抖动）+ 请求耗时；调用方如需更快失败可调低 `maxRetries`。
- **现有测试可能受影响**：缓存默认开启会改变"同参数重复调用"的测试行为，实施时需检查并适配现有 vitest 用例。

## 已定决策（2026-08-12 用户确认）

1. **重试次数语义**：总共最多 5 次请求（首次 + 最多 4 次重试），`maxRetries` 默认 4。
2. **TTL 策略**：统一默认 24h，单次调用可覆盖；分级 TTL（列表类缩短）为后续优化，不在本期范围。需知悉的下游影响：`video.view` 的 `pages`/`ugc_season`（新分 P 24h 内不可见）、`user.spaceArcSearch`/`seasonsSeriesList`（新投稿不可见）、`favorite` 列表、`history`、`search`、`followings`、`playerV2` 字幕等高变化端点同样按 24h 缓存。
3. **PGC playurl（bangumi/cheese）与 `search.suggest`**：本期显式不覆盖 -412 重试（绕过 `BaseApi.request` 的既有结构，已知缺口，记录为 Deferred）。
4. **playurl 缓存策略**：排除（不缓存）。

## Acceptance Criteria

1. 同一 GET 读接口以相同参数、相同身份在 24h 内重复调用，仅发起 1 次真实请求（vitest + mockFetch 验证 fetch 调用次数）。
2. 参数不同（含 `123` vs `'123'` 以外的真实差异）、身份不同或超过 TTL 后，正常发起新请求并刷新缓存；`123` 与 `'123'` 命中同一缓存项。
3. WBI 签名接口（如 `video.view`）重复调用同样命中缓存（`wts`/`w_rid` 不影响 key）。
4. 内置排除项不产生任何缓存行为：`video.playurl`、`history.delete`（重复调用重复执行）、nav、login 模块、全部 POST、danmaku buffer 接口、`search.suggest`。
5. `ClientOptions.cache.enabled = false` 时全局无缓存；`clearCache()` 后立即重新请求。
6. 接口连续返回 `code: -412` 时，自动重试且目标端点的请求次数为 5（1 + 4，用 mockFetch `byUrl` 仅计目标端点，WBI nav、spi/GenWebTicket 等辅助请求不计入），最终抛 `BiliError(-412)`；第 N 次（N ≤ 4）重试成功则正常返回且目标端点请求数为 N + 1。
7. HTTP 412 + 非 JSON body、HTTP 412 + 空 body 均触发重试。
8. 非 -412 业务错误（如 -404）不触发业务重试，直接抛出。
9. 退避间隔符合指数退避序列（fake timers 验证）；首次重试前触发 buvid 刷新与 bili_ticket 重新拉取（reset + get，可通过 GenWebTicket 请求计数验证）。
10. `bangumi/cheese playurl`、`search.suggest`、danmaku、login 模块行为与现状一致（不缓存、不业务重试）。
11. 现有 SDK 测试套件适配后全部通过：`pnpm --filter bilibili-api-sdk test`、`pnpm typecheck`。
12. 磁盘持久化：使用同一目录 `FileCacheStore` 的新 client 实例（模拟进程重启）在 TTL 内命中先前写入的缓存，不发起新请求；共用同目录的两个实例互相可见对方写入的条目。
13. 损坏或错误版本的缓存文件不导致崩溃，视为 miss 并自动删除；`FileCacheStore` 的 `clearCache()` 清空缓存目录。
14. 磁盘缓存遵循与内存缓存相同的 TTL、排除清单与身份指纹规则。

## 实施影响面（供后续计划引用）

- 新增：`src/cache/`（`ApiCacheStore` 接口 + `MemoryCacheStore` + `FileCacheStore` + key 序列化），约 1 个模块。
- 修改：`src/api/base.ts`（缓存读写、HTTP 412 归一化、-412 重试循环；注意与 v_voucher 闭包隔离）、`src/client.ts`（`ClientOptions` 扩展、缓存装配、`clearCache()`）、`src/index.ts`（导出新类型）。`biliTicket.ts` 无需修改（`reset()` 已 public）。
- 下游接线（磁盘缓存生效所必需）：`packages/adapters/src/bilibili/sdk-client.ts`（`createBilibiliSdkClient` 支持注入缓存 store）、`packages/server/` 的 `parse.service.ts` 与 `download.service.ts`（创建 client 时注入指向 `join(OUTPUT_DIR, 'bili-api-cache')` 的 `FileCacheStore` 并共用同一目录；沿用 `DatabaseService` 现有 `OUTPUT_DIR` 约定）。
- 测试：新增 cache 与 -412 retry 用例（复用 `tests/helpers/mockFetch.ts` + fake timers）；适配受默认缓存影响的存量用例。
- 文档：`packages/bilibili-api-sdk/README.md`、`API.md` 增补配置说明；落地后同步 `docs/architecture/` 与 `docs/context/codebase-map.md` 相关行。
- 按规划触发条件（修改共享行为、预计超 5 个文件），实施前需在 `docs/plans/` 建计划并通过独立计划审计；当前自治级别为 `plan-first`。

## 评审记录

- 2026-08-12 独立 subagent 评审：结论"需修订后通过"。已修复：E1 绕过清单遗漏（PGC playurl、search.suggest）、E2 请求上限公式、E3 bili_ticket 刷新机制（reset+get）、M1 GET 语义写操作缓存正确性、M2 PGC playurl 重试覆盖缺口（转 Open Question 3）、M3 24h TTL 下游影响（转 Open Question 2）、M4 身份失效模型（改为指纹隔离，去除 setCookies 钩子依赖）。
- 2026-08-12 二次修订（用户要求）：磁盘持久化缓存纳入本期范围——新增 `FileCacheStore` 设计（单文件/条目、原子写、损坏自愈、容量淘汰），下游 adapters/server 需接线注入缓存目录（沿用 OUTPUT_DIR 约定），原"下游零改动"表述不再成立。
- 2026-08-12 定稿：用户确认开放问题（见"已定决策"）——重试语义定为"总共最多 5 次请求"（`maxRetries=4`），PGC playurl/search.suggest 本期不覆盖，TTL 统一 24h，playurl 排除缓存；公式与验收标准同步更新。
