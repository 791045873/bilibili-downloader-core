# 2026-08-21 LLM 并发调用限制（最多 2 个同时执行）

> Plan Status: completed
> Last Reviewed: 2026-08-21
> Source: 用户需求——「对 py 服务进行并发限制，每次同时只能最多执行两个大模型调用」
> Related: `docs/plans/2026-08-13-vision-proxy-retry-plan.md`
> Audit: required（独立 subagent，reviewer availability = none；deployment 保护区由用户显式确认）
> Testing: `docs/testing/2026/08-21-llm-concurrency-limit-testing.md`

## Current Baseline

- Node 侧编排：每个 AI 总结任务并发触发 `runAnalysis`（`analysis-trigger.service.ts`），各自 `new AnalysisEngine/QwenClient`（`analysis-trigger.service.ts:458`）并发调用 `multimodalChat`（`qwen-client.ts`），最终汇聚到 Python 视觉代理执行真实 DashScope 调用。Node 侧**无任何并发上限**，任意多任务可同时打向代理。
- Python 代理 `qwen_vision_proxy.py:81-84` 已有 `BoundedSemaphore`，容量由 `QWEN_VISION_PROXY_MAX_CONCURRENCY` 决定（默认 `8`），但语义是**拒绝而非排队**：`_acquire_slot()` 用 `acquire(blocking=False)`，耗尽立即回 503 `server busy`。
- Node `qwen-client.ts:13-15` 把 503 视为可重试（最多 2 次，间隔 2s），仍失败则任务失败。
- **已确认缺陷（Fix）**：`qwen_vision_proxy.py` 的 `do_GET` 对 `/healthz` 也调用 `_acquire_slot()`（占用信号量槽位）。若并发上限下调到 2 且 2 个 LLM 在跑，健康检查会 503，Docker 会误判容器不健康而重启。
- 无 `p-limit`/`p-queue`/`async` 等并发依赖。

## Goals

- 同时最多 **2 个** 大模型（多模态 LLM）调用在途（in-flight）。
- 超出 2 的请求在 **Node 调用侧排队等待**，而非被 503 拒绝；任务不因并发受限而失败。
- Python 代理作为最后一道兜底上限（默认 2），并修复 healthz 占用槽位缺陷。

## Non-Goals

- 不改 Node 侧任务编排/认领逻辑（`analysis-trigger.service.ts`），只在 LLM 调用入口统一限流。
- 不新增第三方并发依赖（手写最小 Promise 信号量，匹配现有无依赖基线）。
- 不处理"测试连接"端点（`analysis.controller.ts` 直连 DashScope 原生端点，不经代理，不受限）。
- 不做 Python 侧排队（架构上编排归 Node，见 Decision）。

## Infrastructure And Config Prereqs

- 新增可选环境变量 `MAX_CONCURRENT_LLM_CALLS`（默认 `2`），由 server 容器读取。
- `QWEN_VISION_PROXY_MAX_CONCURRENCY` 默认值 `8` → `2`。
- 无端口/密钥/外部服务变化。

## Execution Plan

### Phase 1 - 实现与验证

Status: completed
Targets: `packages/adapters/src/llm/qwen-client.ts`, `packages/vision-proxy/qwen_vision_proxy.py`, `packages/docker/docker-compose.yml`, `packages/docker/.env.example`, `docs/architecture/2026-07-06-video-analysis-baseline.md`

- Item Types: `Add | Fix | Decision | Proof`
- Prereqs: 无

- [x] `Add`: `qwen-client.ts` 新增模块级最小 Promise 信号量类 `AsyncLimiter`（默认上限 `MAX_CONCURRENT_LLM_CALLS`，env 读取，默认 2），在 `multimodalChat` 入口包裹整个重试循环，使最多 2 个调用（含重试）同时在途，超出排队。
- [x] `Fix`: `qwen_vision_proxy.py` 默认 `MAX_CONCURRENCY` 由 `8` → `2`；`do_GET` 的 `/healthz` 不再占用信号量槽位（直接返回 200，不调用 `_acquire_slot`）。
- [x] `Add`: `docker-compose.yml` server 服务新增 `MAX_CONCURRENT_LLM_CALLS: ${MAX_CONCURRENT_LLM_CALLS:-2}`；vision-proxy 默认 `8` → `2`。
- [x] `Add`: `.env.example` 更新 `QWEN_VISION_PROXY_MAX_CONCURRENCY` 注释默认值（8→2），新增 `MAX_CONCURRENT_LLM_CALLS` 说明。
- [x] `Decision`: 排队位置放在 Node 侧（记录于 Decision 节）。
- [x] `Proof`: 对应 `docs/testing/2026/08-21-llm-concurrency-limit-testing.md` 方向 1-6；运行级 stub 验证并发上限为 2、第 3 个排队等待、排队不失败、超限任务完成后恢复、healthz 不再占用槽位。

Exit Criteria:

- [x] 同时最多 2 个 LLM 调用在途；第 3 个起排队等待且最终成功，不因并发受限失败。
- [x] `qwen_vision_proxy.py` 默认并发为 2；`/healthz` 在任何并发下均返回 200（不再占槽）。
- [x] `pnpm typecheck`、`pnpm build` 通过；`qwen_vision_proxy.py` 语法检查通过。
- [x] 运行级 stub 冒烟通过（并发=2、排队不失败、healthz 不受影响）。
- [x] 架构基线 `2026-07-06-video-analysis-baseline.md` env 清单同步；`docs/logs/2026/08-21.md` 追加记录。
- [x] `docs/testing/2026/08-21-llm-concurrency-limit-testing.md` 所有方向均已确认或明确裁定。

## Plan Audit

- Status: passed
- Reviewer / Agent: cold-replay proxy（reviewer availability = none）
- Evidence: 冷重放自检——计划目标/范围/闭核算门与实施后的真实 diff、验证命令一致；deployment 保护区默认值变更由用户显式确认（用户按建议批准含 docker-compose 默认值变更）。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck`、`pnpm build`、Python 语法检查、运行级 stub 冒烟）
- [x] `docs/testing/2026/08-21-llm-concurrency-limit-testing.md` exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation（cold-replay proxy；deployment 由用户确认）
- [x] micro-plan exception not applicable（涉多模块 + deployment，full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（cold-replay proxy 复核）
- [x] closure evidence exists in files

## Decision

### 排队位置放在 Node 调用侧

- 选择：在 `qwen-client.ts` 的 `multimodalChat` 入口加模块级信号量（默认 2），超出排队等待。
- 备选：(a) Python 代理侧排队（blocking acquire + 超时）——代理是 `ThreadingHTTPServer`，每排队请求占一条线程 + 一条挂起 HTTP 连接，队列一长线程/连接爆炸；等待若超过 Node 的 `QWEN_VISION_PROXY_TIMEOUT_MS` 仍会超时失败；代理重启丢失排队请求。(b) 维持 503 拒绝仅把上限降到 2——超限任务会失败（不符合"排队不失败"目标）。
- 依据：`codebase-map.md:45-46` 约定 Node 为业务编排主体、Python 为无业务语义的薄代理；并发/排队属编排关注点归 Node。Node 为单实例单进程（单容器），进程内信号量可在所有任务间统一限流。
- 残余风险：若未来横向扩展为多 Node 副本，Node 侧限制非全局，Python 侧兜底（默认 2）仍会拒绝超限请求。裁定：当前为单实例，可接受。

### 代理并发兜底保留

- 选择：Python 代理保留 `BoundedSemaphore` 作为最后防线（默认 2）。
- 备选：移除代理信号量——会失去对直连/多调用方（绕过 Node 上限）的保护。保留更稳妥。
- 残余风险：Node 与代理两处上限需要默认值一致（都 2），由本计划同步。

## Deferred But Adjudicated

### 并发限制配置化

- Classification: `optimization candidate`
- Why Not Blocking Closure: 默认 2 + env 覆盖满足当前需求；如需运行时动态调整或按环境区分再扩展。
- Successor Required: `no`

## Closure

Status Note: 全计划完成。Node 侧信号量、Python 兜底默认 2 + healthz Fix、docker/env/架构文档同步全部落地并验证。冷重放自检通过；deployment 保护区默认值变更由用户显式批准。

Closure Audit Evidence:

- Reviewer / Agent: cold-replay proxy（reviewer availability = none）
- Evidence: 冷重放复核——对照计划 Goals/Exit Criteria/Closure Gates 逐条核对真实 diff 与验证输出（`peakInFlight=2`、ok=4/failed=0、typecheck/build exit 0、healthz 200、compose config exit 0）；testing 文档方向全部确认或裁定；日志 `docs/logs/2026/08-21.md` 一致。未发现受保护项或源真值冲突遗留。

Follow-up:

- 无
