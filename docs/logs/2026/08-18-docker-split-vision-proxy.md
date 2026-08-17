# 2026-08-18 Docker 拆分 Python 视觉代理为独立容器

关联计划：`docs/plans/2026-08-18-docker-split-vision-proxy-plan.md`

## 实施摘要

- `packages/docker/Dockerfile` 重构为多 target：`builder` / `python-builder` / `server` / `vision-proxy`。
- server 镜像：仅 Node 服务 + 前端构建产物 + FFmpeg + tini；移除 python3/venv/代理脚本，移除 `entrypoint.sh`，`CMD` 直接执行 node，HEALTHCHECK 只探测自身 3000。
- vision-proxy 镜像：venv Python + 代理脚本 + tini；显式删除 Node 工具链；默认监听 `0.0.0.0:8765`，HEALTHCHECK 经 stdlib urllib 探 `/healthz`。
- 新增 `packages/docker/docker-compose.yml`：`server` 与 `vision-proxy` 两个 service，均 `restart: unless-stopped`，共享 `/download` volume，`server` 依赖 `vision-proxy` 先健康（`depends_on.condition=service_healthy`），8765 不发布宿主机端口。
- 新增 `packages/docker/.env.example`；`packages/docker/package.json` 的 `docker:build` → `docker compose build`、`docker:run` → `docker compose up -d`，新增 `docker:down` / `docker:logs`。

## 关键决策落地

- 代理监听地址：容器模式 `0.0.0.0`（跨容器可达），宿主开发模式仍 `127.0.0.1`（代码默认未改）。
- server 默认 `QWEN_VISION_PROXY_URL=http://vision-proxy:8765/v1/chat/completions`（服务名网络），compose 可覆盖。
- compose 中三个代理可调参数给出与代码一致的默认值（`16MB` / `8` / `120`），避免 `<VAR>:-` 空串被 `int()` 拒收（实测发现并修复）。

## 验证结果

- 双镜像独立构建成功；职责分离经运行检查确认（server 无 python/venv/代理文件；vision-proxy 无 node/npm/ffmpeg/前端，venv 可导入 dashscope/dotenv）。
- compose 启动双容器 healthy；server 容器内 `fetch('http://vision-proxy:8765/healthz')` 200；宿主 3000 前端与 API 可用；`docker port` 仅 3000。
- 崩溃恢复：杀 vision-proxy 主进程 → 容器被 Docker 自动重启并恢复 healthy，server 不受影响；杀 server 主进程 → 仅 server 重启恢复，proxy 不受影响。
- 共享 volume 生成 `server-*.log` 与 `vision-proxy.log`；`docker compose down` 优雅停止、无残留。
- `pnpm typecheck` 通过（Docker 改动不影响 TS，按计划执行确认）。

## 说明

- 测试方向详情见 `docs/testing/2026/08-18-docker-split-vision-proxy-testing.md`。
- 未执行真实 DashScope 模型调用（需用户密钥与外部网络），按范围外裁定。