# 2026-08-18 移除前端 BaseURL 配置 + 测试连接改用原生端点

关联计划：`docs/plans/2026-08-18-remove-baseurl-config-plan.md`

## 实施摘要

- 前端：`Settings.tsx` 移除「API 地址」输入与 llmForm/llmDirty/保存/测试 patch 的 baseUrl；`api/index.ts` 的 `AnalysisLlmConfig`/更新/测试类型移除 baseUrl。
- server：`analysis.controller.ts` 新增 `DASHSCOPE_NATIVE_API_URL` 常量（与代理基址一致的原生端点）；`resolveLlmSettings`/`getLlmConfigStatus`/`updateLlmConfig`/`getLlmConfig` 去除 `llm.baseUrl`；`testLlmConfig` 改写为请求写死原生端点 + 原生请求体（`model`/`input.messages`/`parameters.result_format=message`），key 用 DB `llm.apiKey`，仅校验 apiKey+modelName。`analysis-trigger.service.ts`/`analysis-engine.ts` 错误信息去「API 地址」。
- adapter：`LlmConfig` 接口移除 `baseUrl` 字段；头部注释更新。
- 文档：README、`video-analysis-baseline.md`（接口块、当前态描述）、`qwen_vision_proxy.py` 注释更新为「API Key/模型」与同用写死端点。

## 关键决策落地

- 测试连接与代理同用写死的原生 DashScope 端点（`.../api/v1/services/aigc/multimodal-generation/generation`），不再有 OpenAI-compatible 直连测试。
- `llm.baseUrl` 孤儿 DB 键不删除（数据删除保护区域，用户后续可决定清理）。

## 验证结果

- `pnpm typecheck` / `pnpm build` exit 0（Scope: 7 of 8 workspace projects）。
- 端点一致性：Node `DASHSCOPE_NATIVE_API_URL` = Python `DASHSCOPE_BASE_URL` + `/services/aigc/multimodal-generation/generation`。
- 残留扫描：活动代码/文档对 `llm.baseUrl`/「API 地址」作为 LLM 配置 0 命中（`stream.baseUrl`/`summary-dir`/日志字段名为无关同名；`video-analysis-baseline.md:196` 为 08-15 日期化 changelog 历史留档）。
- 真实原生端点调用未自动执行（会触发外部模型请求），以代码审查 + 端点常量一致证明。

## 说明

- 测试方向详情见 `docs/testing/2026/08-18-remove-baseurl-config-testing.md`。
- 历史 plan/log/audit/testing 旧文档与 `docs/discussions/` 决策记录中的 baseUrl 描述不修改（历史留档）。

## 追加：孤儿键 llm.baseUrl 清理（2026-08-18）

- 用户确认后执行数据删除（数据删除保护区域，已授权）。
- 备份：`packages/server/downloads/tasks.db.bak-20260818-remove-baseurl`。
- 执行：`DELETE FROM app_settings WHERE key='llm.baseUrl'`（删除 1 行）。
- 核实：`app_settings` 中 `llm.*` 现仅剩 `llm.apiKey`、`llm.modelName`；代码已不读取 `llm.baseUrl`（见本计划）。