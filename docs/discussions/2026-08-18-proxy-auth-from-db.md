# 2026-08-18 视觉代理密钥改为请求透传 + 写死 SDK 基址

## 需求来源

用户会话中提出：Python 视觉代理调用大模型使用的 API Key 不应从环境变量取得，而应与模型一样由用户经前端配置进数据库（动态数据）。经确认方案如下：
- Key：Node 从 DB 取 `llm.apiKey`，经 `Authorization: Bearer` 头随请求传给代理；代理用它调 DashScope SDK。
- DashScope SDK 基址：在代理代码中写死 `dashscope.base_http_api_url = 'https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/api/v1'`；**暂不支持外部/env 指定基址**。
- 顺带 `DASHSCOPE_API_KEY` 与 `DASHSCOPE_BASE_HTTP_API_URL` 两个 env 全部退役。

## 现状核实

- 代理 `qwen_vision_proxy.py:238-244`：`api_key = os.getenv("DASHSCOPE_API_KEY")`、`base_http_api_url = os.getenv("DASHSCOPE_BASE_HTTP_API_URL")`（未设置时用 SDK 默认 `https://dashscope.aliyuncs.com/api/v1`）。
- 模型已在请求体内由 Node 从 DB 带过去：`QwenClient.multimodalChat` 构造 `model: this.config.modelName`（`qwen-client.ts`），`getLlmConfig()` 读 DB `llm.modelName`。
- 实测 DB：`llm.baseUrl = https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`（OpenAI-compatible 格式）；`llm.apiKey`/`llm.modelName` 存在。
- SDK 关键点（查 venv 源码）：`MultiModalConversation.call` 用 `dashscope.base_http_api_url`（默认 `dashscope.aliyuncs.com/api/v1`）+ 原生路径 `/services/aigc/multimodal-generation/generation`，**不**用 OpenAI-compatible 基址。本地 `DASHSCOPE_BASE_HTTP_API_URL` 从未设置 → 当前代理实际打到阿里云公共默认端点，而非私有端点 `llm-oixf9mmfxlkakjoy...`；自定义模型 `qwen3.7-plus-2026-05-26` 很可能只在私有端点上可用（当前链路可能未走对模型）。
- 代理 `log_message` 只记 method/path/status，不记请求头/体；`logger.exception` 只记 method/path → Authorization 头不会入日志。

## 决策点

1. **Key 传递**：`Authorization: Bearer <llm.apiKey>` 头。代理解析头取 key，缺失时返回明确错误。HTTP 标准、不入请求体、不入日志。
2. **SDK 基址**：写死 `https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/api/v1`（用户指定 WorkspaceId）。备选（讨论中排除）：透传 `llm.baseUrl`——其 OpenAI-compatible 路径与 SDK 原生路径不兼容会坏；新增前端字段——用户明确"暂不支持外部指定基址"。残余风险：基址为特定工作区专用，换工作区/提供方需改码。
3. **env 退役**：`DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_HTTP_API_URL` 从 compose/.env.example/本地 .env/文档移除（代理不再读取）。
4. **与既有决策的关系**：本计划使 env-cleanup 计划"`DASHSCOPE_API_KEY` 为唯一密钥入口"决策失效（改为请求透传 + DB 单一来源）；proxy 的"无 env 密钥"行为由"缺 Authorization 头报错"取代。

## 待确认（非阻塞）

- 无。key 传递方式、基址写死、env 退役均已由用户确认。

## 推进路径

- 完整 plan：`docs/plans/2026-08-18-proxy-auth-from-db-plan.md`（改代理/Node 契约 + deployment compose env + 多文档，full plan + 独立 plan/closure audit）。