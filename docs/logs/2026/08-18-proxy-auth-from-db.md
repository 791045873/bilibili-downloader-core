# 2026-08-18 视觉代理密钥改为请求透传 + 写死 SDK 基址

关联计划：`docs/plans/2026-08-18-proxy-auth-from-db-plan.md`

## 实施摘要

- 代理 `qwen_vision_proxy.py`：新增 `_extract_api_key`（解析 `Authorization: Bearer <key>`）；`_handle_post` 改用它；模块级写死 `dashscope.base_http_api_url = "https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/api/v1"`；删除 `os.getenv("DASHSCOPE_API_KEY")` 与 `os.getenv("DASHSCOPE_BASE_HTTP_API_URL")` 读取。
- Node `qwen-client.ts`：`multimodalChat` 向代理的 POST 请求增加 `Authorization: Bearer ${this.config.apiKey}`（DB `llm.apiKey` 来源）。
- env 退役：`DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_HTTP_API_URL` 从 compose/.env.example/本机 vision-proxy/.env/活动文档（README、video-analysis-baseline、system-baseline、codebase-map）移除；env-cleanup 测试文档追加失效标注。

## 关键决策落地

- Key 传递：Authorization 头（HTTP 标准、不入请求体/日志）；来源为 DB `llm.apiKey`（前端设置页配置）。
- SDK 基址：代码写死私有工作区端点（`llm-oixf9mmfxlkakjoy.../api/v1`），暂不支持外部指定；前端 `llm.baseUrl` 为 OpenAI-compatible 格式，与 SDK 原生路径不兼容，不可透传。
- 缺 `Authorization` 头：走既有异常路径返回 500 明确错误（不引入 401）；healthz 无 key 仍 200。

## 验证结果

- `py_compile` exit 0；运行时 `dashscope.base_http_api_url` 输出私有端点。
- 冒烟：healthz 200；无 auth POST → 500 `missing Authorization header with Bearer DashScope API key`；带 `Bearer sk-test` POST → 通过 key 提取进入 SDK 调用路径（返回 SDK 校验错误，非鉴权错误）。
- `pnpm typecheck` / `pnpm build` exit 0；`docker compose config` 通过；`pnpm docker:build` 两镜像 Built。
- 残留扫描：活动文件对 `DASHSCOPE_API_KEY`/`DASHSCOPE_BASE_HTTP_API_URL`/`DASH_SCOPE_API_KEY` 0 命中（历史/讨论/已标注失效文件除外）。

## 说明

- 测试方向详情见 `docs/testing/2026/08-18-proxy-auth-from-db-testing.md`。
- 真实 DashScope 私有端点多模态端到端调用未执行（需用户密钥 + 外部网络 + 私有端点可达），按范围外裁定；healthz 与带/无 key 冒烟已覆盖。
- 历史 plan/log/audit/testing 旧文档与 `docs/discussions/` 决策记录中的 `DASHSCOPE_API_KEY` env 描述不修改（历史留档）。