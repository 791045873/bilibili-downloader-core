# 2026-08-20 拆分 Dockerfile：server 与 vision-proxy 独立构建

关联计划：`docs/plans/2026-08-20-split-dockerfile-server-vision-proxy-plan.md`

## 实施摘要

- 删除单一多 target `packages/docker/Dockerfile`；新增两个相互独立的 Dockerfile：
  - `packages/docker/Dockerfile.server`（builder + server 两阶段，Node + 前端 + FFmpeg + tini），移除镜像内 `ENV QWEN_VISION_PROXY_URL=...` 硬编码默认。
  - `packages/docker/Dockerfile.vision-proxy`（python-builder + vision-proxy 两阶段，Python venv 视觉代理 + tini）。
  - 两文件各自自包含、构建互不共享、无跨文件 `COPY --from`。
- `docker-compose.yml`：两个 service 的 `build.dockerfile` 指向两个新文件、删除 `build.target`；`image` 改为 `bilibili-downloader-server` / `bilibili-downloader-vision-proxy`。
- `packages/docker/package.json` 新增 `docker:build:server` / `docker:build:vision-proxy` 独立构建命令；`docker:build`（compose build）保留。
- 根 `package.json`：`docker:save server` / `docker:save vision-proxy` 键名与镜像名更新为新命名。
- `.env.example` 补充 `QWEN_VISION_PROXY_URL` 说明（可完全自定义，默认 compose 网络内服务名）。

## 关键决策落地

- URL 配置仅环境变量：Node 已读 `process.env.QWEN_VISION_PROXY_URL`，镜像不再硬编码默认，运行期完全自定义。
- 镜像独立命名 `bilibili-downloader-server` / `bilibili-downloader-vision-proxy`，不再共用 repository 名 + tag。
- 两个 Dockerfile 置于 `packages/docker/`，各自自包含（server 保留 `COPY packages/vision-proxy/package.json` 供 pnpm workspace `--frozen-lockfile` 解析，仅解析用途）。

## 验证结果

- `docker compose config` 通过（双 service、正确 dockerfile 路径、无 target、image 名正确）。
- `docker build -f Dockerfile.vision-proxy` 与 `docker build -f Dockerfile.server` 各自独立构建成功。
- 镜像职责检查：server 镜像无 venv/代理脚本且 `QWEN_VISION_PROXY_URL` 未设置；vision-proxy 镜像无 node/ffmpeg、有 `/app/python/qwen_vision_proxy.py` 与可导入 dashscope/dotenv 的 venv。
- `docker compose up -d` 双容器 healthy；server 容器内 `fetch('http://vision-proxy:8765/healthz')` 200 `{"status":"ok"}`；宿主 3000 返回 200；`docker port` 仅 3000；`docker compose down` 干净退出。
- `docker:save server` / `docker:save vision-proxy` 实测导出 `bilibili-downloader-server_linux-amd64.tar`（251MB）与 `bilibili-downloader-vision-proxy_linux-amd64.tar`（117MB）成功（测试产物已清理）。
- 自定义 URL：`QWEN_VISION_PROXY_URL` 设置为任意地址后容器内可读到该值。
- 无 TS 源码改动，`pnpm typecheck` / `pnpm build` 不受影响。

## 说明

- 测试方向详情见 `docs/testing/2026/08-20-split-dockerfile-server-vision-proxy-testing.md`。
- 旧镜像 `bilibili-downloader:latest` / `bilibili-downloader:vision-proxy` 为本次改动前历史构建残留，非本次产物，不影响新编排。