# 2026-08-12 Vision Proxy 服务健壮性改进

> Plan Status: completed
> Last Reviewed: 2026-08-12
> Source: `docs/analysis/2026-08-12-vision-proxy-robustness-analysis.md`（分析请求：Python 薄代理健壮性，单次异常后是否永久不可调用）
> Related: `docs/plans/2026-08-11-vision-proxy-python-best-practice.md`
> Audit: required（独立 subagent，reviewer availability = none）
> Testing: `docs/testing/2026/08-12-vision-proxy-robustness-testing.md`

## Current Baseline

- `packages/server/python/qwen_vision_proxy.py` 是基于 `ThreadingHTTPServer` 的薄代理。单请求异常被 `except Exception` 捕获并返回 500，且 `ThreadingMixIn.process_request_thread` 对每个请求独立 try/except/finally，**单次业务异常不会杀死进程**。
- 但存在进程级不可用的真实风险：连接无 socket 超时、请求 body 无大小限制、并发线程无上限（慢连接可无限占线程→OOM）；except 分支内 `send_json` 写坏 socket 时二次异常会逃逸；`address_string()` 每请求做反向 DNS 解析。
- `scripts/start-vision-proxy.mjs` 裸 spawn 子进程，退出即 `process.exit`，**无自动重启、无健康检查**——进程一旦死亡服务永久不可调用，直到手动重启。
- `packages/adapters/src/llm/qwen-client.ts` 的 `multimodalChat()` 走 `fetch`，**无超时**；DashScope SDK 调用阻塞 Python 线程。`analysis-trigger.service.ts:547-565` `getLlmConfig()` 从 env 构建 `LlmConfig`。
- 契约约束（本计划不得改变）：`/v1/chat/completions` 的 POST 行为与返回体、端口/主机默认值（127.0.0.1:8765）、既有环境变量语义。
- 环境变量清单在 `docs/architecture/2026-07-06-video-analysis-baseline.md:211-232`（清单），说明在 234-238。
- `getLlmConfig()` 存在**两处**喂给 `AnalysisEngine` → `multimodalChat` → 代理路径：`analysis-trigger.service.ts:547-565` 与 `analysis.controller.ts:306-330`。Node 侧超时必须对两个调用面都生效。

## Goals

- Python 薄代理在单次异常、慢连接、超大请求、并发尖峰下不再出现进程级不可用或线程无限增长。
- 代理进程意外退出后能自动拉起（自愈），且持续崩溃时退避放大不空转。
- Node 侧多模态调用有端到端超时，代理卡死不会永久占住分析任务线程。
- 正常调用路径（含"通过 API 上传视频调大模型"）行为与返回体完全不变；视频文件本身不经过代理 HTTP body，不受 body 上限影响。

## Non-Goals

- 不改变 DashScope 调用语义、消息转换格式、端口/主机默认值、既有环境变量语义。
- 不为纯文本 `chatCompletion()` 加超时（范围聚焦视觉代理链路；如后续需要另行计划）。
- 不改 Docker 部署（沿用 2026-08-11 判断：docker 包无 Python 引用）。
- 不做 HTTP/2、TLS、多实例负载均衡、请求鉴权（本代理仅绑定 127.0.0.1）。

## Infrastructure And Config Prereqs

新增可配置环境变量（均有默认值，不配置即按默认运行，不强制要求用户配置）：

- `QWEN_VISION_PROXY_MAX_BODY_BYTES`（Python，默认 `16777216` = 16MB）——代理 HTTP body 上限；字幕全文以 text 进入 body，16MB 余量充足，视频文件不经过 body。
- `QWEN_VISION_PROXY_MAX_CONCURRENCY`（Python，默认 `8`）——并发请求上限，超出返回 503。
- `QWEN_VISION_PROXY_SOCKET_TIMEOUT`（Python，默认 `120` 秒）——连接 socket 读/写超时。
- `QWEN_VISION_PROXY_TIMEOUT_MS`（Node，默认 `600000` = 10 分钟）——`multimodalChat` 走代理路径的 fetch 超时。
- `VISION_PROXY_NO_RESTART`（脚本，默认关闭）——置 `1` 时禁用 `start-vision-proxy` 的自动重启（运维/脚本场景逃生门）。
- 新增 `GET /healthz` 探活端点（返回 200 JSON）。无端口变更。

## Execution Plan

### Phase 1 - Python 薄代理健壮性

Status: completed
Targets: `packages/server/python/qwen_vision_proxy.py`

- Item Types: `Fix | Add`
- Prereqs: 无

- [x] `Add`: 请求 body 大小限制。`Content-Length` 缺失或非数字 → 400 JSON；超过 `QWEN_VISION_PROXY_MAX_BODY_BYTES` → 413 JSON 且不读 body。既有非法值 500 路径收敛为明确 4xx。
- [x] `Add`: 连接 socket 超时。handler 类属性 `timeout = QWEN_VISION_PROXY_SOCKET_TIMEOUT`，慢速 body 读/响应写不再无限阻塞，超时后连接被关闭、线程释放。
- [x] `Add`: 并发上限。**模块级共享** `BoundedSemaphore(QWEN_VISION_PROXY_MAX_CONCURRENCY)`（非 per-instance，per-instance 是空操作），在 `do_GET`/`do_POST` 顶部经 `_acquire_slot()` 获取，满时返回 503 JSON 并关闭连接（`close_connection=True`），`finally` 释放。门控放在 `do_*` 而非覆写 `handle()`：此时 `parse_request` 已执行，`requestline` 已就绪，`send_response`/`log_request` 不会因缺 `requestline` 抛 `AttributeError`（首轮实测发现并在实施中修正）；同时仍保证 body 读取前就拒绝，慢连接同样占槽位并被 socket 超时兜底。
- [x] `Fix`: except 分支内 `send_json` 二次失败不再逃逸。新增 `safe_send_json`（内部 try/except，写失败仅记日志），主路径、except 路径与 503 路径统一走安全写。
- [x] `Fix`: `address_string()` 直接返回 IP（`self.client_address[0]`），关闭反向 DNS。
- [x] `Add`: `GET /healthz` → `200 {"status":"ok"}`，不触发 DashScope。
- [x] `Proof`: 对应 `docs/testing/2026/08-12-vision-proxy-robustness-testing.md` 的方向 1-6、11（正常调用、超大 body、非法请求、慢连接、并发、单异常后仍可调用、反向 DNS 关闭）。

Exit Criteria:

- [x] 正常 `/v1/chat/completions` 请求行为与返回体不变；`/healthz` 返回 200。
- [x] 超大 body → 413、非法 Content-Length → 400、并发超限 → 503，均返回 JSON，服务继续可用。
- [x] 单次异常后下一次正常请求立即成功（不出现"一次异常后永久不可调用"）。
- [x] 慢连接在超时后被断开，线程释放。
- [x] 新增环境变量在 `docs/architecture/2026-07-06-video-analysis-baseline.md` 环境变量清单登记。
- [x] `docs/logs/` 更新（Phase 4 统一追加）。

### Phase 2 - 启动自愈

Status: completed
Targets: `scripts/start-vision-proxy.mjs`

- Item Types: `Add`
- Prereqs: Phase 1（`/healthz` 供后续探活）

- [x] `Add`: 指数退避自动重启（1s → 2s → 4s … 上限 30s），进程稳定运行 ≥ 60s 后重置退避为 1s；持续崩溃时退避放大不空转。
- [x] `Add`: 父进程收到 SIGINT/SIGTERM 时转发给子进程并退出，**不触发重启**（优雅停止）。注：win32 下 `shell:true` + `stdio:inherit`，Ctrl+C 作用于整个控制台进程组（子进程同收信号），信号转发主要为 POSIX 语义；Windows 下以"不额外重启"为准，不做信号转发。
- [x] `Add`: 支持 `VISION_PROXY_NO_RESTART=1` 环境变量禁用自动重启（运维/脚本场景逃生门）。
- [x] `Proof`: 对应 testing 方向 7-8、12（杀掉进程自动拉起、持续崩溃退避、优雅停止不重启、NO_RESTART 逃生门）。

Exit Criteria:

- [x] 杀死代理子进程后，start-vision-proxy 自动拉起且服务恢复；持续崩溃时退避放大。
- [x] Ctrl+C 终止脚本时子进程一并退出且不再重启。
- [x] `node --check scripts/start-vision-proxy.mjs` 通过。
- [x] `docs/logs/` 更新（Phase 4 统一追加）。

### Phase 3 - Node 侧端到端超时

Status: completed
Targets: `packages/adapters/src/llm/qwen-client.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`, `packages/server/src/analysis/analysis.controller.ts`

- Item Types: `Add | Decision`
- Prereqs: Phase 1

- [x] `Add`: `LlmConfig` 新增 `visionProxyTimeoutMs?: number`；`getLlmConfig()`（**两处**：`analysis-trigger.service.ts` 与 `analysis.controller.ts`）读取 `QWEN_VISION_PROXY_TIMEOUT_MS` 写入配置。
- [x] `Add`: `multimodalChat()` 走 `visionProxyUrl` 路径时用 `AbortController` + `setTimeout` 实现 fetch 超时，超时抛明确错误（含代理端点）。**默认值在客户端自身兜底**：`this.config.visionProxyTimeoutMs ?? 600000`，确保即使某个 config builder 漏读 env，两个调用面（trigger 与手动分析）都拿到超时。仅作用于代理路径，不作用于直连 DashScope 路径与 `chatCompletion()`。
- [x] `Decision`: 超时默认值取 600000ms（10 分钟），备选 120000/300000。理由：视频多模态调用耗时远超文本调用，过短会误杀正常分析；过长失去保护意义。残余风险：DashScope SDK 内部卡死时，SDK 自带 HTTP 超时（dashscope 1.26.6 `DEFAULT_REQUEST_TIMEOUT_SECONDS = 300`）会释放 Python 线程槽位（早于 Node 600s 超时），Phase 1 并发上限兜底不无限增长；本计划不引入独立于 SDK 的 Python 侧超时。
- [x] `Proof`: 对应 testing 方向 9-10（代理长时间不响应 → multimodalChat 超时抛错；正常分析不被误杀）。

Exit Criteria:

- [x] 代理卡死不响应时 `multimodalChat`（两个调用面）在超时后抛明确错误，不无限等待。
- [x] 正常多模态分析在超时阈值内完成，不被误杀。
- [x] `pnpm typecheck`、`pnpm build` 通过。
- [x] 新增环境变量在 `docs/architecture/2026-07-06-video-analysis-baseline.md` 环境变量清单登记。

### Phase 4 - 文档与验证收口

Status: completed
Targets: `docs/architecture/2026-07-06-video-analysis-baseline.md`, `docs/context/codebase-map.md`, `docs/logs/2026/08-12.md`, `docs/testing/2026/08-12-vision-proxy-robustness-testing.md`, `docs/analysis/2026-08-12-vision-proxy-robustness-analysis.md`

- Item Types: `Add`
- Prereqs: Phase 1-3

- [x] `Add`: `docs/architecture/2026-07-06-video-analysis-baseline.md` 环境变量清单登记五个新变量（含 `VISION_PROXY_NO_RESTART`）；补充 `/healthz` 与健壮性说明（薄代理行为不变量）。
- [x] `Add`: `docs/context/codebase-map.md` Vision Proxy 行更新 Last Verified 为 2026-08-12。
- [x] `Add`: `docs/logs/2026/08-12.md` 追加本计划实施记录。
- [x] `Add`: `docs/analysis/2026-08-12-vision-proxy-robustness-analysis.md` 作为计划 Source 的支撑记录（分析结论与改进方向）。
- [x] `Proof`: 运行验证命令并核对 testing 文档所有方向。

Exit Criteria:

- [x] 环境变量清单、codebase-map、logs、analysis 全部更新。
- [x] 验证命令全部执行：`pnpm typecheck`、`pnpm build`、`node --check scripts/start-vision-proxy.mjs`、venv Python `-m py_compile packages/server/python/qwen_vision_proxy.py`。
- [x] `docs/testing/2026/08-12-vision-proxy-robustness-testing.md` 所有方向均已确认或明确裁定。

## Plan Audit

- Status: passed
- Reviewer / Agent: 独立 subagent（reviewer availability = none，独立 subagent 两轮复核）
- Evidence: `docs/audits/2026-08-12-plan-audit-vision-proxy-robustness.md`（首轮 task `ses_0095de8a3ffeUaMpFZmPdmYEg9` → `needs revision`，已修订；复核轮 task `ses_00958ade4ffeKs6aLO37rB9GuM` → `approved`）

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck`、`pnpm build`、`node --check scripts/start-vision-proxy.mjs`、venv `python -m py_compile`）
- [x] `docs/testing/2026/08-12-vision-proxy-robustness-testing.md` exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan exception not applicable（full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（subagent 复核）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### `dashscope.base_http_api_url` 全局可变状态

- Classification: `watch-only residual`
- Why Not Blocking Closure: 该全局值每请求从稳定 env 写入，值不变则幂等；竞态仅出现在运行时修改 env 的罕见场景，不构成本计划目标风险。
- Successor Required: `no`

### 纯文本 `chatCompletion()` 无超时

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 本计划聚焦视觉代理链路；文本调用同样可能挂起，但属独立调用面。
- Successor Required: `yes`（触发条件：文本调用出现真实挂起案例，或统一 LLM 客户端超时策略时重开）

### DashScope SDK 内部调用无独立超时（Python 侧）

- Classification: `watch-only residual`
- Why Not Blocking Closure: SDK 自带 HTTP 超时（1.26.6 `DEFAULT_REQUEST_TIMEOUT_SECONDS = 300`）会释放 Python 线程槽位（早于 Node 600s 超时），Phase 1 并发上限兜底不无限增长；不构成本计划目标风险。
- Successor Required: `no`

### Node 超时仅覆盖 fetch 首包，不含响应 body 读取窗口

- Classification: `watch-only residual`
- Why Not Blocking Closure: 闭核算指出 `fetchWithTimeout` 在收到响应头后即清除定时器，`response.json()` 读取中途挂起不在超时覆盖内。计划声明的"代理不响应"场景已覆盖；body 中途停滞属代理已响应后的尾段，风险极低。
- Successor Required: `yes`（触发条件：出现代理响应头后 body 停滞的真实挂起案例时重开）

## Closure

Status Note: 全计划已完成。Plan audit 独立 subagent 两轮通过（首轮 `needs revision` → 修订 → 复核 `approved`）；闭核算独立 subagent `approved`。代码、文档、验证、testing 方向、日志五方一致。

Closure Audit Evidence:

- Reviewer / Agent: 独立 subagent，task `ses_009509cdbffe2GThDpLZc5mP4B`
- Evidence: `docs/audits/2026-08-12-closure-audit-vision-proxy-robustness.md`

Follow-up:

- 无（非阻塞 follow-up 仅见 Deferred 段）
