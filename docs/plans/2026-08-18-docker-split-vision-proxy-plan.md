# 2026-08-18 Docker 拆分 Python 视觉代理为独立容器

> Plan Status: completed
> Last Reviewed: 2026-08-18
> Source: 用户需求——将 Python 视觉代理从单容器拆分为独立容器，实现两服务各自的崩溃自动重启；前端保持与 server 同容器。
> Related: `docs/plans/2026-08-13-docker-fix-vision-proxy-plan.md`（单容器基线来源）
> Audit: required（独立 subagent；reviewer availability = none，受保护区域 deployment 需 subagent/human 复核）
> Protected area: `deployment`（ask-first）——改动 `packages/docker/Dockerfile`、启动编排与新增 compose。用户已在会话中明确授权。
> Testing: `docs/testing/2026/08-18-docker-split-vision-proxy-testing.md`

## Current Baseline

- 当前是单镜像 `bilibili-downloader`：`packages/docker/Dockerfile` 三阶段（builder / python-builder / runtime），runtime 同时运行 Node 服务（`/app/dist/main.js`，端口 3000）与 Python 视觉代理（`/opt/vision-venv/bin/python /app/python/qwen_vision_proxy.py`，127.0.0.1:8765）。
- `packages/docker/entrypoint.sh` 用 shell 后台启动 Python 与 Node、等待 Node，Node 退出或容器停止时清理两个子进程；`tini` 为 PID 1。
- 容器级 HEALTHCHECK 同时探测 Node 3000 与 Python 8765 `/healthz`；health 状态不触发 Docker 内置重启策略（`--restart` 只在容器退出时生效）。
- 已知弱点：Python 进程崩溃后无人拉起，Node 不受影响继续运行，但代理长期挂死；只有 Node 崩溃时整个容器退出触发重启。`system-baseline.md`/`app-overview.md`/`video-analysis-baseline.md`/`codebase-map.md` 均描述单容器形态。
- 运行时命令：`packages/docker/package.json` 的 `docker:build`（`docker build -f ./Dockerfile -t bilibili-downloader ../..`）与 `docker:run`（`cross-var docker run -d -p 3000:3000 -v "$HOME/Downloads/bilibili_download:/download" bilibili-downloader`）。当前 `docker:run` **没有** `--restart` 参数：Node 崩溃退出后容器不会自动拉起重启。
- 本机 HOME 环境变量为空（仅有 `USERPROFILE=C:\Users\Admin`），现有 `docker:run` 依赖 `cross-var` 解析跨平台 `$HOME`；切换到 compose 后需处理该默认路径解析。
- 架构不变量（`docs/architecture/2026-07-06-video-analysis-baseline.md:95`）：Python 代理与 Node 需共享同一文件系统，否则无法读取 Node 生成的本地截图（file:// 输入）。
- 本机环境：Docker 29.7.2 + Docker Compose v5.3.1 可用；仅存在旧镜像 `bilibili-downloader:latest`，`node:24.16.0-bookworm-slim` 基础层大概率已有 BuildKit 缓存。

## Goals

- 用 docker compose 将 Python 视觉代理拆为独立容器：`server`（Node + 前端静态 + FFmpeg + tini）与 `vision-proxy`（venv Python + 代理脚本 + tini）。
- 两个容器各自独立重启：任一容器主进程崩溃退出后由 Docker `restart: unless-stopped` 单独拉起，不影响健康容器；Python 崩溃不再长期挂死（现有 `docker:run` 无任何重启策略，崩溃后靠人工或本拆分新增的策略恢复）。
- 保持对外契约不变：仅暴露宿主 3000 端口；下载目录与日志目录保持共享 volume 挂载；`QWEN_VISION_PROXY_*`、`LOG_DIR`、`OUTPUT_DIR`、`MAX_CONCURRENT_DOWNLOADS` 语义不变；`pnpm docker:build` / `pnpm docker:run` 命令名不变（内部改用 compose）。
- server 镜像不再携带 Python/venv/代理脚本；vision-proxy 镜像不携带可运行的 Node/FFmpeg/前端产物，两镜像职责单一。
- 容器内网络：Node 经 compose 服务名 `http://vision-proxy:8765` 访问代理；8765 不发布到宿主机。

## Non-Goals

- 不引入 pm2/supervisor/s6-overlay 等容器内进程守护（崩溃隔离由 Docker restart 策略承担）。
- 不改 `qwen_vision_proxy.py` 代码逻辑；不改宿主开发模式脚本 `setup-vision-proxy.mjs` / `start-vision-proxy.mjs`。
- 不拆分前端容器、不引入 nginx 入口。
- 不做"进程存活但挂死"的 health-触发式重启（Docker 内置策略不支持；代理已有 socket 超时与并发上限缓解）。
- 不做水平扩容/HA、不改 API/DB/auth；不维护单容器 all-in-one 运行时形态。

## Infrastructure And Config Prereqs

- 需要 Docker 支持 `docker compose`（v2+，本机 v5.3.1 满足）与多 target Dockerfile 构建。
- compose 从宿主环境或 `packages/docker/.env`（`.gitignore` 已忽略任意层级 `.env`）注入 `DASHSCOPE_API_KEY` / `DASHSCOPE_BASE_HTTP_API_URL` 到 vision-proxy 容器；不写入镜像。
- 共享 volume：两个容器挂载同一宿主机目录到 `/download`（默认 `${DOWNLOAD_HOST_PATH:-${HOME:-$USERPROFILE}/Downloads/bilibili_download}`，Windows 宿主 HOME 为空时经 `USERPROFILE` 回退；可用 `DOWNLOAD_HOST_PATH` 显式覆盖，构建验证时确认本机解析正确）。
- 容器内环境变更（行为相关，需在文档对齐）：vision-proxy 容器监听 `0.0.0.0:8765`（跨容器可达，不发布宿主机端口）；server 容器 `QWEN_VISION_PROXY_URL` 默认改为 `http://vision-proxy:8765/v1/chat/completions`。
- compose 构建沿用现有 `.dockerignore` 与 Dockerfile 默认构建参数：build context 指向仓库根 `../..`，dockerfile `packages/docker/Dockerfile`，target 分 `server`/`vision-proxy`；不传 build args 时沿用 Dockerfile 内 `APT_MIRROR`/`NPM_REGISTRY`/`PIP_INDEX_URL` 默认值。
- 新增应用依赖：无（Python 依赖仍由 python-builder 阶段按 pyproject 安装）。

## Execution Plan

### Phase 1 - Dockerfile 多 target 拆分与裁剪

Status: completed
Targets: `packages/docker/Dockerfile`, `packages/docker/entrypoint.sh`（移除）

- [x] `Decision`: 使用多 target Dockerfile（`builder` / `python-builder` / `server` / `vision-proxy`）+ compose 构建两个镜像，复用同一份 APT 镜像与依赖安装逻辑。备选：(a) 两个独立 Dockerfile——复制镜像源/构建逻辑，维护面更大；(b) 单容器加 supervisor——不满足"独立崩溃隔离"诉求；(c) 继续单容器 + 重启循环——无法隔离 Node 崩溃与代理崩溃。选 (a) 多 target 单一 Dockerfile，残余风险：单文件复杂度略升，BuildKit 缓存按 target 共享。
- [x] `Fix`: server 阶段 apt 只保留 `ca-certificates ffmpeg tini`（移除 `python3`）；删除 venv 复制、`qwen_vision_proxy.py` 复制与 `/opt/vision-venv/bin` 的 PATH 注入。
- [x] `Fix`: server 阶段 ENV 移除 `QWEN_VISION_PROXY_HOST` / `QWEN_VISION_PROXY_PORT`；`QWEN_VISION_PROXY_URL` 默认改为 `http://vision-proxy:8765/v1/chat/completions`；HEALTHCHECK 只探测自身 PORT。
- [x] `Fix`: server 阶段移除 entrypoint 编排，`CMD ["node", "/app/dist/main.js"]`（仍由 tini 作 PID 1）；删除 `packages/docker/entrypoint.sh`。
- [x] `Add`: `vision-proxy` 阶段基于 `node:24.16.0-bookworm-slim`（与 python-builder 同 apt python3 基底，保证 `--copies` venv 二进制与 libpython 兼容），apt 装 `ca-certificates python3 tini`；从 python-builder 复制 `/opt/vision-venv`，复制 `qwen_vision_proxy.py`；**显式删除 Node 工具链**（`/usr/local/bin` 下 node/npm/npx/corepack/yarn 及 `/usr/local/lib/node_modules` 等），使镜像内无可运行 node/npm；ENV 默认 `QWEN_VISION_PROXY_HOST=0.0.0.0`、`QWEN_VISION_PROXY_PORT=8765`、`LOG_DIR=/download/logs`；HEALTHCHECK 用 stdlib urllib 探 `/healthz`；`CMD ["/opt/vision-venv/bin/python", "/app/python/qwen_vision_proxy.py"]`（tini 作 PID 1）。镜像基础层体积仍占用（层删除语义），但功能性 Node 组件已剔除。`Decision` 详见 Decision 节。
- [x] `Proof`: `docker build --target server` 与 `--target vision-proxy` 均构建成功；inspect/运行验证 server 无 python/venv/代理脚本、vision-proxy 内 `command -v node`/`command -v ffmpeg`/`/app/public` 均不存在。

### Phase 2 - Compose 编排与脚本

Status: completed
Targets: `packages/docker/docker-compose.yml`（新增）、`packages/docker/.env.example`（新增）、`packages/docker/package.json`

- [x] `Add`: `docker-compose.yml` 定义 `server` 与 `vision-proxy` 两个 service：同一 compose 网络、各自 `build.target`、`restart: unless-stopped`、共享 `/download` volume、`server.depends_on.vision-proxy.condition=service_healthy`、各自 healthcheck、8765 不发布宿主机端口。
- [x] `Add`: 环境变量桥接（compose interpolation，未设则留空/默认）：`DASHSCOPE_API_KEY`（代理同时接受 `DASH_SCOPE_API_KEY` 回退变量）、`DASHSCOPE_BASE_HTTP_API_URL`、`QWEN_VISION_PROXY_MAX_BODY_BYTES`、`QWEN_VISION_PROXY_MAX_CONCURRENCY`、`QWEN_VISION_PROXY_SOCKET_TIMEOUT`、`QWEN_VISION_PROXY_TIMEOUT_MS`、`LOG_DIR`、`LOG_MAX_FILES`、`MAX_CONCURRENT_DOWNLOADS`、`DOWNLOAD_HOST_PATH`。
- [x] `Add`: `.env.example` 说明上述变量（含「放在 `packages/docker/.env`，已被 .gitignore 忽略」；Windows 宿主说明 `DOWNLOAD_HOST_PATH` 与 `USERPROFILE` 回退行为；8765 不要发布到宿主机）。
- [x] `Fix`: `packages/docker/package.json` 的 `docker:build` → `docker compose build`、`docker:run` → `docker compose up -d`。
- [x] `Proof`: `docker compose config` 校验通过（含本机 Windows 下 volume 默认路径正确解析）；`pnpm docker:build` 构建出 `bilibili-downloader` 与 `bilibili-downloader:vision-proxy` 两个镜像；`pnpm docker:run` 正常拉起。

### Phase 3 - 文档对齐

Status: completed
Targets: `docs/architecture/system-baseline.md`, `docs/design/app-overview.md`, `docs/context/codebase-map.md`, `docs/architecture/2026-07-06-video-analysis-baseline.md`, `docs/context/project-context.md`, `docs/discussions/2026-08-18-docker-split-scope.md`（新增，记录拆分范围决策），新增 `docs/testing/2026/08-18-*.md` 与 `docs/logs/2026/08-18-*.md`

- [x] `Add`: `docs/discussions/2026-08-18-docker-split-scope.md` 记录用户拆分诉求、前端与 server 同容器决策、仅拆 Python 代理的取舍依据。
- [x] `Add`: `system-baseline.md` 的 Build tools / Deployment Shape 对齐双容器（server 容器无 Python；proxy 容器内部 0.0.0.0 监听不发布端口；共享下载/日志 volume）。`Rule: No owner-doc update beyond listed files`。
- [x] `Add`: `app-overview.md` Docker 表面行对齐双容器。
- [x] `Add`: `codebase-map.md` Docker 行与 Vision Proxy 行对齐。
- [x] `Add`: `video-analysis-baseline.md` 运行形态与环境变量段对齐：容器模式下代理监听 `0.0.0.0`、经 compose 网络服务名访问、共享 `/download` 文件系统不变量；宿主开发模式 `127.0.0.1` 不变。
- [x] `Add`: `project-context.md` Active plan 指向本计划。
- [x] `Proof`: 文档与最终 compose/Dockerfile/实测行为一致（一致性复查不复述为已通过）。

### Phase 4 - 运行时验证

Status: completed
Targets: 真实容器运行与崩溃恢复验证

- [x] `Proof`: 容器健康后，server 容器内 `node -e fetch('http://vision-proxy:8765/healthz')` 200；宿主 3000 可访问前端与 Node API；`docker port` 仅 3000。
- [x] `Proof`: 手动 kill vision-proxy 容器主进程 → 该容器被 Docker 自动重启并恢复 healthy；server 容器不受影响。
- [x] `Proof`: 手动 kill server 容器主进程 → 仅 server 容器重启恢复，vision-proxy 不受影响。
- [x] `Proof`: 运行期间 `/download/logs` 同时生成 server 与 vision-proxy 日志；`docker compose down` 优雅停止。

## Exit Criteria

- [x] server 与 vision-proxy 两镜像独立构建成功，各自不含对端运行组件（server 无 python，proxy 无 node/ffmpeg/前端产物）。
- [x] `docker compose config` 通过；`pnpm docker:build`（compose build）与 `pnpm docker:run`（compose up -d）命令名不变且可用。
- [x] 仅宿主 3000 暴露；8765 仅在 compose 网络内可达；server 经 `vision-proxy` 服务名拿到 `/healthz` 200。
- [x] 任一容器主进程被 kill 后仅该容器被 Docker 自动重启并恢复 healthy。
- [x] 共享 volume 中下载与双日志正常；compose down 优雅退出。
- [x] 相关 owner docs、codebase map、testing、log 对齐且一致。
- [x] `pnpm typecheck` 通过。

## Plan Audit

- Status: passed
- Reviewer / Agent: 独立 subagent（两轮）
- Evidence: 首轮 task `ses_fef7584efffeb0YlEvaww3Ir4y` 返回 needs revision（Node-in-proxy 矛盾、HOME 路径、env 名等 7 项）；修订后第二轮 task `ses_fef6f15a3ffendcRr25ljCE9lE` 逐一复核全部 7 项已解决、无新增矛盾，VERDICT approved。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（compose 构建、容器运行、双容器各自崩溃重启、日志与优雅停止）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan exception not applicable（涉 deployment、多文件、多模块，full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（subagent 或 human）
- [x] closure evidence exists in files

## Decision

### 拆分机制

- 选择：多 target Dockerfile（server / vision-proxy 两个命名 stage）+ docker compose 编排两个 service，复用镜像源与构建逻辑。
- 备选：(a) 两个独立 Dockerfile——镜像源/依赖安装逻辑重复，维护成本高；(b) 单容器 + pm2/supervisor——进程崩溃可靠拉起但无法实现容器级独立隔离与资源边界；(c) 单容器 + 重启循环脚本——Node 崩溃仍牵连代理，Python 挂死无兜底。
- 残余风险：单 Dockerfile target 增多，构建器需支持 `--target`；BuildKit 按阶段共享缓存，改动一个阶段可能引发后续阶段重建。

### 代理容器监听地址

- 选择：容器内 `QWEN_VISION_PROXY_HOST=0.0.0.0`。跨容器网络命名空间下 `127.0.0.1` 只能被代理容器自身访问，Node 容器无法到达；0.0.0.0 使代理在 compose 私有网络内可达，且不发布宿主机端口、不对外暴露。
- 备选：保持 127.0.0.1 并让 Node 反向代理——过度设计。
- 残余风险：若用户手动把 8765 发布到宿主机，0.0.0.0 监听会暴露代理端点；compose 默认不发布，.env.example 与文档注明不要映射该端口。

### server 容器移除 Python 与 entrypoint

- 选择：server 阶段删除 python3/venv/代理脚本，`entrypoint.sh` 删除，`CMD` 直接执行 node（tini 保留）。单进程容器不需要 shell 编排。
- 备选：保留 entrypoint 外壳——无收益，增加一层间接。
- 残余风险：无。日志目录由应用与代理各自负责创建。

### vision-proxy 基底与 Node 剔除

- 选择：vision-proxy 沿用 `node:24.16.0-bookworm-slim` 基底，apt 安装 `python3`（与 python-builder 内 `--copies` 创建的 venv 同源 apt python 3.11、同 glibc），并在阶段内显式删除 Node/npm/npx/corepack/yarn 工具链树，使镜像内无可运行 Node 组件；不携带 ffmpeg 与前端产物。
- 备选：(a) 切换 `python:3.11-slim-bookworm` 基底——官方镜像 python 为源码构建于 `/usr/local`，apt 版 venv 二进制链接的 libpython 在 `/usr/lib`，需额外符号/环境修正，二进制兼容风险高于收益；(b) 保留完整 node 基底——违反"不携带 Node"退出标准；(c) 放弃"无 Node"验收——弱化职责单一目标。
- 残余风险：Docker 层删除语义导致基础层体积仍占用（镜像不因删除而显著缩小）；"不含 Node"以功能可执行性为准（`command -v node` 无结果），不以层体积为准。该取舍已同步写入测试文档表述。

## Deferred But Adjudicated

### 代理"存活但挂死"的健康触发重启

- Classification: `watch-only residual`
- Why Not Blocking Closure: Docker 内置 restart 策略只在容器主进程退出时生效，对存活但无响应的进程不重启；代理已有 socket 读写超时、并发上限与 body 上限缓解挂死路径，且挂死场景无实际反馈。
- Successor Required: `yes`（触发条件：用户反馈代理虽 healthy 但分析请求长期无响应）

### 非 compose 的 server 镜像单独运行（docker run）

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: `docker:run` 已改为 compose 双容器；单独 `docker run` server 镜像的用户需自行启动代理或配置远端 `QWEN_VISION_PROXY_URL`。
- Successor Required: `no`

## Closure

Status Note: 双容器拆分已完整落地并通过真实构建与运行验证；全部 Plan Audit 已通过、执行项与 Exit Criteria 全绿；独立 closure audit 复核通过后计划关闭。

实施偏差记录：

- compose 中代理三个可调参数（`QWEN_VISION_PROXY_MAX_BODY_BYTES` / `MAX_CONCURRENCY` / `SOCKET_TIMEOUT`）原按 `:-` 空串注入，代理 `int()` 对空串报错导致启动失败（实测发现）；已在 compose 中改为与代码一致的默认值（`16777216` / `8` / `120`），未改代理代码，属于实现细节修正，不改变计划目标与测试方向。
- `docker kill`（宿主显式停止）不触发 restart 策略（Docker 官方行为），崩溃场景验证改用容器内 SIGKILL 主进程模拟真实崩溃，已在测试文档裁定说明。

Closure Audit Evidence:

- Reviewer / Agent: 独立 subagent（闭包复核，task `ses_fef5f2d3fffeUDR5PZTnb4HeVe`）
- Evidence: VERDICT approve closure；详细审计记录与计划审计留档见 `docs/audits/2026-08-18-closure-audit-docker-split-vision-proxy.md` 与 `docs/audits/2026-08-18-plan-audit-docker-split-vision-proxy.md`；冷却复核 live diff、Dockerfile、compose、testing、log、owner docs 与运行证据一致。审计附带的 4 个 minor 修复项已在本计划关闭前按审计建议落实。

Follow-up:

- 后续如需健康检查触发"存活但挂死"重启（docker autoheal 或 swarm/k8s），单独规划落地（触发条件见 Deferred 节）。