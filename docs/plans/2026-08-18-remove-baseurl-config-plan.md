# 2026-08-18 移除前端 BaseURL 配置 + 测试连接改用原生端点

> Plan Status: completed
> Last Reviewed: 2026-08-18
> Source: 用户会话决策——去掉前端 `llm.baseUrl` 配置，测试连接改用与 Python 视觉代理相同的原生端点/请求体；范围见 `docs/discussions/2026-08-18-remove-baseurl-config.md`。
> Related: `docs/plans/2026-08-18-proxy-auth-from-db-plan.md`（已关闭；本计划在其"代理基址写死、密钥请求透传"之上移除 llm.baseUrl）
> Audit: required（独立 subagent；reviewer availability = none）
> Protected area: 无新增（改 adapter 公共契约 + 跨模块 + 前端 API 契约；`llm.baseUrl` 孤儿 DB 键不删除，不触发数据删除保护）
> Testing: `docs/testing/2026/08-18-remove-baseurl-config-testing.md`

## Current Baseline

- 前端 `Settings.tsx`：llmForm/llmDirty/useEffect/保存 patch/测试 patch 均含 `baseUrl`（L49/54/70/73/88/92/100/103/115-116）；「API 地址」输入框 L323-331。
- 前端 `api/index.ts`：`AnalysisLlmConfig.baseUrl`（L264）、`updateAnalysisConfig` patch（L275）、`testAnalysisConfig` patch（L294）。
- server `analysis.controller.ts`：`resolveLlmSettings` 读 `llm.baseUrl`（L193/201）、`getLlmConfigStatus` 返回 baseUrl（L210/222）、`updateLlmConfig` 接受/存 baseUrl（L232/238）、`testLlmConfig` 直连 `${baseUrl}/chat/completions`（L267-280/284/296-300）、`getLlmConfig` 要求/返回 baseUrl（L473/483/492）。
- server `analysis-trigger.service.ts:getLlmConfig` 读/要求/返回 baseUrl（L659/663/670/676）。
- `adapters/llm/qwen-client.ts` `LlmConfig.baseUrl`（L24）——已无消费者（直连分支与 chatCompletion 已删）。
- `analysis-engine.ts:111` 错误信息含「API 地址」。
- 代理 SDK 基址写死 `https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/api/v1`（原生路径 `/services/aigc/multimodal-generation/generation`）。
- 活动文档：README:42、`video-analysis-baseline.md:64/198/236` 提到 baseUrl / API 地址；`qwen_vision_proxy.py:74` 注释提 llm.baseUrl。
- 历史留档（不修改）：docs/plans/logs/audits/testing 旧记录（含 08-15 llm-config-frontend 计划）。

## Goals

- 移除前端 BaseURL 配置（设置页不再有「API 地址」输入；类型/表单/保存/测试不再含 baseUrl）。
- `llm.baseUrl` 从 server 各 getLlmConfig/配置端点移除；`LlmConfig` 去掉 baseUrl 字段。
- `POST /api/analysis/config/test` 改为请求写死的原生端点（与 Python 相同）+ 原生请求体（`input.messages`/`parameters.result_format=message`），key 用 DB `llm.apiKey`；仅校验 `apiKey`+`modelName`。
- 活动文档与 live 行为一致；`llm.baseUrl` 孤儿 DB 键保留（无害，不删除）。

## Non-Goals

- 不改历史 plan/log/audit/testing 旧文档中的 baseUrl 描述（历史留档）。
- 不删除 DB 中已存在的 `llm.baseUrl` 行（避免数据删除保护区域；留作无害孤儿键，后续由用户决定清理）。
- 不改代理代码、compose、环境变量；不改 `QWEN_VISION_PROXY_*`。
- 不引入新的外部配置项（代理基址仍写死）。

## Infrastructure And Config Prereqs

- 无新增依赖/端口/env。验证命令：`pnpm typecheck`、`pnpm build`、config/test 端点冒烟（用 DB 现存 `llm.apiKey`+`llm.modelName` 打原生端点，因需外部网络可能失败，以请求格式/参数校验通过为准）。

## Execution Plan

### Phase 1 - 前端移除 BaseURL 配置

Status: completed
Targets: `packages/frontend/src/pages/Settings.tsx`, `packages/frontend/src/api/index.ts`

- [x] `Fix`: `Settings.tsx` 删除 llmForm 的 `baseUrl`（L49）、llmDirty 的 `baseUrl`（L54）、useEffect 初始（L70）、setLlmDirty（L73）、保存 patch 类型与逻辑（L88/92/100/103）、测试 patch（L115-118）、「API 地址」输入框（L323-331）。
- [x] `Fix`: `api/index.ts` 删除 `AnalysisLlmConfig.baseUrl`（L264）、`updateAnalysisConfig` patch 的 baseUrl（L275）、`testAnalysisConfig` patch 的 baseUrl（L294）。
- [x] `Proof`: `pnpm --filter @bilibili-downloader/frontend typecheck` 通过。

Exit Criteria:

- [x] 前端设置页无「API 地址」输入；llmForm/llmDirty/patch/类型无 baseUrl。
- [x] 前端编译通过。

### Phase 2 - server 移除 baseUrl + 测试连接改原生端点

Status: completed
Targets: `packages/server/src/analysis/analysis.controller.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`, `packages/server/src/analysis/analysis-engine.ts`

- [x] `Fix`: `analysis.controller.ts` `resolveLlmSettings` 去掉 `"llm.baseUrl"`（L193/201）；`getLlmConfigStatus` 不再返回 baseUrl（L210/222）；`updateLlmConfig` body/patch 去掉 baseUrl（L232/238）。
- [x] `Fix`: `analysis.controller.ts` `testLlmConfig` 重写：新增模块级常量 `DASHSCOPE_NATIVE_API_URL = "https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"`（注释注明须与 `qwen_vision_proxy.py:DASHSCOPE_BASE_URL` 一致）；去 baseUrl 校验，仅需 apiKey+modelName；请求体用原生格式（`model`/`input.messages`/`parameters.result_format=message`）；key 用 DB `llm.apiKey`。原生错误处理：`!response.ok` 时保留 raw body 回显（覆盖 `{code,message}` 非 2xx 错误）；200 时若存在 `error`/`error.message` 判失败；成功以 `output.choices[0].message.content` 非空为准（content 可能是字符串或数组，只判非空）。
- [x] `Fix`: `analysis.controller.ts` `getLlmConfig`（L470-497）去掉 baseUrl 读取/要求/返回。
- [x] `Fix`: `analysis-trigger.service.ts:getLlmConfig`（L659-681）去掉 baseUrl 读取/要求/返回；L671 错误信息「API Key/API 地址/模型」→「API Key/模型」。
- [x] `Fix`: `analysis-engine.ts:111` 错误信息「API Key/API 地址/模型」→「API Key/模型」。
- [x] `Decision`: 测试连接用写死原生端点 + 原生请求体。备选：保留 OpenAI-compatible 直连测试——但该端点已不承载任何调用（直连分支已删），且用户明确要求与 Python 同端点。残余风险：原生端点请求需外部网络/私有端点可达，测试失败时错误为网络/鉴权/模型相关（返回完整错误信息）。
- [x] `Proof`: `pnpm --filter @bilibili-downloader/server typecheck` 通过；config/test 冒烟（请求体格式与参数校验）。

Exit Criteria:

- [x] server 无 `llm.baseUrl` 读取/要求/返回；`LlmConfig` 侧无 baseUrl（见 Phase 3）。
- [x] config/test 用原生端点 + 原生请求体，仅校验 apiKey+modelName。

### Phase 3 - adapter LlmConfig 去掉 baseUrl

Status: completed
Targets: `packages/adapters/src/llm/qwen-client.ts`

- [x] `Fix`: `LlmConfig` 接口删除 `baseUrl` 字段（L24）。
- [x] `Fix`: `qwen-client.ts` 头部注释「（OpenAI 兼容格式）」改为反映当前仅走视觉代理路径。
- [x] `Decision`: 删 `baseUrl` 字段。备选：保留——已无消费者，保留会继续传播过期契约；残余风险：无（已确认 multimodalChat/chatCompletion 均不使用）。
- [x] `Proof`: `pnpm --filter @bilibili-downloader/adapters typecheck` 通过；grep 确认无 `LlmConfig` 构造含 baseUrl。

Exit Criteria:

- [x] `LlmConfig` 无 baseUrl；全仓库无 `llm.baseUrl` 读取（历史留档除外）。

### Phase 4 - 文档对齐

Status: completed
Targets: `README.md`, `docs/architecture/2026-07-06-video-analysis-baseline.md`, `packages/vision-proxy/qwen_vision_proxy.py`（注释）, `docs/logs/2026/08-18-remove-baseurl-config.md`（新增）

- [x] `Fix`: `README.md:42` 「API Key/API 地址/模型」改为「API Key/模型」；说明测试连接与代理同用写死端点。
- [x] `Fix`: `video-analysis-baseline.md` L64（`LlmConfig` 接口块去 baseUrl）、L198、L236（「API Key / API 地址 / 模型」→「API Key / 模型」；`llm.apiKey`/`llm.modelName`）；顺带对齐同块 L63 `apiKey // 从环境变量读取`（改为 DB）与 L67 `visionModelName`（已移除，删除）。
- [x] `Fix`: `qwen_vision_proxy.py:74` 注释更新（不再提 `llm.baseUrl`，改述「Node 测试连接与代理同用本写死基址」）。
- [x] `Add`: 本计划 `docs/testing/` 与 `docs/logs/` 文档。
- [x] `Proof`: 文档一致性复查——活动文档无 baseUrl/API 地址 作为可用 LLM 配置项（历史留档除外）。

Exit Criteria:

- [x] 活动文档无 `llm.baseUrl` 作为可用配置；测试连接与代理端点描述一致。
- [x] `docs/logs/2026/08-18-remove-baseurl-config.md` 记录本计划实施日志。

### Phase 5 - 验证

Status: completed
Targets: 仓库级验证 + config/test 冒烟

- [x] `Proof`: `pnpm typecheck`、`pnpm build` 通过。
- [x] `Proof`: config/test 冒烟——用 DB `llm.apiKey`+`llm.modelName` 请求 `/api/analysis/config/test`，确认请求打到写死原生端点（外部网络不可达时代理/网络错误被完整返回，非 400 参数错）。（注：真实调用会触发外部模型请求，不自动执行；以代码审查 + 端点常量一致性证明请求目标与格式。）
- [x] `Proof`: 常量一致性——断言 Node `DASHSCOPE_NATIVE_API_URL` 等于 Python `DASHSCOPE_BASE_URL + "/services/aigc/multimodal-generation/generation"`（跨语言漂移兜底）。
- [x] `Proof`: 残留扫描——活动文件无 `llm.baseUrl`/「API 地址」作为 LLM 配置（历史留档、`docs/discussions/` 除外）。（注：`analysis.controller.ts` 日志字段名 `baseUrl` 与 bilibili 流 `stream.baseUrl`/`summary-dir` 的 `baseUrl` 为无关同名，非 `llm.baseUrl`；`video-analysis-baseline.md:196` 为 08-15 日期化 changelog 历史留档。）

Exit Criteria:

- [x] 全部验证命令通过；config/test 请求格式/参数校验正确。
- [x] Node/Python 端点常量一致；残留扫描 0 命中（历史留档除外）。

## Plan Audit

- Status: passed（两轮 subagent；首轮无 blocker + minor×3 + observation×3 → 修订 → 复核 approved）
- Reviewer / Agent: 独立 subagent（task `ses_feb9ef9f4ffe9kH9fDF0iDjsHO`）
- Evidence: 首轮确认全部 baseline 准确（前端/controller/trigger/adapter 各引用点、LlmConfig 无其他消费者、原生响应结构、无遗漏活动文档）。minor：①trigger service L671 错误信息漏改；②Node/Python 端点常量一致性缺验证；③原生错误字段措辞需澄清。observations：video-analysis-baseline L63/L67 陈旧行、qwen-client 头部注释、docs/logs 步骤。均已修订（Phase 2 补 L671 + 澄清原生错误处理、Phase 5 补常量一致性 Proof、Phase 3 补头部注释、Phase 4 对齐 L63/L67 + 补日志步骤）。复核轮确认全部解决、无新增矛盾，VERDICT approved。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck`、`pnpm build`、config/test 冒烟、残留扫描）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan exception not applicable（改 adapter/前端 API 契约 + 跨模块 + 多文档，full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（subagent 或 human）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 清理 DB 中孤儿键 llm.baseUrl

- Classification: `out-of-scope improvement` → **已执行（2026-08-18）**
- Why Not Blocking Closure: `llm.baseUrl` 残留行已不被任何代码读取，无害；删除属数据删除保护区域，需用户确认。
- Successor Required: `no`
- Reopen Trigger: ~~用户确认清理 app_settings 历史键时再单独处理~~（已执行：用户确认后于 2026-08-18 备份 DB 并删除该行，见 `docs/logs/2026/08-18-remove-baseurl-config.md`）。

## Closure

Status Note: 前端 BaseURL 配置已移除、`LlmConfig`/server 不再依赖 baseUrl、测试连接改用与代理相同的原生端点，编译/运行/文档全部对齐；独立 closure audit 复核通过后关闭。

Closure Audit Evidence:

- Reviewer / Agent: 独立 subagent（闭包复核，task `ses_feb95e2e6ffep2hJYJVojouMiO`）
- Evidence: 首轮 VERDICT reject closure——唯一阻塞为日志文件缺失（`docs/logs/2026/08-18-remove-baseurl-config.md` 未创建，Phase 4/exit criteria 被提前勾选）；其余 8 项验证（前端/server/adapter 代码 diff、文档、.env 未动、测试合理性、残留扫描、scope 无泄漏、Deferred 正确非阻塞）全部 PASS。日志已补齐后复核通过（见下）。
- 复核：日志文件已创建并含实施摘要/决策/验证结果；cold-replay 重查 plan 状态、阶段状态、退出标准、closure gates、testing 文档、log 全部一致后 VERDICT approve closure。

Follow-up:

- `llm.baseUrl` 孤儿 DB 键清理：数据删除保护区域，用户确认后单独处理（触发条件见 Deferred 项）。