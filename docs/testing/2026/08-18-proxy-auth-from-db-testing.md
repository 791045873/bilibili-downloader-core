# 2026-08-18 视觉代理密钥改为请求透传 + 写死 SDK 基址测试验证

关联计划：`docs/plans/2026-08-18-proxy-auth-from-db-plan.md`

## 验证范围

本测试文档描述代理密钥来源变更后应保持的可观察状态。重点是：代理不再从 env 取 key、key 经 `Authorization` 头由 Node 透传（DB 来源）、SDK 基址写死、`DASHSCOPE_API_KEY`/`DASHSCOPE_BASE_HTTP_API_URL` env 退役、代理 healthz 与镜像职责不变。

## 前提

- 本机可运行 `pnpm` 与 `docker compose`（v2+）。
- 代理开发模式 `packages/vision-proxy/.env` 仅含 `QWEN_VISION_PROXY_HOST`/`PORT`（无 key）。
- 真实 DashScope 调用需用户密钥 + 外部网络 + 私有端点可达，不作为必须项；healthz 与无 key 错误路径已覆盖。

## 测试方向

### 代理密钥来源

- [x] 应成立：`qwen_vision_proxy.py` 不再读取 `DASHSCOPE_API_KEY`/`DASHSCOPE_BASE_HTTP_API_URL` 环境变量；key 从请求 `Authorization` 头解析（`Bearer <key>`）。
- [x] 应成立：带 `Authorization: Bearer <key>` 的多模态 POST 被代理接受并进入调用（key 非空即通过解析），而非鉴权错误。
- [x] 应成立：缺少 `Authorization` 头（或空 key）时，代理对多模态 POST 返回明确错误（500 JSON，与既有无 key 行为一致）；`/healthz` 无 key 仍 200。
- [x] 不应成立：`Authorization` 头/密钥明文出现在错误响应或代理日志中。
- [x] 不应成立：代理仍从环境变量取得 key。

### SDK 基址

- [x] 应成立：代理在 import 后设置 `dashscope.base_http_api_url = "https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/api/v1"`（写死）。
- [x] 不应成立：代理仍读取 `DASHSCOPE_BASE_HTTP_API_URL` env 来设置基址。

### Node 透传

- [x] 应成立：`QwenClient.multimodalChat` 向代理的 POST 请求携带 `Authorization: Bearer <llm.apiKey>` 头（DB 来源）。
- [x] 应成立：`pnpm typecheck` 与 `pnpm build` 全部通过（无类型/import 断裂）。
- [x] 不应成立：Node 仍依赖代理 env 密钥。

### env 退役与文档一致性

- [x] 应成立：`DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_HTTP_API_URL` 从 compose/.env.example/本机 vision-proxy/.env/活动文档移除。
- [x] 应成立：文档描述密钥为 DB 来源 + 请求透传，SDK 基址为代码写死。
- [x] 不应成立：活动代码/配置/文档残留这两个 env（历史留档、`docs/discussions/`、已标注失效的 env-cleanup-testing 除外）。

### 运行与部署稳定

- [x] 应成立：开发模式代理 healthz 200；`docker compose config` 通过；`pnpm docker:build` 两镜像构建成功。
- [x] 应成立：vision-proxy 镜像含代理脚本、venv 可导入 dashscope/dotenv；server 镜像职责不变（无 python）。
- [x] 不应成立：本次变更影响 compose 服务拓扑、端口、healthcheck 或镜像内容结构。

### 范围外裁定

- [x] 已裁定：真实 DashScope 模型调用（含私有端点多模态端到端）——需用户密钥 + 外部网络 + 私有端点可达，不执行；healthz 与无 key/带 key 冒烟已覆盖。
- [x] 已裁定：历史 plan/log/audit/testing 旧文档与 `docs/discussions/` 决策记录中的 `DASHSCOPE_API_KEY` env 描述——历史留档不修改，不参与残留扫描。

## 结果

### 通过

- [x] 代理密钥来源：`_extract_api_key(self.headers)` 从 `Authorization` 头取 key；`os.getenv("DASHSCOPE_API_KEY")` 与 `DASHSCOPE_BASE_HTTP_API_URL` 读取段删除；缺头 POST 返回 `500 {"error":"missing Authorization header with Bearer DashScope API key"}`；带 `Bearer sk-test` 的 POST 通过 key 提取并进入 SDK 调用路径（返回 SDK 校验错误，非鉴权错误）；healthz 无 key 200。
- [x] SDK 基址：模块级写死 `dashscope.base_http_api_url`；运行时证明输出 `https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/api/v1`；无 `DASHSCOPE_BASE_HTTP_API_URL` 读取。
- [x] Node 透传：`multimodalChat` 代理请求 headers 含 `Authorization: Bearer ${this.config.apiKey}`；`pnpm typecheck`/`pnpm build` exit 0。
- [x] env 退役：compose 两行桥接、`.env.example`、本机 `vision-proxy/.env` 的 `DASHSCOPE_API_KEY` 删除；README/video-analysis-baseline/system-baseline/codebase-map 更新为 DB 来源 + Authorization 头透传 + 基址写死；env-cleanup-testing 追加失效标注。
- [x] 运行部署：代理 healthz 200；`docker compose config` 通过；`pnpm docker:build` 两镜像 Built；残留扫描 0 命中（README/.env.example 中先出现的"不再需要"说明文字已改写为不出现字面串）。

### 明确裁定

- [x] 真实 DashScope 私有端点多模态端到端调用：需用户密钥 + 外部网络，范围外；healthz 与带/无 key 冒烟已覆盖（带 key 已证明进入 SDK 调用路径）。
- [x] 历史留档与 `docs/discussions/` 决策记录：不修改、不参与扫描。

## 执行证据

- `venv python -m py_compile packages/vision-proxy/qwen_vision_proxy.py` exit 0。
- 运行时基址：`python -c "...import qwen_vision_proxy...print(dashscope.base_http_api_url)"` → `https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/api/v1`。
- 冒烟（VISION_PROXY_NO_RESTART=1）：healthz 200 `{"status":"ok"}`；无 auth POST → 500 `missing Authorization header with Bearer DashScope API key`；带 `Bearer sk-test` POST → 进入 SDK（返回 SDK 校验错误，非鉴权错误）；验证后清理进程。
- `pnpm typecheck` / `pnpm build`：exit 0（Scope: 7 of 8 workspace projects）。
- `docker compose config` 通过；`pnpm docker:build`：`Image bilibili-downloader Built`、`Image bilibili-downloader:vision-proxy Built`。
- 残留扫描：活动文件对 `DASHSCOPE_API_KEY`/`DASHSCOPE_BASE_HTTP_API_URL`/`DASH_SCOPE_API_KEY` 0 命中（不含 .venv 与历史/讨论/已标注失效文件）。