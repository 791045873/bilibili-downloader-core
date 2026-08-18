# 2026-08-18 环境变量清理测试验证

关联计划：`docs/plans/2026-08-18-env-var-cleanup-plan.md`

## 验证范围

> 失效说明（2026-08-18 proxy-auth-from-db）：本文件的「`DASHSCOPE_API_KEY` 作为唯一密钥入口」方向已随 `docs/plans/2026-08-18-proxy-auth-from-db-plan.md` 失效——代理密钥改为 DB 来源 + 请求 `Authorization` 头透传，`DASHSCOPE_API_KEY`/`DASHSCOPE_BASE_HTTP_API_URL` env 退役。本文件属历史 testing 记录，不再参与后续残留扫描。

本测试文档描述移除废弃/重复环境变量后应保持的可观察状态。本次变更不改变任何活跃 env 的行为，重点是：`DASHSCOPE_API_KEY` 作为唯一密钥入口、COS 死代码与依赖移除后编译/构建/镜像不受影响、文档 env 清单与代码一致、开发模式代理仍可健康启动。

## 前提

- 本机可运行 `pnpm` 与 `docker compose`（v2+）。
- 开发模式无 `.env` 密钥时，代理仍应能启动且 `/healthz` 200（无 key 仅影响真实 DashScope 调用）。
- 历史文档（plan/log/audit/testing 旧记录）不参与一致性检查。

## 测试方向

### 密钥入口单一化

- [x] 应成立：代理代码只读取 `DASHSCOPE_API_KEY`；`DASH_SCOPE_API_KEY` 在活动代码/配置/文档中零引用。
- [x] 应成立：compose 与 `.env.example` 只提及 `DASHSCOPE_API_KEY`。
- [x] 不应成立：任何活动文件仍以 `DASH_SCOPE_API_KEY` 作为可用配置项。

### COS 死代码与依赖移除

- [x] 应成立：`packages/adapters/src/cos/` 目录不存在；adapters 根导出与 `./cos` exports 映射不存在；`cos-nodejs-sdk-v5` 不在 adapters 依赖与 `pnpm-lock.yaml` 中。
- [x] 应成立：`pnpm typecheck` 与 `pnpm build` 全部通过（无 import 断裂）。
- [x] 不应成立：`TENCENT_COS_*` 在活动文件或文档中作为可用配置项出现。

### 文档与代码一致性

- [x] 应成立：`video-analysis-baseline.md` 的环境变量清单与 live 代码读取集一致；无 `QWEN_VISION_MODEL`/`TENCENT_COS`/`DASH_SCOPE_API_KEY`/`QWEN_API_KEY`/`QWEN_API_BASE`/`QWEN_MODEL` 引用，且无 COS 备用路径/上传措辞残留。
- [x] 应成立："多模态调用必须经 Python 视觉代理；未配置 `QWEN_VISION_PROXY_URL` 时调用报错，无直连路径"；`system-baseline.md` 无腾讯云 COS 平台条目。（注：本条方向原为「无 QWEN_VISION_PROXY_URL 路径描述与 qwen-client.ts 实际行为一致（直接调用兼容接口，非 COS 上传）」，已随 `docs/plans/2026-08-18-remove-llm-dead-paths-plan.md` 移除直连分支而失效，此处为最新口径。）
- [x] 不应成立：活动文档把已删除变量或已删除 COS 能力描述为可用配置。

### 开发模式与 Docker 行为稳定

- [x] 应成立：清理本机 `.env` 后 `start-vision-proxy` 仍可启动代理，`GET http://127.0.0.1:8765/healthz` 返回 200 `{"status":"ok"}`。
- [x] 应成立：`docker compose config` 通过；`pnpm docker:build` 构建出两镜像；vision-proxy 镜像含 `/app/python/qwen_vision_proxy.py` 且 venv 可导入 dashscope/dotenv；server 镜像职责不变（无 python）。
- [x] 不应成立：清理导致 compose 构建失败（`--frozen-lockfile`）或镜像内容变化。

### 范围外裁定

- [x] 已裁定：真实 DashScope 模型调用——需用户密钥 + 外部网络，不执行；`/healthz` 与无 key 启动路径已覆盖。
- [x] 已裁定：历史 plan/log/audit/testing 文档中的旧 env 描述——历史留档不修改，不参与残留扫描。
- [x] 已裁定：`packages/server/.env` 与 `packages/vision-proxy/.env` 的键值内容——gitignored 本地文件，只清理键集、不打印/不提交密钥。

## 结果

### 通过

- [x] 密钥单一化：`qwen_vision_proxy.py` 的 `api_key` 只读 `DASHSCOPE_API_KEY`、错误信息同步；compose L13 与 `.env.example` 的别名删除；grep 活动文件 `DASH_SCOPE_API_KEY` 0 命中。
- [x] COS 移除：`git rm -r packages/adapters/src/cos`；`src/index.ts` 删 `export * from "./cos/index.js"`；`package.json` 删 `./cos` exports 与依赖；`pnpm install` 后 lockfile 净删 443 行、`cos-nodejs-sdk-v5` 0 命中。
- [x] 文档一致性：`video-analysis-baseline.md` 处理 L14/16/43/81/87/106/210/220/224/247-253/258/261（模块树、架构原则、env 块、透传描述、COS 备用路径全部对齐 live 代码）；`system-baseline.md` 删除腾讯云 COS 平台条目。
- [x] 本机 .env：`server/.env` 仅保留 `MAX_CONCURRENT_DOWNLOADS`、`QWEN_VISION_PROXY_URL`；`vision-proxy/.env` 仅保留 `DASHSCOPE_API_KEY`、`QWEN_VISION_PROXY_HOST`、`QWEN_VISION_PROXY_PORT`；键值保留、密钥未打印未提交。
- [x] 验证：`pnpm typecheck`/`pnpm build` exit 0；开发模式代理 healthz 200；`docker compose config` 通过；`pnpm docker:build` 两镜像 Built（`--frozen-lockfile` 用更新后 lockfile）；vision-proxy 镜像含代理脚本、venv 导入 dashscope/dotenv、无 node；server 镜像无 python/`/app/python`。
- [x] 残留扫描：活动文件（README/context/design/architecture/vision-proxy/docker/adapters src/scripts）对 `DASH_SCOPE_API_KEY`/`TENCENT_COS`/`QWEN_VISION_MODEL`/`QWEN_API_KEY`/`cos-nodejs-sdk-v5`/`腾讯云 COS` 全 0 命中。

### 明确裁定

- [x] 真实 DashScope 调用：需密钥 + 外部网络，范围外；healthz 与无 key 路径已覆盖。
- [x] 历史留档（plan/log/audit/testing 与 requirements 旧文档）：不修改、不参与扫描。
- [x] 本地 .env 密钥内容：只清键集，不打印/不提交。

## 执行证据

- `git rm -r packages/adapters/src/cos` → 两条删除；`pnpm install` → Packages: -57，`pnpm-lock.yaml` diff 2 insertions / 443 deletions。
- `pnpm typecheck` / `pnpm build`：exit 0（Scope: 7 of 8 workspace projects）。
- 冒烟：`VISION_PROXY_NO_RESTART=1` 下 `node ../../scripts/start-vision-proxy.mjs` → healthz 200 `{"status":"ok"}`；验证后清理进程。
- `docker compose config --quiet` 通过；`pnpm docker:build` 两镜像 Built。
- 镜像检查：vision-proxy 内 `/app/python/qwen_vision_proxy.py` 存在、venv 导入 ok、`command -v node` 空；server 内 `command -v python3` 空、`/app/python` 不存在。
- 残留扫描：Get-ChildItem 活动目录 grep 上述 6 个模式 0 命中。
- 本地 .env 键集：Read 后 Write 保留键值、删除废弃/跨进程键，git status 无 .env 变更（gitignored）。