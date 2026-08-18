# 2026-08-18 移除多模态直连分支与 chatCompletion 死代码

> Plan Status: completed
> Last Reviewed: 2026-08-18
> Source: 用户会话决策——`multimodalChat` 非代理分支与 `chatCompletion` 为死代码，一并移除；范围见 `docs/discussions/2026-08-18-remove-llm-dead-paths.md`。
> Related: `docs/plans/2026-08-18-env-var-cleanup-plan.md`（已关闭；其 Deferred 项「重建无代理公网 URL 上传能力」的现状前提在本计划后失效，需同步说明）
> Audit: required（独立 subagent；reviewer availability = none）
> Protected area: 无新增（不涉 deployment/auth/data；改动 adapter 内部契约，属外部集成行为，需 owner doc 一致——`video-analysis-baseline.md` 在更新范围内）
> Testing: `docs/testing/2026/08-18-remove-llm-dead-paths-testing.md`

## Current Baseline

- `packages/adapters/src/llm/qwen-client.ts`：`multimodalChat`（L135-228）含代理转发分支（L145-201）与直连分支（L203-227）；`chatCompletion`（L104-130）与 `ChatCompletionRequest`（L30-35）无任何调用方；`usesVisionProxy()`（L97-99）被 `analysis-engine.ts:153` 使用。
- `packages/adapters/src/llm/index.ts:4` 再导出 `ChatCompletionRequest`（无消费者）。
- `analysis-engine.ts:118-214` 为唯一多模态调用方：前置守卫要求 `usesVisionProxy()`（L153-157），随后单次 `multimodalChat(video_url+字幕)` 返回时间戳；从不调用 `chatCompletion`。直连分支因此不可达。
- 活跃文档残留：`docs/architecture/2026-07-06-video-analysis-baseline.md` L78/L99/L103 描述"无代理直连 / `chatCompletion()` 构造字幕分析请求"（与 live 代码不符）；`docs/testing/2026/08-18-env-var-cleanup-testing.md` L32 方向「无 QWEN_VISION_PROXY_URL 路径与 qwen-client.ts 实际行为一致（直接调用兼容接口）」随本计划失效。
- 历史留档（不修改）：docs/plans、docs/logs、docs/audits、docs/requirements 中关于 `chatCompletion`/直连路径的描述属当时记录。

## Goals

- 移除 `multimodalChat` 的直连分支：未配置 `visionProxyUrl` 时直接抛出明确错误（不再尝试直连）。
- 移除 `chatCompletion` 方法与 `ChatCompletionRequest` 接口及其再导出。
- 保留 `analysis-engine.ts` 的早期守卫与 `usesVisionProxy()`（快速失败 + 友好错误）。
- 活跃文档全部更新为"多模态必走代理"：`video-analysis-baseline.md` 流程与透传描述、env-cleanup 测试文档方向、env-cleanup 计划 Deferred 项现状说明。

## Non-Goals

- 不改历史 plan/log/audit/requirements/testing 旧文档与 `docs/discussions/` 决策记录中的直连/chatCompletion 描述（历史留档）。
- 不改视觉代理 Python 代码、compose、Dockerfile、环境变量。
- 不引入新依赖或新抽象；不重构 `LlmConfig`/`usesVisionProxy` 的签名。
- 不删除 `POST /api/analysis/config/test` 的纯文本连通性探测（`analysis.controller.ts:253-325`，直连 `{baseUrl}/chat/completions` 做最小 text ping，与多模态代理链路无关，属设置页测试功能）。

## Infrastructure And Config Prereqs

- 无新增依赖/端口/env。验证命令：`pnpm typecheck`、`pnpm build`、开发模式代理 healthz。

## Execution Plan

### Phase 1 - 移除直连分支与 chatCompletion

Status: completed
Targets: `packages/adapters/src/llm/qwen-client.ts`, `packages/adapters/src/llm/index.ts`

- [x] `Fix`: `qwen-client.ts` 删除 `multimodalChat` 直连分支（L203-227），并在方法开头改为：未配置 `visionProxyUrl` 时抛 `Error("LLM 多模态调用需要配置 QWEN_VISION_PROXY_URL（当前仅支持经 Python 视觉代理调用）")`。
- [x] `Fix`: `qwen-client.ts` 删除 `chatCompletion` 方法（L104-130）与 `ChatCompletionRequest` 接口（L30-35）。
- [x] `Fix`: `llm/index.ts` 删除 `ChatCompletionRequest` 再导出。
- [x] `Decision`: 保留 `usesVisionProxy()` 与 `analysis-engine.ts:153-157` 早期守卫。备选：把守卫移入 `multimodalChat`——会失去调用点前置的快速失败；现状双保险（调用点守卫 + 方法内防御）成本低、错误信息各自清晰。残余风险：未来新调用点若绕过守卫，方法内报错信息仍明确。
- [x] `Proof`: `pnpm --filter @bilibili-downloader/adapters typecheck` 与 `pnpm --filter @bilibili-downloader/server typecheck` 通过；grep 确认无 `chatCompletion`/`ChatCompletionRequest` 残留（历史留档除外）。

Exit Criteria:

- [x] `qwen-client.ts` 无直连分支与 `chatCompletion`；`multimodalChat` 未配置代理时抛明确错误。
- [x] `llm/index.ts` 无 `ChatCompletionRequest` 导出；全仓库无 `chatCompletion(` 调用（历史留档除外）。

### Phase 2 - 文档对齐

Status: completed
Targets: `docs/architecture/2026-07-06-video-analysis-baseline.md`, `docs/testing/2026/08-18-env-var-cleanup-testing.md`, `docs/plans/2026-08-18-env-var-cleanup-plan.md`（Deferred 项现状说明）

- [x] `Fix`: `video-analysis-baseline.md` L78 改为「`multimodalChat()` 将完整 OpenAI-style 多模态请求透传给 Python 薄代理（本地视频/图片由 DashScope SDK 读取）；多模态调用必须配置 `QWEN_VISION_PROXY_URL`，未配置将报错，无直连回退」。
- [x] `Fix`: `video-analysis-baseline.md` 流程图 L98-105 重写为单次调用流：`构造视频+字幕分析请求 → QwenClient.multimodalChat()（必须经 Python 视觉代理，未配置报错）→ 按返回时间戳 ffmpeg 截图 → 生成 Markdown`；删除 `chatCompletion()` 行（L99）、"多模态选图/解析选图"行（L101/L104）与「无 QWEN_VISION_PROXY_URL 直连」行（L103）。
- [x] `Fix`: `video-analysis-baseline.md` env 块注释 L217「配置后，多模态选图使用本地截图路径，由代理本机读取」改为「配置后，多模态调用使用本地视频/截图路径，由代理本机读取」。
- [x] `Fix`: `video-analysis-baseline.md` LLM 适配器章节删除 `ChatCompletionRequest` 接口块（L50-54）。
- [x] `Fix`: `video-analysis-baseline.md` 模块树 L21、架构原则 L38 的「多模态筛选/再选图」描述与 L39 的「选图」措辞改为「视频+字幕分析（单次多模态调用）→ 截图 → 文档生成」语义。
- [x] `Fix`: `video-analysis-baseline.md` L40 架构原则 5 改为「多模态输入不得使用 Base64；本地媒体经 Python 视觉代理由 DashScope SDK 本机读取（所有部署形态均需配置 `QWEN_VISION_PROXY_URL`，无公网 URL 直连路径）」。
- [x] `Fix`: `docs/testing/2026/08-18-env-var-cleanup-testing.md` L32 方向更新为「多模态调用必须经 Python 视觉代理；未配置 `QWEN_VISION_PROXY_URL` 时调用报错，无直连路径」，并标注本计划使其失效。
- [x] `Fix`: `docs/plans/2026-08-18-env-var-cleanup-plan.md` Deferred 项「重建无代理公网 URL 上传能力」的 Why-Not-Blocking 说明追加「现状前提（无代理时直接调用兼容接口）已随 2026-08-18 remove-llm-dead-paths 计划移除，该能力当前不可用」。
- [x] `Proof`: 文档一致性复查——按 Phase 3 的扫描文件范围（README/context/design/architecture/testing 活跃项，**本计划对应 testing 文档除外**——其措辞为验证工件描述，非过期声明）grep `chatCompletion`/`ChatCompletionRequest`/`多模态选图`/`无代理直连` 等过期描述，0 命中（历史留档与讨论记录除外）。

Exit Criteria:

- [x] `video-analysis-baseline.md` 流程与透传描述与 `qwen-client.ts` 实际行为一致（单次 multimodalChat、代理必选）。
- [x] env-cleanup 测试文档与计划的失效说明已标注；无活动文档残留直连/chatCompletion/ChatCompletionRequest 描述。

### Phase 3 - 验证

Status: completed
Targets: 仓库级验证与开发模式冒烟

- [x] `Proof`: `pnpm typecheck`、`pnpm build` 通过。
- [x] `Proof`: 开发模式 `start-vision-proxy` 代理 healthz 200（确认代理链路未受影响）；`docker compose config` 通过。
- [x] `Proof`: 残留扫描——活动文件（mjs/json/yaml/toml/ts/py/example/README/context/design/architecture/testing 活跃项，**本计划对应 testing 文档除外**）无 `chatCompletion`、`ChatCompletionRequest`、`无代理直连` 描述（历史留档除外）。

Exit Criteria:

- [x] 全部验证命令通过；代理链路行为不变。
- [x] 残留扫描 0 命中（历史留档除外）。（注：扫描曾命中 `analysis-engine.ts:297` 代码注释中的"多模态选图"字样，已改写注释规避；`.venv` 内 dashscope SDK 第三方源码的 `ChatCompletion` 命名与项目无关、gitignored，不在扫描范围。）

## Plan Audit

- Status: passed（四轮 subagent；首轮 blocker×1 + minor×2 + observation×3 → 逐轮修订 → 末轮 approved）
- Reviewer / Agent: 独立 subagent（task `ses_febe2841effewaEaNG2oLMqkhP`）
- Evidence: 首轮确认 baseline 全部准确（唯一调用点、守卫、chatCompletion 零消费、单次调用流、导入不悬空、类型不破坏），blocker 为 Phase 2 文档对齐不完整：①`video-analysis-baseline.md:50-54` 的 `ChatCompletionRequest` 接口块未列入 Phase 2（与 Phase 3 扫描自相矛盾）；②L98-105 流程图只补两行会残留"双 multimodalChat/多模态选图"矛盾。minors：testing 方向过宽（config/test 文本直连未豁免）、L40/L21/L38 过期、Phase 1 退出标准缺"历史留档除外"、discussions 未列入豁免。修订后复核轮新增：env 块 L217 与 L39 的"多模态选图/选图"残留、本计划 testing 文档自身措辞会触发扫描自失败（F2）。已全部修订（Phase 2 覆盖 L50-54/L98-105/L217/L39/L21/L38/L40、Non-Goals 豁免 discussions 与 config/test、扫描范围含本计划 testing 文档豁免）。末轮逐一核对无新增矛盾，VERDICT approved。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck`、`pnpm build`、代理 healthz、`docker compose config`、残留扫描）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan exception not applicable（改 adapter 公共契约 + 跨模块 + 多文档，full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（subagent 或 human）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 无代理公网 URL 多模态支持（原 env-cleanup 计划 Deferred 项）

- Classification: `out-of-scope improvement`（现状前提已失效）
- Why Not Blocking Closure: 本计划将直连分支移除后，多模态调用强制经代理；若未来需要无代理的公网 URL 多模态，需重新引入直连或云端托管能力（触发条件见 env-cleanup 计划 Deferred 项）。
- Successor Required: `no`
- Reopen Trigger: 用户提出需要在未部署 Python 代理的环境（如纯云端、无本地文件需求）使用多模态时，再评估恢复直连分支或云端托管。

## Closure

Status Note: 多模态直连分支与 chatCompletion 死代码已移除，编译/运行/文档全部对齐；独立 closure audit 复核通过后关闭。

Closure Audit Evidence:

- Reviewer / Agent: 独立 subagent（闭包复核，task `ses_febd74388ffeOKlbVphG3WgPB0`）
- Evidence: 首轮 VERDICT reject closure——唯一阻塞为日志文件缺失（`docs/logs/2026/08-18-remove-llm-dead-paths.md` 未创建，closure gate「log all agree」被提前勾选）；其余 9 项验证（代码 diff、文档对齐、残留扫描、config/test 保留、scope 无泄漏、历史文档未动）全部 PASS。日志已补齐后复核通过（见下）。
- 复核：日志文件已创建并含实施摘要/决策/验证结果；cold-replay 重查 plan 状态、阶段状态、退出标准、closure gates、testing 文档、log 全部一致后 VERDICT approve closure。

Follow-up:

- 无阻塞项。若未来需要无代理公网 URL 多模态，触发条件见 Deferred 项（重新引入直连或云端托管）。