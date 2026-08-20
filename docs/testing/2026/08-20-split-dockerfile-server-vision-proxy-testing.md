# 2026-08-20 拆分 Dockerfile 测试记录

## 关联计划

`docs/plans/2026-08-20-split-dockerfile-server-vision-proxy-plan.md`

## 需求级观察方向

本文件描述拆分后应观察到的需求级状态与反状态，供计划验证与闭核算使用。

前置条件：本机具备 Docker Compose（v2+）。镜像实建需 Docker daemon 可用（当前 `docker version` 连接失败时，实建项转为人工执行并在本文件记录，不判定为通过）。

## 验证基线

- `docker compose config`（不依赖 daemon）：校验 compose 文件正确引用两个新 Dockerfile、镜像名正确、无 `build.target`、无旧命名残留。
- `pnpm typecheck` / `pnpm build`：本次无 TS 源码改动，作为不受影响的基线确认。
- daemon 可用时：`pnpm docker:build`（compose 构建两镜像）、`pnpm docker:build:server`、`pnpm docker:build:vision-proxy`。

## 应成立（positive states）

1. [x] `packages/docker/` 下存在 `Dockerfile.server` 与 `Dockerfile.vision-proxy` 两个独立 Dockerfile，各自自包含（各自含完整构建 stage），两文件之间无跨文件 `COPY --from` 引用；原多 target `Dockerfile` 已删除。
2. [x] server Dockerfile 内**不包含** `ENV QWEN_VISION_PROXY_URL=...` 硬编码默认值；vision-proxy Dockerfile 内仍保留 `QWEN_VISION_PROXY_HOST` / `QWEN_VISION_PROXY_PORT` / `LOG_DIR` 默认。
3. [x] `docker compose config` 通过：`vision-proxy` 与 `server` 两个 service 的 `build.dockerfile` 分别指向两个新文件，无 `build.target`；`image` 分别为 `bilibili-downloader-vision-proxy` 与 `bilibili-downloader-server`；`server` 依赖 `vision-proxy` 健康后启动；8765 不发布宿主机端口。
4. [x] 根 `package.json` 的 `docker:save server` 与 `docker:save vision-proxy` 命令分别导出 `bilibili-downloader-server` 与 `bilibili-downloader-vision-proxy` 镜像到 `dist/docker/bilibili-downloader-{server,vision-proxy}_linux-amd64.tar`。
5. [x] `packages/docker/package.json` 新增 `docker:build:server` 与 `docker:build:vision-proxy` 独立构建命令；`docker:build`（compose build）保留。
6. [x] daemon 可用时：`pnpm docker:build` 构建出 `bilibili-downloader-server` 与 `bilibili-downloader-vision-proxy` 两个镜像（两个 Image Built）。
7. [x] daemon 可用时：镜像职责分离——server 镜像内无 Python/venv/代理脚本、无 `QWEN_VISION_PROXY_URL` 默认；vision-proxy 镜像内有 `/app/python/qwen_vision_proxy.py` 与可导入 dashscope/dotenv 的 venv、无 node/npm 可执行。
8. [x] 运行冒烟（daemon 可用时）：server 容器内 `node -e fetch('http://vision-proxy:8765/healthz')` 200；宿主 3000 可访问前端与 Node API；`docker port` 仅列出 3000；`docker compose down` 干净退出。
9. [x] 自定义 URL：compose 中设置 `QWEN_VISION_PROXY_URL` 为任意自定义地址后，server 运行期读取该值（可从日志/错误信息观测）；不设置时多模态调用给出明确配置错误（`qwen-client.ts` 既有行为）。

## 不应成立（negative states）

1. [x] 仓库中不再出现旧命名残留：`bilibili-downloader:vision-proxy`（旧 server+tag 镜像名）、`packages/docker/Dockerfile` + `build.target` 引用（活动文档与配置均不出现；历史 plan/log 中的历史描述除外）。
2. [x] server 镜像不再假定代理位于 compose 服务名 `vision-proxy`（无镜像内硬编码 URL 默认）。
3. [x] 不存在"两个镜像共享构建 stage 或跨文件 COPY --from"的耦合形态。

## 记录

- 配置校验与命令核对：`docker compose config` 结果、`package.json` diff 结果。
- 镜像构建：daemon 可用时的 `pnpm docker:build` / `docker:build:server` / `docker:build:vision-proxy` 输出（Image Built / exit 0）。
- 镜像职责：`docker run --entrypoint` 检查结果。
- 运行冒烟：healthz / 端口 / down 结果。
- 自定义 URL：日志/错误观测结果。

## 环境与执行记录

- Docker daemon 初始未运行（`docker version` 连接失败），实施时已启动 Docker Desktop（daemon 29.7.2）；镜像实建、镜像职责检查、运行冒烟、`docker:save` 导出与自定义 URL 均在真实 daemon 下完成。
- `docker compose config` 通过；`docker build -f Dockerfile.vision-proxy` 与 `-f Dockerfile.server` 各自独立构建成功；`docker compose up -d` 双容器 healthy，server 容器内 `fetch('http://vision-proxy:8765/healthz')` 200，宿主 3000 返回 200，`docker port` 仅 3000，`docker compose down` 干净退出。
- server 镜像无 venv/代理脚本且 `QWEN_VISION_PROXY_URL` 未设置；vision-proxy 镜像无 node/ffmpeg、有代理脚本与可导入 dashscope/dotenv 的 venv。
- `docker:save server` / `docker:save vision-proxy` 实测导出两个 tar（测试产物已清理）。
- 自定义 URL：`QWEN_VISION_PROXY_URL` 设为任意地址后容器内可读。
