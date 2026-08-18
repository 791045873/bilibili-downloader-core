# 2026-08-18 视觉代理密钥改为请求透传 + 写死 SDK 基址

> Plan Status: completed
> Last Reviewed: 2026-08-18
> Source: 用户会话决策——代理调用大模型的 API Key 从环境变量改为 DB 动态来源（前端配置），经 Node 随请求透传；SDK 基址在代理代码写死；范围见 `docs/discussions/2026-08-18-proxy-auth-from-db.md`。
> Related: `docs/plans/2026-08-18-env-var-cleanup-plan.md`（已关闭；其"`DASHSCOPE_API_KEY` 为唯一密钥入口"决策被本计划取代）
> Audit: required（独立 subagent；reviewer availability = none，受保护区域 deployment 需 subagent/human 复核）
> Protected area: `deployment`（ask-first）——改动 `packages/docker/docker-compose.yml` env 桥接与代理运行契约。用户已在本会话明确授权。
> Testing: `docs/testing/2026/08-18-proxy-auth-from-db-testing.md`

## Current Baseline

- 代理 `packages/vision-proxy/qwen_vision_proxy.py:238-244`：`api_key = os.getenv("DASHSCOPE_API_KEY")`、`base_http_api_url = os.getenv("DASHSCOPE_BASE_HTTP_API_URL")`（未设置则 SDK 默认 `dashscope.aliyuncs.com/api/v1`）。
- Node `QwenClient.multimodalChat`（`packages/adapters/src/llm/qwen-client.ts`）向代理 POST 的请求体含 `model`（来自 DB `llm.modelName`），但不含 key（代理从 env 取）；无 `Authorization` 头。
- `getLlmConfig()`（`analysis-trigger.service.ts:656`、`analysis.controller.ts:470`）从 DB 读 `llm.apiKey`/`llm.baseUrl`/`llm.modelName`。
- 实测 DB：`llm.baseUrl=https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`；SDK 原生基址不同（`.../api/v1` + 原生路径）。
- compose `docker-compose.yml:12-13` 注入 `DASHSCOPE_API_KEY`/`DASHSCOPE_BASE_HTTP_API_URL`；`.env.example:7-8` 列出；本地 `packages/vision-proxy/.env` 含 `DASHSCOPE_API_KEY`（HOST/PORT 也在）。
- 活动文档残留：README L36/L42、`video-analysis-baseline.md:212-213`、`system-baseline.md:63` 描述"DASHSCOPE_API_KEY 经 env/compose 传给代理"。
- 历史留档（不修改）：docs/plans/logs/audits/testing 旧记录（含 env-cleanup 计划/日志/测试对 DASHSCOPE_API_KEY 的"唯一入口"表述）。

## Goals

- 代理不再从 env 取 key：改为解析请求 `Authorization: Bearer <key>`，缺失时报明确错误。
- 代理 SDK 基址写死 `https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/api/v1`（模块级赋值），移除 `DASHSCOPE_BASE_HTTP_API_URL` env 读取。
- Node `multimodalChat` 向代理请求加 `Authorization: Bearer <llm.apiKey>` 头（DB 来源）。
- 移除 `DASHSCOPE_API_KEY`/`DASHSCOPE_BASE_HTTP_API_URL` 于 compose/.env.example/本地 .env/活动文档；代理 key 与基址均为单一来源（DB + 代码写死）。
- 对外：代理 healthz 不变（无 key 也 200）；真实多模态调用需 `Authorization` 头；镜像职责不变。

## Non-Goals

- 不改写历史 plan/log/audit/testing 旧文档与 `docs/discussions/` 决策记录中的 DASHSCOPE_API_KEY env 描述（历史留档）；仅允许对已关闭 env-cleanup 测试文档追加失效标注，不改写其历史内容。
- 不新增前端/DB 字段（`llm.baseUrl` 保持 Node 直接调用/连通性测试用；代理 SDK 基址写死，暂不支持外部指定）。
- 不重构 `LlmConfig` 签名；不删 `llm.baseUrl`/`llm.apiKey` 字段（config-test ping 与 modelName 仍需）。
- 不动代理 HTTP 行为、body/超时/并发上限、healthcheck、compose 服务拓扑。

## Infrastructure And Config Prereqs

- 无新增依赖/端口/env。代理开发模式 `packages/vision-proxy/.env` 仅保留 `QWEN_VISION_PROXY_HOST`/`PORT`（删 `DASHSCOPE_API_KEY`）。
- Docker 构建不需 `DASHSCOPE_API_KEY`（代理不再读 env）；compose 删除对应桥接后 `--frozen-lockfile`/构建不受影响。

## Execution Plan

### Phase 1 - 代理取 key 与写死基址

Status: completed
Targets: `packages/vision-proxy/qwen_vision_proxy.py`

- [x] `Fix`: 模块级写死 `DASHSCOPE_BASE_URL = "https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/api/v1"` 并 `dashscope.base_http_api_url = DASHSCOPE_BASE_URL`（import dashscope 后）。
- [x] `Fix`: 新增取 key 逻辑：解析 `Authorization` 头（`Bearer <key>` 或裸 key），缺失/为空抛明确错误（缺头走既有异常路径返回 500 JSON，与既有"无 key POST 返回 500"行为一致，不引入 401）。
- [x] `Fix`: `_handle_post` 用 `api_key = _extract_api_key(self.headers)` 替代 `os.getenv("DASHSCOPE_API_KEY")`；删除 `DASHSCOPE_BASE_HTTP_API_URL` env 读取段（L242-244）。
- [x] `Decision`: 基址写死而非透传 `llm.baseUrl`。备选：(a) 透传 llm.baseUrl——其 OpenAI-compatible 路径与 SDK 原生路径不兼容会坏；(b) 新增前端 SDK 基址字段——用户明确暂不支持外部指定。残余风险：基址为特定工作区 `llm-oixf9mmfxlkakjoy` 专用，迁移工作区需改码。
- [x] `Proof`: `venv python -m py_compile packages/vision-proxy/qwen_vision_proxy.py` 通过；grep 确认无 `os.getenv("DASHSCOPE` 残留；运行时基址证明 `venv python -c ...` 输出私有端点 `https://llm-oixf9mmfxlkakjoy.cn-beijing.maas.aliyuncs.com/api/v1`。

Exit Criteria:

- [x] 代理不读 `DASHSCOPE_API_KEY`/`DASHSCOPE_BASE_HTTP_API_URL` env；key 来自 `Authorization` 头；基址写死。
- [x] 缺 `Authorization` 头时报明确错误；healthz 无 key 仍 200。

### Phase 2 - Node 请求带 Authorization 头

Status: completed
Targets: `packages/adapters/src/llm/qwen-client.ts`

- [x] `Fix`: `multimodalChat` 代理 POST 的 headers 增加 `Authorization: Bearer ${this.config.apiKey}`。
- [x] `Decision`: 用 `this.config.apiKey`（DB `llm.apiKey`）。备选：继续 env——违背用户诉求；Authorization 头为标准且不入代理日志。残余风险：key 经 compose 内网/本机 localhost 传输，属内部信任网络。
- [x] `Proof`: `pnpm --filter @bilibili-downloader/adapters typecheck` 与 `pnpm --filter @bilibili-downloader/server typecheck` 通过。

Exit Criteria:

- [x] `multimodalChat` 向代理请求携带 `Authorization: Bearer <llm.apiKey>`。
- [x] 编译通过，无类型/import 断裂。

### Phase 3 - 移除 DASHSCOPE_API_KEY / DASHSCOPE_BASE_HTTP_API_URL env

Status: completed
Targets: `packages/docker/docker-compose.yml`, `packages/docker/.env.example`, `packages/vision-proxy/.env`（本机）, `README.md`, `docs/architecture/2026-07-06-video-analysis-baseline.md`, `docs/architecture/system-baseline.md`, `docs/context/codebase-map.md`, `docs/testing/2026/08-18-env-var-cleanup-testing.md`（失效标注）

- [x] `Fix`: `docker-compose.yml` 删除 L12-13 两行（`DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_HTTP_API_URL` 桥接）。
- [x] `Fix`: `.env.example` 删除 `DASHSCOPE_API_KEY` 行与 `# DASHSCOPE_BASE_HTTP_API_URL=` 行及其说明（密钥现由前端 DB 配置，非 env）。
- [x] `Fix`: 本机 `packages/vision-proxy/.env` 删除 `DASHSCOPE_API_KEY`（保留 HOST/PORT）。
- [x] `Fix`: `README.md` L36/L42 改为「视觉代理密钥由前端设置页配置进数据库，Node 经 `Authorization` 头传给代理；不再需要任何 DashScope 密钥环境变量」。
- [x] `Fix`: `video-analysis-baseline.md` env 块删除 `DASHSCOPE_API_KEY`/`DASHSCOPE_BASE_HTTP_API_URL` 行（L212-213），并说明「代理密钥经请求 `Authorization` 头由 Node 透传（DB 来源）；SDK 基址在代理代码写死为私有工作区端点」。
- [x] `Fix`: `video-analysis-baseline.md` L239「`DASHSCOPE_*` … 由 Python 薄代理读取」改为「`QWEN_VISION_PROXY_*` 由 Python 薄代理读取；代理密钥经请求 `Authorization` 头由 Node 透传，SDK 基址代码写死」。
- [x] `Fix`: `system-baseline.md:63` 改为「密钥由前端设置页存 DB，Node 经 `Authorization` 头传给 vision-proxy 容器；不写入镜像、不经 compose env」。
- [x] `Fix`: `codebase-map.md` Vision Proxy 行（L18）改为「开发模式代理读 `packages/vision-proxy/.env` 的 HOST/PORT；密钥经 `Authorization` 头由 Node 透传（DB 来源），不落 env」。
- [x] `Fix`: `docs/testing/2026/08-18-env-var-cleanup-testing.md` 标注其"DASHSCOPE_API_KEY 唯一密钥入口"方向随本计划失效（改为 DB 来源 + 请求透传）；标注后该文件与其它历史 testing 文档同列，不再参与残留扫描。
- [x] `Proof`: 残留扫描——活动文件无 `DASHSCOPE_API_KEY`/`DASHSCOPE_BASE_HTTP_API_URL`（历史留档、`docs/discussions/`、已标注失效的 env-cleanup-testing 除外）。（注：README/.env.example 中先出现的"不再需要 DASHSCOPE_API_KEY"说明性文字已改写为不出现该字面串。）

Exit Criteria:

- [x] compose/.env.example/本地 .env/活动文档（含 video-analysis-baseline L239 与 codebase-map）无 `DASHSCOPE_API_KEY`/`DASHSCOPE_BASE_HTTP_API_URL` 及"DASHSCOPE_* 由代理读取"/"密钥读 vision-proxy/.env"等过期描述。
- [x] 文档 key 来源描述与 live 行为一致（DB + Authorization 头透传）。

### Phase 4 - 验证

Status: completed
Targets: 仓库级验证与 Docker 构建

- [x] `Proof`: `pnpm typecheck`、`pnpm build` 通过。
- [x] `Proof`: 开发模式代理 healthz 200；真实多模态调用带 `Authorization: Bearer <key>` 时通过 `_extract_api_key`（无 key 报错路径以代码审查 + curl 冒烟覆盖）。
- [x] `Proof`: `docker compose config` 通过；`pnpm docker:build` 两镜像构建成功（vision-proxy 镜像含代理脚本、venv 可导入 dashscope/dotenv）。

Exit Criteria:

- [x] 全部验证命令通过；镜像职责不变。
- [x] 残留扫描 0 命中（历史留档、`docs/discussions/`、已标注失效的 env-cleanup-testing 除外）；代理 key 来源为请求头。
- [x] `docs/logs/2026/08-18-proxy-auth-from-db.md` 记录本计划实施日志。

## Plan Audit

- Status: passed（两轮 subagent；首轮 blocker×1 + minor×3 + observation×3 → 修订 → 复核 approved）
- Reviewer / Agent: 独立 subagent（task `ses_febb51ddbffeJr11oZKk6SJ53y`）
- Evidence: 首轮确认技术设计全部成立（SDK 用 `dashscope.base_http_api_url` + 原生路径；模块级写死基址线程安全且优于逐请求赋值；`LlmConfig.apiKey` 在 multimodalChat 时必有；删 env 桥接安全）。blocker 为活动文档遗漏：`video-analysis-baseline.md:239`「DASHSCOPE_* 由代理读取」与 `codebase-map.md:18`「密钥读 vision-proxy/.env」不在 Phase 3 范围且扫描词捕不到；minors 为残留扫描与 env-cleanup-testing 失效标注矛盾、testing 缺"带 key"/不泄露方向、Phase 4 缺 docs/logs 步骤。均已修订（Phase 3 补两文件、明确扫描排除集、testing 补方向、Phase 4 补日志、Phase 1 补 500-vs-401 与运行时基址证明）。复核轮确认全部解决、无新增矛盾（仅 O4/O5 措辞对齐已落地），VERDICT approved。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck`、`pnpm build`、代理 healthz、`docker compose config`、`pnpm docker:build`、残留扫描）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan exception not applicable（涉 deployment + 代理/Node 契约 + 多文档，full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（subagent 或 human）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 代理 SDK 基址支持外部配置

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 用户明确"暂不支持外部指定 BaseURL"，基址写死为私有工作区端点 `llm-oixf9mmfxlkakjoy...`。
- Successor Required: `no`
- Reopen Trigger: 若需支持多工作区/多提供方（或换端点），再评估新增前端 SDK 基址字段或环境变量。

## Closure

Status Note: 代理密钥来源已从 env 改为 DB + 请求 `Authorization` 头透传、SDK 基址写死，编译/运行/Docker/文档全部对齐；独立 closure audit 复核通过后关闭。

Closure Audit Evidence:

- Reviewer / Agent: 独立 subagent（闭包复核，task `ses_feba7955affeImfNYXh7wHHFfE`）
- Evidence: 首轮 VERDICT reject closure——唯一阻塞为日志文件缺失（`docs/logs/2026/08-18-proxy-auth-from-db.md` 未创建，gate「log all agree」与 Phase 4 日志退出标准被提前勾选）；其余 8 项验证（代码 diff、文档、本地 .env、测试合理性、残留扫描、scope 无泄漏、历史文档未动、Deferred 正确非阻塞）全部 PASS。日志已补齐后复核通过（见下）。
- 复核：日志文件已创建并含实施摘要/决策/验证结果；cold-replay 重查 plan 状态、阶段状态、退出标准、closure gates、testing 文档、log 全部一致后 VERDICT approve closure。

Follow-up:

- 若需支持多工作区/多提供方（或更换 DashScope 端点），再评估代理 SDK 基址的外部配置（触发条件见 Deferred 项）。