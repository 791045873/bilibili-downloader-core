# 2026-08-18 移除前端 BaseURL 配置 + 测试连接改用原生端点测试验证

关联计划：`docs/plans/2026-08-18-remove-baseurl-config-plan.md`

## 验证范围

本测试文档描述移除前端 `llm.baseUrl` 配置、测试连接改用与 Python 相同的原生端点后的可观察状态。重点是：设置页不再有 API 地址输入、config/test 请求写死原生端点 + 原生请求体、`LlmConfig`/server 不再依赖 baseUrl、编译与运行稳定、文档一致。

## 前提

- 本机可运行 `pnpm` 与 `docker compose`（v2+）。
- DB 中现存 `llm.apiKey`/`llm.modelName`；`llm.baseUrl` 为孤儿键（不删除）。
- config/test 真实验证需外部网络 + 私有端点可达；不可达时以"请求格式/参数校验正确、错误被完整返回"为准。

## 测试方向

### 前端无 BaseURL 配置

- [x] 应成立：设置页不再有「API 地址」输入框；`Settings.tsx` 的 llmForm/llmDirty/保存 patch/测试 patch 无 baseUrl。
- [x] 应成立：`api/index.ts` 的 `AnalysisLlmConfig`/更新/测试类型无 baseUrl。
- [x] 不应成立：前端仍收集或提交 `llm.baseUrl`。

### config/test 用原生端点

- [x] 应成立：`POST /api/analysis/config/test` 请求写死的原生端点 `https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`（与代理基址一致）。
- [x] 应成立：请求体为原生格式（`model`/`input.messages`/`parameters.result_format=message`），key 用 DB `llm.apiKey`；仅校验 `apiKey`+`modelName`。
- [x] 应成立：外部网络不可达/鉴权失败时返回完整错误（而非 400 参数错）。
- [x] 不应成立：config/test 仍使用 `llm.baseUrl` 或 OpenAI-compatible 直连。

### server/adapter 不再依赖 baseUrl

- [x] 应成立：server 各 `getLlmConfig`/配置端点不再读取/要求/返回 `llm.baseUrl`。
- [x] 应成立：`LlmConfig` 接口无 `baseUrl` 字段。
- [x] 应成立：`pnpm typecheck` 与 `pnpm build` 全部通过。
- [x] 不应成立：任何代码路径仍以 `llm.baseUrl` 作为 LLM 配置。

### 文档一致性

- [x] 应成立：活动文档不再把 baseUrl/API 地址描述为可用 LLM 配置。
- [x] 应成立：README/video-analysis-baseline 中模型配置为「API Key / 模型」；测试连接与代理同用写死端点。
- [x] 不应成立：活动文档残留 `llm.baseUrl`/「API 地址」作为配置（历史留档、`docs/discussions/` 除外）。

### 范围外裁定

- [x] 已裁定：真实原生端点成功调用——需外部网络 + 私有端点可达，不执行（真实调用会触发外部模型请求）；以请求格式/参数校验正确、错误完整返回、端点常量一致为准。
- [x] 已裁定：DB 中 `llm.baseUrl` 孤儿键删除——属数据删除保护区域，需用户确认，本期不删。
- [x] 已裁定：历史 plan/log/audit/testing 旧文档与 `docs/discussions/` 决策记录中的 baseUrl 描述——历史留档不修改，不参与残留扫描。

## 结果

### 通过

- [x] 前端：`Settings.tsx` 移除 llmForm/llmDirty/保存 patch/测试 patch 的 baseUrl 与「API 地址」输入框；`api/index.ts` 的 `AnalysisLlmConfig`/更新/测试类型移除 baseUrl；前端 typecheck 通过。
- [x] config/test：改用写死原生端点 + 原生请求体（`model`/`input.messages`/`parameters.result_format=message`），仅校验 apiKey+modelName；`!response.ok` 保留 raw 回显、成功以 `output.choices[0].message.content` 非空为准。
- [x] server/adapter：`resolveLlmSettings`/`getLlmConfigStatus`/`updateLlmConfig`/`getLlmConfig`（controller + trigger）去除 baseUrl；`LlmConfig` 接口去 baseUrl；`analysis-engine.ts:111`/trigger L671 错误信息去「API 地址」；`pnpm typecheck`/`pnpm build` exit 0。
- [x] 文档：README、`video-analysis-baseline.md`（L64 接口块、L234、qwen-client 头部）、`qwen_vision_proxy.py` 注释更新为「API Key/模型」与同用写死端点。
- [x] 端点一致：Node `DASHSCOPE_NATIVE_API_URL` = Python `DASHSCOPE_BASE_URL` + `/services/aigc/multimodal-generation/generation`。
- [x] 残留扫描：活动代码/文档对 `llm.baseUrl`/「API 地址」作为配置 0 命中（`analysis.controller.ts` 日志字段名 `baseUrl`、bilibili 流 `stream.baseUrl`、`summary-dir` 的 `baseUrl` 为无关同名；`video-analysis-baseline.md:196` 为 08-15 日期化 changelog 历史留档）。

### 明确裁定

- [x] 真实原生端点调用：需外部网络 + 私有端点可达，且会触发真实模型请求，不自动执行；请求构造由代码审查 + 端点常量一致证明。
- [x] `llm.baseUrl` 孤儿 DB 键：不删除（数据删除保护区域，用户后续可决定清理）。
- [x] 历史留档与 `docs/discussions/` 决策记录：不修改、不参与扫描。

## 执行证据

- `pnpm typecheck` / `pnpm build`：exit 0（Scope: 7 of 8 workspace projects）。
- 端点常量：Node `DASHSCOPE_NATIVE_API_URL = ".../api/v1/services/aigc/multimodal-generation/generation"`；Python `DASHSCOPE_BASE_URL = ".../api/v1"`；一致。
- 残留扫描：活动代码（ts/tsx，不含 node_modules/dist/.venv）与活动文档对 `llm.baseUrl`/「API 地址」作为 LLM 配置 0 命中；仅无关同名（`stream.baseUrl`/`summary-dir`/日志字段）与日期化 changelog 留档命中。