# 2026-08-18 环境变量清理（废弃/重复项移除）

关联计划：`docs/plans/2026-08-18-env-var-cleanup-plan.md`

## 实施摘要

- 移除 `DASH_SCOPE_API_KEY` 别名回退：`qwen_vision_proxy.py` 的 `api_key` 只读 `DASHSCOPE_API_KEY`、错误信息同步；`docker-compose.yml` 删除别名桥接；`.env.example` 删除别名说明与示例行。
- 移除 COS 死代码与依赖：`git rm packages/adapters/src/cos/`（2 文件 141 行）；adapters 根导出与 `./cos` exports 映射删除；`cos-nodejs-sdk-v5` 依赖移除；`pnpm-lock.yaml` 重生成（净删 443 行 / 57 个包）。
- 文档对齐：`video-analysis-baseline.md` 处理模块树、架构原则、env 块、透传描述、COS 备用路径共 9 处（L14/16/43/81/87/106/210/220/224/247-253/258/261）；无代理路径改为"直接调用兼容接口（图片需公网 URL）"；`system-baseline.md` 删除腾讯云 COS 平台条目。
- 本机 `.env` 按进程归属拆分：`server/.env` 仅留 `MAX_CONCURRENT_DOWNLOADS`、`QWEN_VISION_PROXY_URL`；`vision-proxy/.env` 仅留 `DASHSCOPE_API_KEY`、`QWEN_VISION_PROXY_HOST`、`QWEN_VISION_PROXY_PORT`；密钥值保留、未打印未提交。

## 关键决策落地

- 密钥单一入口：代理只认 `DASHSCOPE_API_KEY`；别名无使用者（本机仅用主键），风险可接受。
- COS 整段移除：类 + 导出 + 依赖一起删，避免"env 与代码脱钩"的半清理状态。

## 验证结果

- `pnpm typecheck` / `pnpm build` exit 0（Scope: 7 of 8 workspace projects，adapters 无 import 断裂）。
- 开发模式代理 healthz 200 `{"status":"ok"}`（清理 .env 后）。
- `docker compose config` 通过；`pnpm docker:build` 两镜像 Built（`--frozen-lockfile` 用更新后 lockfile）；vision-proxy 镜像含代理脚本、venv 导入 dashscope/dotenv、无 node；server 镜像无 python。
- 残留扫描：活动文件对 `DASH_SCOPE_API_KEY`/`TENCENT_COS`/`QWEN_VISION_MODEL`/`QWEN_API_KEY`/`cos-nodejs-sdk-v5`/`腾讯云 COS` 全 0 命中（历史留档除外）。

## 说明

- 测试方向详情见 `docs/testing/2026/08-18-env-var-cleanup-testing.md`。
- 真实 DashScope 模型调用未执行（需用户密钥与外部网络），按范围外裁定；healthz 与无 key 路径已覆盖。
- 历史 plan/log/audit/testing 与 requirements 旧文档中的旧 env 描述不修改（历史留档）。