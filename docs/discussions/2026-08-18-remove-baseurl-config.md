# 2026-08-18 移除前端 BaseURL 配置 + 测试连接改用原生端点

## 需求来源

用户会话中提出：
1. 去掉前端页面对 BaseURL（`llm.baseUrl`）的配置。
2. 测试连通性时使用与 Python 视觉代理相同的端点——即写死的原生 SDK 端点 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` + 原生请求体格式（`input.messages` / `parameters.result_format`），参考用户提供的 `fetch` 示例（key 来源仍为 DB `llm.apiKey`，非 `process.env.DASHSCOPE_API_KEY`）。

## 现状核实

- 前端 `Settings.tsx` 有「API 地址」输入框（L324-331），存 `llm.baseUrl`；`api/index.ts` 的 `AnalysisLlmConfig`/更新/测试类型含 `baseUrl`。
- server：`analysis.controller.ts` 的 `getLlmConfigStatus`/`updateLlmConfig`/`testLlmConfig`/`getLlmConfig` 与 `analysis-trigger.service.ts:getLlmConfig` 均读写/要求 `llm.baseUrl`；`testLlmConfig` 当前直连 `${baseUrl}/chat/completions`（OpenAI-compatible 格式）。
- `adapters/llm/qwen-client.ts` 的 `LlmConfig` 含 `baseUrl` 字段，但 `multimodalChat` 已不使用（直连分支已移除、`chatCompletion` 已删）→ `baseUrl` 现仅被 config/test 使用。
- 代理 SDK 基址已写死为 `https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/api/v1`（`qwen_vision_proxy.py:DASHSCOPE_BASE_URL`）；用户要求测试连接用同一个端点。
- 实测 DB：`llm.baseUrl` 有值（OpenAI-compatible 格式），将随前端字段移除而成为孤儿键（无害，不删除以避免数据删除保护区域）。

## 决策点

1. **移除前端 BaseURL**：删除 `Settings.tsx` 的 API 地址输入、表单/脏标记/保存/测试 patch 中的 baseUrl；`api/index.ts` 类型去掉 baseUrl。`llm.baseUrl` 从 server 各 `getLlmConfig`/配置端点移除。
2. **测试连接改原生端点**：`POST /api/analysis/config/test` 改为请求写死的原生端点（与 Python 相同），请求体用原生格式（`model`/`input.messages`/`parameters.result_format=message`），key 用 DB `llm.apiKey`。校验仅需 `apiKey` + `modelName`（不再有 API 地址）。
3. **LlmConfig 去掉 baseUrl**：`adapters/llm/qwen-client.ts` 的 `LlmConfig` 移除 `baseUrl` 字段（已无消费者）。
4. **DB 孤儿键**：`llm.baseUrl` 残留行不删除（避免数据删除保护区域，无害；可后续由用户决定清理）。

## 待确认（非阻塞）

- 无。三项范围均已由用户确认。

## 推进路径

- 完整 plan：`docs/plans/2026-08-18-remove-baseurl-config-plan.md`（跨前端 + server + adapter 契约 + 多文档，full plan + 独立 plan/closure audit）。