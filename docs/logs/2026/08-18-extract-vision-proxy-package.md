# 2026-08-18 提取 Python 视觉代理为独立子包

关联计划：`docs/plans/2026-08-18-extract-vision-proxy-package-plan.md`

## 实施摘要

- 将视觉代理从 `packages/server/python/` 迁移为独立 workspace 子包 `packages/vision-proxy/`（`pyproject.toml` + `qwen_vision_proxy.py` + 最小 `package.json`，`@bilibili-downloader/vision-proxy`，scripts 委托根目录脚本）。
- `qwen_vision_proxy.py` 开发模式 env 归属解耦：`load_dotenv` 从 `parents[1] / ".env"`（`packages/server/.env`）改为 `parent / ".env"`（`packages/vision-proxy/.env`）。
- `scripts/setup-vision-proxy.mjs` / `scripts/start-vision-proxy.mjs` 路径常量改为 `packages/vision-proxy`；Dockerfile 两处 COPY 改路径、builder 阶段新增 `packages/vision-proxy/package.json` COPY、server 阶段删除 `rm -rf /app/python` 补丁（保留 mkdir + better-sqlite3 冒烟）。
- `pnpm-lock.yaml` 重新生成，新增 `packages/vision-proxy` importer；本机 `.venv` 重建于新位置（旧 venv 被开发代理进程占用，终止 watcher 后删除）。
- 文档对齐：README（子包 6→7，含 Bilibili API SDK 订正）、codebase-map、module-boundaries（新增 vision-proxy 边界段与依赖图）、video-analysis-baseline（路径 + env 归属）、project-context（active plan）。

## 关键决策落地

- 子包形态：`packages/vision-proxy/` + 最小 package.json，`pnpm -r build/typecheck` 因无对应脚本自动跳过（实测 Scope 7 of 8）。
- env 归属：各子包拥有各自 `.env`；Docker 模式密钥仍经 compose 注入不受影响；宿主开发模式用户需将 `DASHSCOPE_API_KEY` 等从 `packages/server/.env` 迁移到 `packages/vision-proxy/.env`（README 已指引，未自动搬运）。

## 验证结果

- `pnpm install` 成功，lockfile 仅新增 vision-proxy importer；`pnpm typecheck` / `pnpm build` exit 0。
- `pnpm setup:vision-proxy` 于 `packages/vision-proxy/.venv` 安装 dashscope-1.26.6 / python-dotenv-1.2.2，重复执行幂等；`--postinstall` 干净退出。
- 开发模式冒烟：`start-vision-proxy` 拉起后 `GET http://127.0.0.1:8765/healthz` → 200 `{"status":"ok"}`（无 `.env`）。
- `docker compose config` 通过；`pnpm docker:build` 构建出 `bilibili-downloader` 与 `bilibili-downloader:vision-proxy` 两镜像（`--frozen-lockfile` 解析新 importer 成功）。
- 镜像内容：server 无 python/venv/`/app/python`/代理脚本，前端产物存在；vision-proxy 有 `/app/python/qwen_vision_proxy.py`、venv 可导入 dashscope/dotenv、无 node/npm。
- 残留引用扫描：`server/python` 仅存在于历史留档与本批 discussion/plan/testing 文档，无活动代码/配置/文档引用。

## 说明

- 测试方向详情见 `docs/testing/2026/08-18-extract-vision-proxy-package-testing.md`。
- 真实 DashScope 模型调用未执行（需用户密钥与外部网络），按范围外裁定；`/healthz` 与无 key 启动路径已覆盖。
- 用户密钥未自动迁移（`packages/server/.env` 为 gitignored 本地文件），README 提供迁移指引。