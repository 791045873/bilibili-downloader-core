# SDK 接口缓存与 -412 自动重试 — 测试方向

- 关联计划：`docs/plans/2026-08-12-sdk-cache-and-retry-plan.md`
- 来源需求：`docs/requirements/2026-08-12-sdk-cache-and-retry.md`
- 环境 / 配置说明：
  - 缓存与重试行为主要由自动化测试证明（vitest + mock fetch，SDK 包内 `pnpm --filter bilibili-api-sdk test`）
  - 磁盘缓存的跨重启/共享目录行为可用临时目录的自动化用例证明；如需人工验证，使用 `pnpm dev:server` + 自定义 `OUTPUT_DIR` 观察缓存目录生成与命中
  - 涉及 B 站真实风控（-412）的行为无法在本地稳定复现，以模拟响应证明逻辑，真实环境表现记录为残余观察项

## 测试方向

### 1. 缓存命中复用

- 覆盖需求：同一接口、相同参数、相同身份 24h 内复用缓存（AC1、AC3）
- 应当可观察：重复调用返回与首次一致的数据，且不产生对 B 站的新请求（含 WBI 签名接口，签名变化不影响命中）
- 不应可观察：调用方感知的返回结构/语义变化；命中缓存时产生任何网络请求
- 状态：passed
- 证据：`tests/cache.test.ts`「同参数重复调用仅发 1 次请求」「WBI 签名接口重复调用命中缓存（wts/w_rid 不影响 key）」

### 2. 缓存身份隔离

- 覆盖需求：身份指纹隔离（AC2）；登录/登出/换号后不串数据
- 应当可观察：不同登录身份调用同接口同参数互不命中；身份变化后按新身份重新请求
- 不应可观察：一个账号读到另一个账号的缓存数据
- 状态：passed
- 证据：`tests/cache.test.ts`「参数不同 / 123 与 "123" 同 key / 身份不同均正确分流」中 `session.apply({ sessData: 'other-identity' })` 后重新请求

### 3. 写操作与排除项不被缓存

- 覆盖需求：内置不缓存清单（AC4），特别是 GET 语义的删除类操作
- 应当可观察：重复执行写操作（如删除历史记录）每次都真实生效；playurl、登录态探测、登录模块接口每次调用都真实发起请求
- 不应可观察：删除/点赞/投币等写操作因缓存而"看似成功但未执行"
- 状态：passed
- 证据：`tests/cache.test.ts`「内置排除项不被缓存」（playurl 两次请求、history.delete 两次真实执行、POST history.clear 不缓存）+ `buildCacheKey`/`identityFingerprint`/`isCacheableRequest` 单元用例

### 4. 缓存过期、关闭与主动清空

- 覆盖需求：TTL 24h、`enabled=false`、`clearCache()`（AC2、AC5）
- 应当可观察：超过 TTL 后重新请求；全局关闭或手动清空后下一次调用发起真实请求
- 不应可观察：过期条目仍被返回
- 状态：passed
- 证据：`tests/cache.test.ts`「TTL 过期后重新请求」「enabled=false 全局无缓存」「clearCache 后重新请求」

### 5. 磁盘持久化与共享

- 覆盖需求：FileCacheStore 跨重启保留、多实例共享（AC12）；缓存目录位于 OUTPUT_DIR/bili-api-cache
- 应当可观察：新 client 实例（模拟进程重启）在 TTL 内命中磁盘缓存而不发请求；共用同目录的实例互相可见条目；server 启动后缓存目录按 OUTPUT_DIR 约定生成
- 不应可观察：进程重启后缓存全部丢失（启用磁盘缓存时）；不同目录的实例互相污染
- 状态：passed（SDK 层自动化用例通过；server 运行时目录生成属残余人工观察项——仓库无 server e2e 基线，编译与构建已通过）
- 证据：`tests/cache.test.ts`「FileCacheStore 跨实例共享命中」「磁盘缓存集成：共用同目录的实例互相命中」；server 接线由 `pnpm typecheck`/`pnpm build` 证明

### 6. 缓存故障不影响主流程

- 覆盖需求：缓存 I/O 失败降级（AC13）
- 应当可观察：缓存文件损坏或不可写时，接口调用仍正常返回真实数据
- 不应可观察：因缓存文件损坏、版本不匹配或磁盘写失败导致的崩溃、异常抛出或空结果
- 状态：passed
- 证据：`tests/cache.test.ts`「损坏 / 版本不匹配 / key 不匹配视为 miss 并自愈删除」「目录不可写时静默降级，不抛错」

### 7. -412 自动重试与次数上限

- 覆盖需求：-412 自动重试、总共最多 5 次请求（AC6）；首次重试前刷新凭据（AC9）
- 应当可观察：连续 -412 时按退避间隔自动重试，目标接口总请求数为 5 后以 -412 错误结束；中途某次成功则正常返回数据且不再重试；首次 -412 后重新获取 buvid/bili_ticket（可通过凭证刷新请求计数观测）
- 不应可观察：总请求数超过 5；成功返回后继续重试；无退避的立即重试；重复的凭据刷新（仅首次重试前触发）
- 状态：passed
- 证据：`tests/retry412.test.ts`「连续 -412 耗尽（5 次请求）」「第 3 次请求成功」「首次 -412 后触发 buvid + bili_ticket 凭据刷新（仅一次）」

### 8. HTTP 412 归一化

- 覆盖需求：HTTP 412（JSON/非 JSON/空 body）与 code -412 同等对待（AC7）
- 应当可观察：HTTP 412 的三种 body 形态都触发自动重试，最终失败时报 -412
- 不应可观察：出现 code 为 undefined 或"空响应"的漏判错误
- 状态：passed
- 证据：`tests/retry412.test.ts`「HTTP 412 + 非 JSON body / 空 body 同样触发重试并最终成功」

### 9. 非 -412 错误不重试

- 覆盖需求：仅 -412 触发业务重试（AC8、AC10）
- 应当可观察：其他业务错误（如 -404）一次失败即抛出；未覆盖接口（PGC playurl、搜索建议、弹幕、登录）行为与现状完全一致
- 不应可观察：非 -412 错误被自动重试；未覆盖接口出现行为变化
- 状态：passed
- 证据：`tests/retry412.test.ts`「非 -412 业务错误不重试，直接抛出」；未覆盖接口无代码路径变更，存量测试（`danmaku`/`login`/`pgc` 相关）全绿

### 10. 下游透明接入

- 覆盖需求：adapters/server 无业务逻辑改动即获得缓存与重试；磁盘缓存目录接线
- 应当可观察：server 现有解析/下载流程行为不变；`pnpm typecheck`、`pnpm build` 通过；现有 SDK 测试套件适配后全部通过（AC11）
- 不应可观察：下游出现业务语义变化或新的失败路径
- 状态：passed
- 证据：`pnpm typecheck`（根，含 adapters/server）、`pnpm build` 全部通过；SDK 125 个用例全绿（存量用例无需适配）；parse/download 仅新增 store 注入，无业务逻辑改动
