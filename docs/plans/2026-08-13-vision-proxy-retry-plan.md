# 2026-08-13 Vision Proxy 代理路径自动重试

> Plan Status: completed
> Last Reviewed: 2026-08-13
> Source: 用户报告 `LLM 多模态代理调用失败 (status=500...) : ('Connection aborted.', ConnectionResetError(10054, ...))`——DashScope SDK 向阿里云上传/推理时连接被重置，代理返回 500，Node 侧无重试，一次瞬时失败整单失败
> Related: `docs/plans/2026-08-12-vision-proxy-robustness-plan.md`
> Audit: required（独立 subagent，reviewer availability = none）
> Testing: `docs/testing/2026/08-13-vision-proxy-retry-testing.md`

## Current Baseline

- `packages/adapters/src/llm/qwen-client.ts` `multimodalChat()` 代理路径（`if (this.config.visionProxyUrl)` 分支）无重试：fetch 网络错误或代理 500/502/503 直接抛错，一次瞬时失败导致整次分析失败。
- 该路径已具备端到端超时（`visionProxyTimeoutMs ?? VISION_PROXY_DEFAULT_TIMEOUT_MS`，默认 600000ms，上一计划落地）。
- 报告故障链路：Node → 代理（正常到达）→ dashscope SDK 向阿里云 OSS 上传/推理 → `requests.exceptions.ConnectionError: ('Connection aborted.', ConnectionResetError(10054, ...))` → 代理 `except Exception` 返回 500（body 为 Python 错误文本）→ Node 无重试直接抛错。
- 故障本质是代理机器到阿里云的**网络层瞬时失败**，重试一次通常即可恢复。

## Goals

- `multimodalChat` 代理路径对瞬时网络错误与代理 5xx（500/502/503）自动重试 **1 次**（初始 1 次 + 重试 1 次，固定 2s 间隔）。
- 正常请求行为、返回体、成功路径调用次数不变；失败最终错误信息格式与现状一致。

## Non-Goals

- 不新增环境变量（重试次数与间隔用固定常量，后续可按需配置化）。
- 不改超时默认值（600000ms）；**超时（AbortError）不重试**。
- 不重试 4xx（400/413/404 等确定性客户端错误）与 2xx 响应解析错误。
- 不重试直连（非代理）`multimodalChat` 路径与 `chatCompletion()`。
- 不做 Python 侧重试（Node 侧重试覆盖 Node↔代理 与 代理↔DashScope 两段，且复用现有调用面）。

## Infrastructure And Config Prereqs

- 无新增环境变量/端口/外部依赖。常量固定为：`VISION_PROXY_MAX_ATTEMPTS = 2`、`VISION_PROXY_RETRY_DELAY_MS = 2000`。

## Execution Plan

### Phase 1 - 实现与验证

Status: completed
Targets: `packages/adapters/src/llm/qwen-client.ts`

- Item Types: `Add | Decision | Proof`
- Prereqs: 无（依赖上一计划已落地的超时与错误信息格式）

- [x] `Add`: 模块级常量 `VISION_PROXY_MAX_ATTEMPTS = 2`、`VISION_PROXY_RETRY_DELAY_MS = 2000`；工具函数 `isRetryableProxyStatus()`（500/502/503）与 `delay()`。
- [x] `Add`: 代理路径重构为尝试循环（最多 `VISION_PROXY_MAX_ATTEMPTS` 次）：
  - fetch 抛错（网络层错误，非 AbortError）且尚有余量 → 等 2s 重试；最后一次直接把网络错误抛出。
  - 响应 `!ok` 且状态为 500/502/503 且尚有余量 → 等 2s 重试；最后一次按现状格式抛错（`status=... , endpoint=...: body`）。
  - AbortError（超时）→ 立即抛现状超时错误，不重试。
  - 4xx / 2xx 解析错误 → 立即抛，不重试。
  - 成功路径不变：返回 `{ data, rawContent, model }`，且只发一次请求。
- [x] `Decision`: 重试范围与策略（记录于 Decision 节）。
- [x] `Proof`: 对应 `docs/testing/2026/08-13-vision-proxy-retry-testing.md` 方向 1-6；运行级 stub 验证 500→200 重试成功、持续 500 只调 2 次后报错、网络错误后恢复、413 不重试、挂起超时不重试、200 成功路径仅调 1 次。

Exit Criteria:

- [x] 代理路径 500/502/503 与网络错误最多重试 1 次；成功路径仅调用 1 次。
- [x] 超时（AbortError）与 4xx 不重试；最终错误信息格式与现状一致。
- [x] `pnpm typecheck`、`pnpm build` 通过。
- [x] 运行级 stub 冒烟通过（500→200 恢复、持续 500 报错、413 立即失败、挂起超时；另覆盖网络错误恢复与 200 单次调用）。
- [x] `docs/architecture/2026-07-06-video-analysis-baseline.md` 健壮性不变量补充"代理路径失败自动重试 1 次"；`docs/logs/2026/08-13.md` 追加记录。
- [x] `docs/testing/2026/08-13-vision-proxy-retry-testing.md` 所有方向均已确认或明确裁定。

## Plan Audit

- Status: passed
- Reviewer / Agent: 独立 subagent（reviewer availability = none）
- Evidence: task `ses_0092dabdeffeJeiNQ9580epuHy` → `approved`；审计文件 `docs/audits/2026-08-13-plan-audit-vision-proxy-retry.md`

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck`、`pnpm build`、运行级 stub 冒烟 6/6）
- [x] `docs/testing/2026/08-13-vision-proxy-retry-testing.md` exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan exception not applicable（涉外部集成行为，full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（subagent 复核）
- [x] closure evidence exists in files

## Decision

### 重试范围与策略

- 选择：代理路径 fetch 网络错误 + 5xx 重试 1 次（固定 2s 间隔）；超时/4xx/解析错误不重试。
- 备选：(a) 配置化（env/LlmConfig 字段）——改动面更大，本次"加一次"需求用常量即可；(b) 对所有非 2xx 重试——会重复消费确定性错误（如文件不存在），收益低；(c) 不重试 5xx 仅重试网络错误——无法覆盖"代理已把 DashScope 瞬时失败包装成 500"的主故障路径（即本次报告的场景）。
- 残余风险：重试会重复一次 LLM 推理调用（可能双倍计费，视频需重新上传）；重试 500 若为确定性问题会浪费 ~2s + 一次调用。裁定：LLM 推理调用按内容幂等、无副作用，重试仅针对网络层/5xx 瞬时失败触发，且最多 1 次，可接受。

## Deferred But Adjudicated

### 重试次数与间隔配置化

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 本次固定 2 次尝试/2s 间隔满足"加一次重试"；如后续出现更高重试需求再配置化。
- Successor Required: `yes`（触发条件：单次重试仍出现失败案例，或需要按环境调整重试策略时重开）

## Closure

Status Note: 全计划已完成。Plan audit 独立 subagent 首轮 `approved`；闭核算独立 subagent `approved`。代码、文档、验证、testing 方向、日志五方一致。

Closure Audit Evidence:

- Reviewer / Agent: 独立 subagent，task `ses_0092a821bffecUol9X2Fs06yWT`
- Evidence: `docs/audits/2026-08-13-closure-audit-vision-proxy-retry.md`

Follow-up:

- 无（非阻塞 follow-up 仅见 Deferred 段）
