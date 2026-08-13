# 2026-08-13 Docker 镜像修复并纳入 Python 视觉代理

> Plan Status: completed
> Last Reviewed: 2026-08-13
> Source: 用户需求——(1) 修复 `docker:build` 既有问题并纳入 Python 视觉代理；(2) 2026-08-13 追加要求优化系统/Python 依赖安装耗时，切换 Debian slim 基础镜像并更换国内依赖源
> Related: `docs/plans/2026-08-13-production-file-logging-plan.md`（已关闭，引入 LOG_DIR/LOG_MAX_FILES）、`docs/plans/2026-08-12-vision-proxy-robustness-plan.md`、`docs/plans/2026-08-11-vision-proxy-python-best-practice.md`
> Audit: required（独立 subagent；reviewer availability = none）
> Protected area: `deployment`（ask-first）——本计划改动 `packages/docker/Dockerfile` 与启动编排。用户已明确授权修复 Dockerfile 并纳入 Python 服务。owner doc 对齐见 Phase 5（`docs/design/app-overview.md` + `docs/architecture/system-baseline.md`）。
> Testing: `docs/testing/2026/08-13-docker-fix-vision-proxy-testing.md`

## Current Baseline

- 当前实现已把 Node、前端、FFmpeg 和 Python 视觉代理纳入 `node:24-alpine` 单镜像，但最终镜像尚未成功构建和运行验证。
- Alpine 方案需安装 `python3 make g++` 并在 runtime 生产闭包内再次源码编译 `better-sqlite3`；runtime 还安装 `py3-pip` 并联网安装 Python 依赖，构建耗时和失败面较大。
- `apk add ffmpeg python3 py3-pip` 在当前网络环境耗时极长；Docker Hub、Alpine、npm 与 PyPI 是相互独立的网络路径，仅配置 Docker Hub mirror 不能解决全部问题。
- Python 依赖：`packages/server/python/pyproject.toml` 锁定 `dashscope==1.26.6`、`python-dotenv==1.2.2`。
- 技术验证（已实测）：`node:22-alpine` + `apk add python3 py3-pip ffmpeg` 得到 Python 3.14.7 + pip；dashscope/python-dotenv 在 alpine 安装成功；`qwen_vision_proxy.py` 在容器内运行正常，healthz 200。

## Goals

- 修复 `docker:build`，使其在干净环境可成功构建镜像。
- 将 Python 视觉代理纳入镜像：容器内同时运行 Node 服务（容器内 `PORT=3000`，`docker:run` 映射宿主 3000）与 Python 视觉代理（127.0.0.1:8765），Node 经 `QWEN_VISION_PROXY_URL` 走本地代理。
- 基础镜像切换为 `node:24-bookworm-slim`，利用 glibc 生态降低 native module 和 Python wheel 的构建成本。
- Python 依赖在独立 builder venv 中安装，runtime 只安装 `python3`、`ffmpeg`、`tini` 并复制 venv，不携带 pip 和编译工具链。
- APT、pnpm、pip 使用可覆盖的国内镜像参数；默认值分别为清华 Debian 主机前缀、npmmirror、清华 PyPI，调用方可置空回退官方源。普通 build arg 禁止携带账号、密码或 token。
- 继续使用 BuildKit pnpm/pip 缓存，并通过 `pnpm deploy --prod` 只携带 server 生产依赖闭包。
- 保持现有接口/行为不变：`docker:build`、`docker:run` 命令不变；环境变量（`QWEN_VISION_PROXY_*`、`LOG_DIR`、`OUTPUT_DIR` 等）语义不变；Node 服务对外行为不变。
- 容器内两个服务日志：Node 走 `LOG_DIR` 文件日志（`/download/logs/server-*.log`）；Python 代理 stderr + `LOG_DIR` 文件日志（`/download/logs/vision-proxy.log`）。

## Non-Goals

- 不改变 Python 代理代码逻辑（`qwen_vision_proxy.py` 不改）；仅确保其在容器内可运行。
- 不改 `scripts/setup-vision-proxy.mjs` / `scripts/start-vision-proxy.mjs` 的宿主行为（容器内用独立编排，不复用这两脚本，避免引入 Node 依赖做进程守护）。
- 不引入 pm2/supervisor；仅使用 `tini` 作为 PID 1 负责信号转发和僵尸进程回收，业务进程仍由轻量 shell 编排。
- 不把代理地址、账号密码或私有仓库凭据写入镜像。
- `.dockerignore` 已排除任意层级 `.env`，避免服务端密钥进入构建上下文与镜像。

## Infrastructure And Config Prereqs

- 无新增应用 npm/Python 依赖（dashscope/python-dotenv 已在 pyproject.toml 锁定）；runtime 新增 Debian 系统包 `tini`。
- 构建参数：`APT_MIRROR`、`NPM_REGISTRY`、`PIP_INDEX_URL` 均可覆盖，不设置为运行时 `ENV`。默认 `APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn`，避免 slim 基础镜像首次安装 `ca-certificates` 前形成 HTTPS 证书依赖死锁；APT 仍通过 Debian Release 签名验证仓库内容。仅替换官方 deb822 `URIs` 中的 `http(s)://deb.debian.org` 主机前缀，保留 `/debian`、`/debian-security`、Suites、Components 与 Signed-By；空值完整保留官方源。普通 build arg 不支持私有源凭据。
- 环境变量：容器内 `QWEN_VISION_PROXY_URL` 需指向容器内 `http://127.0.0.1:8765/v1/chat/completions`（与宿主约定一致）；`QWEN_VISION_PROXY_HOST=127.0.0.1`、`QWEN_VISION_PROXY_PORT=8765`。

## Execution Plan

### Phase 1 - 切换 Debian slim 与构建源

Status: completed
Targets: `packages/docker/Dockerfile`

- [x] `Fix`: builder、Python builder、runtime 固定使用 `node:24.16.0-bookworm-slim`；不保留任意 `NODE_IMAGE` 覆盖。
- [x] `Add`: `APT_MIRROR` 可选替换 Debian 官方源主机前缀；`NPM_REGISTRY` /
  `PIP_INDEX_URL` 在命令行显式选择源，空值不传源参数。
- [x] `Fix`: Node builder 安装 native 编译工具，APT 使用 `--no-install-recommends` 和 BuildKit cache mount。
- [x] `Fix`: `better-sqlite3` 在 builder deploy 闭包执行 install 并实际运行内存 SQL；runtime 不承担编译。
- [x] `Add`: workspace manifest 在源码之前复制，保留 pnpm 依赖层缓存。
- [x] `Add`: BuildKit cache mount 缓存 pnpm store，源码复制后使用 offline install。
- [x] `Fix`: `.dockerignore` 排除本地下载、总结截图、测试素材和 `.env`。
- [x] `Proof`: 用户手动真实 Docker 构建成功；Node/前端构建和 runtime SQLite smoke 通过。

### Phase 2 - 生成最小 Node/Python runtime

Status: completed
Targets: `packages/docker/Dockerfile`

- [x] `Add`: `pnpm deploy --prod --legacy --ignore-scripts` 生成 server 生产闭包；runtime 仅复制该闭包与前端 dist。
- [x] `Add`: 独立 Python builder 创建 `/opt/vision-venv`，按 pyproject 安装依赖，import smoke 后移除 pip/setuptools/wheel。
- [x] `Add`: runtime 仅安装 `ffmpeg python3 tini ca-certificates`，不安装 `python3-pip`、make、g++。
- [x] `Proof`: runtime 中 pip、make、g++ 及 TypeScript/Vite/Nest CLI 不存在；FFmpeg/ffprobe 与 Python imports 通过。
- [x] `Proof`: venv Python 导入 `dashscope`、`dotenv` 通过，`sys.executable` 指向 `/opt/vision-venv/bin/python`。

### Phase 3 - 容器内 Node + Python 同时启动编排

Status: completed
Targets: `packages/docker/entrypoint.sh`（新增）、`packages/docker/Dockerfile`

- [x] `Add`: entrypoint 保存 Python/Node PID，等待 Node，退出时清理并等待两个子进程。
- [x] `Add`: `tini` 作为 PID 1 执行 `/app/entrypoint.sh`。
- [x] `Fix`: 代理使用 `/opt/vision-venv/bin/python`。
- [x] `Fix`: entrypoint 不依赖 `set -e`，cleanup 只执行一次并分别 wait；Node 退出码为最终退出码。
- [x] `Decision`: 启动编排方式记录于 Decision 节。
- [x] `Proof`: 进程树、Node 3000、Python healthz、venv executable 和停止清理均通过；`docker stop` 0.44 秒退出，退出码 143 已裁定。

### Phase 4 - 环境变量与默认配置对齐

Status: completed
Targets: `packages/docker/Dockerfile`, `docs/architecture/2026-07-06-video-analysis-baseline.md`

- [x] `Add`: Dockerfile `ENV` 对齐容器内代理地址与回环监听。
- [x] `Add`: 镜像不写入 `DASHSCOPE_API_KEY`；无 key POST 返回明确 500，healthz 保持 200。
- [x] `Proof`: runtime env 中 Node 视觉代理 URL 指向容器内代理。

### Phase 5 - 文档对齐

Status: completed
Targets: `docs/design/app-overview.md`, `docs/architecture/system-baseline.md`, `docs/context/codebase-map.md`, `docs/architecture/2026-07-06-video-analysis-baseline.md`, `docs/logs/2026/08-13-docker-fix-vision-proxy.md`, `docs/testing/2026/08-13-docker-fix-vision-proxy-testing.md`

- [x] `Add`: `docs/design/app-overview.md` Docker surface 已对齐。
- [x] `Add`: `docs/architecture/system-baseline.md` 已对齐 Debian slim 双服务部署。
- [x] `Add`: `docs/context/codebase-map.md` Docker 行已对齐。
- [x] `Add`: `docs/architecture/2026-07-06-video-analysis-baseline.md` 已对齐容器代理表述。
- [x] `Add`: testing 与本日志已更新。
- [x] `Add`: `docs/bugs/2026-08-13-docker-runtime-better-sqlite3-binding.md`。
- [x] `Add`: `docs/bugs/2026-08-13-docker-build-context-local-data.md`。

## Exit Criteria

- [x] 真实 Docker 构建成功，默认国内 APT/pnpm/pip 源生效；空值回退路径经实现审查，未额外执行三次完整构建。
- [x] manifest-first 与 BuildKit cache 结构落地；runtime 不含开发依赖。
- [x] Docker HEALTHCHECK 同时确认 Node 和 Python `/healthz`，状态 healthy。
- [x] Node、前端、Python 代理和容器内 URL 均实测可用。
- [x] `docker:build`、`docker:run` 脚本保持不变；build args 可覆盖依赖源。
- [x] history/inspect/runtime env 无源凭据，未残留 npm/pip 源配置。
- [x] `/download/logs` 生成 Node 和 Python 双日志。
- [x] `pnpm typecheck`、`pnpm build` 通过，宿主脚本未改动。
- [x] owner docs、codebase map、video analysis baseline、bugs、logs 对齐。
- [x] testing 所有方向已确认或明确裁定。

## Plan Audit

- Status: passed
- Reviewer / Agent: 独立 subagent（reviewer availability = none）
- Evidence: 原 Alpine 计划 task `ses_00574f009ffeG6Vfm8u1us5GQB` 已通过；Debian/source
  修订由 `General_7615543` 三轮独立复核（`needs revision` → 修订 B1/B2/M1-M4 →
  `approved`）。实施后由 `General_7615723` 只读检查 Dockerfile/entrypoint，未发现
  blocker/major。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（真实 Docker 构建、容器启动与停止冒烟）
- [x] testing 文档所有方向已确认 passed 或明确裁定
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan exception not applicable（涉部署、多文件、跨 Node/Python，full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（`General_7616130` 首轮 FAIL 指出日志路径错误，修复后复核 PASS）
- [x] closure evidence exists in testing、log、owner docs、bugs 与本计划

## Decision

### 启动编排方式

- 选择：`tini` 作为 PID 1，执行 `packages/docker/entrypoint.sh`；shell 后台启动 Python 与 Node、等待 Node，并在停止或 Node 退出时终止且等待两个子进程。
- 备选：(a) 复用 `start-vision-proxy.mjs`（带自动重启）——需在容器内跑 Node 脚本守护 Python，复杂度高；(b) 改 Node `main.ts` 内 spawn Python——把进程编排耦合进应用代码，不干净；(c) pm2/supervisor——引入额外进程管理器，镜像变大。
- 残余风险：容器内 Python 代理崩溃无自动重启（依赖容器重启或手动）；视频分析为可选能力，代理不可用时 Node 侧已有错误处理与重试。若后续需要自动重启，可再引入守护。

### 基础镜像选择

- 选择：使用 `node:24-bookworm-slim`，与根 `package.json` Node 24 基线一致。当前镜像同时包含 FFmpeg、Python 和 `better-sqlite3`，glibc 兼容性与构建稳定性的收益优先于 Alpine 基础层的体积优势。
- Node tag：固定使用 `node:24.16.0-bookworm-slim`，与根 `engines`/Volta 精确一致；正式发布时记录实际 image digest，后续再引入 digest 自动更新流程。
- 备选：继续 `node:24-alpine` 并优化 apk/pip 缓存；因 native 编译复杂度、apk 下载耗时和 runtime pip 安装问题不采用。
- 残余风险：Debian 最终镜像可能略大；以真实冷/热构建耗时、最终体积和运行冒烟结果裁定。

## Deferred But Adjudicated

### 容器内 Python 代理自动重启守护

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 视觉代理为可选能力；Node 侧已有失败处理；当前最小编排满足"纳入镜像"诉求。
- Successor Required: `yes`（触发条件：容器内代理崩溃导致实际用户不可用反馈）

## Closure

Status Note: Debian slim 镜像已真实构建，全部既定运行方向通过或明确裁定；独立
closure audit 首轮仅发现 Phase 5 日志路径不一致，修复后复核 PASS，计划可以关闭。

Closure Audit Evidence:

- Reviewer / Agent: `General_7616130`
- Evidence: 冷启动复核 live diff、Dockerfile、entrypoint、testing、log、owner docs、
  bugs 和本地镜像信息；首轮 FAIL 的唯一 Major 为 Phase 5 误引用
  `docs/logs/2026/08-13.md`，修正为
  `docs/logs/2026/08-13-docker-fix-vision-proxy.md` 后复核 PASS。
- Accepted adjudications: 默认国内源真实构建，三个空值官方源分支仅实现审查；停止
  0.44 秒、无 OOM/强杀且退出码 143 符合保留 Node SIGTERM 的设计；非 root 运行作为
  后续安全加固，不属于本计划原始范围；镜像大小差异为 Docker Desktop/containerd
  统计口径差异。

Follow-up:

- 可选：单独规划非 root 运行与 NAS UID/GID 映射。
- 可选：在 CI 增加官方源空值构建、重复热构建计时和 amd64/arm64 矩阵。
