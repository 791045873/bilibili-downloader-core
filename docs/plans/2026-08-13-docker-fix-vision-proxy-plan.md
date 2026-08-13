# 2026-08-13 Docker 镜像修复并纳入 Python 视觉代理

> Plan Status: planned
> Last Reviewed: 2026-08-13
> Source: 用户需求——(1) 修复 `docker:build` 既有问题（builder 阶段 better-sqlite3 缺编译工具链）；(2) 现有 Dockerfile 只考虑了 Node 服务，需把 Python 视觉代理也纳入镜像
> Related: `docs/plans/2026-08-13-production-file-logging-plan.md`（已关闭，引入 LOG_DIR/LOG_MAX_FILES）、`docs/plans/2026-08-12-vision-proxy-robustness-plan.md`、`docs/plans/2026-08-11-vision-proxy-python-best-practice.md`
> Audit: required（独立 subagent；reviewer availability = none）
> Protected area: `deployment`（ask-first）——本计划改动 `packages/docker/Dockerfile` 与启动编排。用户已明确授权修复 Dockerfile 并纳入 Python 服务。owner doc 对齐见 Phase 5（`docs/design/app-overview.md` + `docs/architecture/system-baseline.md`）。
> Testing: `docs/testing/2026/08-13-docker-fix-vision-proxy-testing.md`

## Current Baseline

- `packages/docker/Dockerfile` 两阶段构建：builder 从 `node:22-alpine` 执行 `pnpm approve-builds --all` + `pnpm install --frozen-lockfile`；runtime 从 `node:22-alpine` 执行 `apk add --no-cache ffmpeg`，`CMD node packages/server/dist/main.js`。
- **既有问题 1（结构性，必现）**：`node:22-alpine` 无 python3/make/g++。`better-sqlite3` install 脚本 `prebuild-install || node-gyp rebuild --release`——Alpine 用 musl libc 无预编译二进制（`prebuild-install warn install aborted`），回退 `node-gyp rebuild` 时 `gyp ERR! find Python` → `pnpm install --frozen-lockfile` 失败。已实测复现。
- **既有问题 2（瞬时，已自愈）**：`apk add ffmpeg` 曾因 Alpine 源 TLS 瞬时错误失败；当前已恢复（实测成功）。
- Python 视觉代理当前**不进镜像**：`QWEN_VISION_PROXY_URL=http://127.0.0.1:8765/v1/chat/completions`，依赖镜像外独立进程（宿主/NAS 上经 `scripts/start-vision-proxy.mjs` + venv 运行）。因此当前镜像内视频分析无法走本地视觉代理。
- Python 依赖：`packages/server/python/pyproject.toml` 锁定 `dashscope==1.26.6`、`python-dotenv==1.2.2`。
- 技术验证（已实测）：`node:22-alpine` + `apk add python3 py3-pip ffmpeg` 得到 Python 3.14.7 + pip；dashscope/python-dotenv 在 alpine 安装成功；`qwen_vision_proxy.py` 在容器内运行正常，healthz 200。

## Goals

- 修复 `docker:build`，使其在干净环境可成功构建镜像。
- 将 Python 视觉代理纳入镜像：runtime 阶段安装 Python 依赖，容器内同时运行 Node 服务（容器内 `PORT=3000`，`docker:run` 映射宿主 3000）与 Python 视觉代理（127.0.0.1:8765），Node 经 `QWEN_VISION_PROXY_URL` 走本地代理。
- 优化镜像构建与运行时体积：依赖清单先于源码进入缓存层，使用 BuildKit pnpm/pip 下载缓存，并通过 `pnpm deploy --prod` 只携带 server 生产依赖闭包。
- 保持现有接口/行为不变：`docker:build`、`docker:run` 命令不变；环境变量（`QWEN_VISION_PROXY_*`、`LOG_DIR`、`OUTPUT_DIR` 等）语义不变；Node 服务对外行为不变。
- 容器内两个服务日志：Node 走 `LOG_DIR` 文件日志（`/download/logs/server-*.log`）；Python 代理 stderr + `LOG_DIR` 文件日志（`/download/logs/vision-proxy.log`）。

## Non-Goals

- 不改变 Python 代理代码逻辑（`qwen_vision_proxy.py` 不改）；仅确保其在容器内可运行。
- 不改 `scripts/setup-vision-proxy.mjs` / `scripts/start-vision-proxy.mjs` 的宿主行为（容器内用独立编排，不复用这两脚本，避免引入 Node 依赖做进程守护）。
- 不引入进程管理器（pm2/supervisor）——用轻量 shell 启动编排。
- 不切换到 bookworm-slim；Docker Node 基础镜像调整为与根 `package.json` engines 一致的 `node:24-alpine`，builder/runtime 保持相同 Node、架构与 libc。
- 不处理 `apk add ffmpeg` 的瞬时源问题（已自愈，非结构性）。
- 不处理 `.dockerignore` 未排除 `packages/server/.env` 的既有问题（`.env` 会被带入构建上下文；非本计划引入，另行记录到 bugs 或待办）。

## Infrastructure And Config Prereqs

- 无新增 npm/Python 依赖（dashscope/python-dotenv 已在 pyproject.toml 锁定）。
- 可能新增容器启动脚本（如 `packages/docker/entrypoint.sh`）负责同时启动 Node + Python。
- 环境变量：容器内 `QWEN_VISION_PROXY_URL` 需指向容器内 `http://127.0.0.1:8765/v1/chat/completions`（与宿主约定一致）；`QWEN_VISION_PROXY_HOST=127.0.0.1`、`QWEN_VISION_PROXY_PORT=8765`。

## Execution Plan

### Phase 1 - 修复 builder 阶段编译工具链与依赖缓存

Status: in progress
Targets: `packages/docker/Dockerfile`

- [ ] `Fix`: builder 阶段 `apk add --no-cache python3 make g++`，使 better-sqlite3 能在 Alpine 本地编译。
- [ ] `Add`: 所有 workspace 依赖 manifest 在源码之前复制，避免业务源码变动使 `pnpm install` 缓存失效。
- [ ] `Add`: 使用 BuildKit cache mount 缓存 pnpm store；依赖清单层执行正常 `pnpm install`，由于 Python 源码尚未复制，根 postinstall 不会创建 Python venv；better-sqlite3/esbuild 构建脚本只在依赖层执行一次。
- [ ] `Fix`: `.dockerignore` 排除本地下载文件、总结截图和测试素材，避免几十 MB 的非构建输入进入 Docker context。
- [ ] `Proof`: `docker build` builder 阶段 `pnpm install --frozen-lockfile` 通过。

### Phase 2 - 生成最小 Node runtime 并安装 Python 依赖

Status: in progress
Targets: `packages/docker/Dockerfile`

- [ ] `Add`: builder 完成构建后执行 `pnpm --filter @bilibili-downloader/server deploy --prod --legacy /app/runtime`，runtime 只复制 server 生产依赖闭包与前端 dist，不携带前端开发依赖和 workspace 源码。
- [ ] `Add`: runtime 阶段 `apk add --no-cache ffmpeg python3 py3-pip`。
- [ ] `Add`: `COPY packages/server/python /app/python`（含 pyproject.toml 与 qwen_vision_proxy.py），然后 `pip3 install --break-system-packages /app/python`（按 pyproject 安装）或直接 `pip3 install --break-system-packages dashscope==1.26.6 python-dotenv==1.2.2`。注意：代理内 `SERVER_DIR = Path(__file__).resolve().parents[1]`（`qwen_vision_proxy.py:70`），`load_dotenv(SERVER_DIR / ".env")` 会尝试读 `/app/.env`，缺失时静默忽略（`load_dotenv` 默认 `override=False`、文件不存在不报错）。
- [ ] `Proof`: 容器内 `python3 -c "import dashscope, dotenv"` 通过。

### Phase 3 - 容器内 Node + Python 同时启动编排

Status: in progress
Targets: `packages/docker/entrypoint.sh`（新增）、`packages/docker/Dockerfile`

- [ ] `Add`: `packages/docker/entrypoint.sh`：保存 Python PID，启动 `/app/dist/main.js` 并等待；收到停止信号或 Node 退出时清理 Python，避免后台进程遗留。代理启动失败不阻塞 Node 启动（视觉代理为可选能力）。
- [ ] `Add`: `Dockerfile` `COPY packages/docker/entrypoint.sh` + `CMD ["sh", "/app/entrypoint.sh"]`。
- [ ] `Decision`: 启动编排方式（记录于 Decision 节）。
- [ ] `Proof`: 容器启动后 Node（容器内 `PORT=3000`，宿主映射 3000）与 Python 8765 均可用；healthz 200；Node 经本地代理路径可达。

### Phase 4 - 环境变量与默认配置对齐

Status: in progress
Targets: `packages/docker/Dockerfile`, `docs/architecture/2026-07-06-video-analysis-baseline.md`

- [ ] `Add`: Dockerfile `ENV` 对齐容器内地址：`QWEN_VISION_PROXY_URL=http://127.0.0.1:8765/v1/chat/completions`、`QWEN_VISION_PROXY_HOST=127.0.0.1`、`QWEN_VISION_PROXY_PORT=8765`（如需）。
- [ ] `Add`: `DASHSCOPE_API_KEY` 不写入 Dockerfile（含密钥），由运行期 `-e DASHSCOPE_API_KEY=...` 传入；容器内代理 POST 必需该键（`qwen_vision_proxy.py:238-240` 读取），healthz 不需要。testing 覆盖「不带 key 时 Node 调用失败」路径。
- [ ] `Proof`: 容器内 Node 的视觉分析配置指向容器内代理。

### Phase 5 - 文档对齐

Status: in progress
Targets: `docs/design/app-overview.md`, `docs/architecture/system-baseline.md`, `docs/context/codebase-map.md`, `docs/architecture/2026-07-06-video-analysis-baseline.md`, `docs/logs/2026/08-13.md`, `docs/testing/2026/08-13-docker-fix-vision-proxy-testing.md`

- [ ] `Add`: `docs/design/app-overview.md` Docker surface 对齐：镜像内含 Node + Python 视觉代理。
- [ ] `Add`: `docs/architecture/system-baseline.md` Deployment Shape 对齐：Python 视觉代理纳入容器。
- [ ] `Add`: `docs/context/codebase-map.md` Docker 行对齐。
- [ ] `Add`: `docs/architecture/2026-07-06-video-analysis-baseline.md` 更新「Python 薄代理可选本地/容器内」表述。
- [ ] `Add`: `docs/testing/2026/08-13-docker-fix-vision-proxy-testing.md`。
- [ ] `Add`: `docs/logs/2026/08-13.md` 追加记录。
- [ ] `Add`: `docs/bugs/2026-08-13-docker-build-better-sqlite3-toolchain.md`（记录既有问题与修复）。
- [ ] `Add`: `docs/bugs/2026-08-13-dockerignore-env-leak.md`（记录 `.dockerignore` 未排除 `.env` 的既有密钥泄漏风险；处置：加入 `.dockerignore` 排除 `**/.env` 或在构建时不 COPY `.env`，本计划若顺手可一并修复）。

## Exit Criteria

- [ ] `docker:build` 在干净环境成功（builder 阶段 better-sqlite3 编译通过；runtime 阶段 ffmpeg + Python 依赖安装成功）。
- [ ] 构建缓存命中时，业务源码修改不重新执行 pnpm 依赖安装；runtime 不包含前端构建工具等开发依赖。
- [ ] Docker HEALTHCHECK 同时确认 Node 外部入口和容器内 Python `/healthz`。
- [ ] 容器启动后：Node 服务（容器内 `PORT=3000`）可用；Python 视觉代理 8765 可用（healthz 200）；Node 经 `QWEN_VISION_PROXY_URL` 走容器内本地代理。
- [ ] `docker:build`、`docker:run` 命令零改动。
- [ ] 容器内 `LOG_DIR=/download/logs` 下生成 `server-YYYY-MM-DD.log` 与 `vision-proxy.log`。
- [ ] 未破坏宿主开发流程（Python 脚本/setup/start 脚本不受影响）。
- [ ] 文档（app-overview / system-baseline / codebase-map / video-analysis-baseline / bugs / logs）对齐。
- [ ] `docs/testing/2026/08-13-docker-fix-vision-proxy-testing.md` 所有方向均已确认或明确裁定。

## Plan Audit

- Status: passed
- Reviewer / Agent: 独立 subagent（reviewer availability = none）
- Evidence: task `ses_00574f009ffeG6Vfm8u1us5GQB`（首轮 `needs revision` → 修订 B1 → 复核轮 `approved`）；审计文件 `docs/audits/2026-08-13-plan-audit-docker-fix-vision-proxy.md`

## Closure Gates

- [ ] in-scope behavior is complete
- [ ] relevant docs are aligned
- [ ] verification has run（`docker:build`、容器启动冒烟）
- [ ] `docs/testing/2026/08-13-docker-fix-vision-proxy-testing.md` exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred/follow-up
- [ ] plan audit passed before implementation
- [ ] micro-plan exception not applicable（涉部署、多文件、跨 Node/Python，full plan）
- [ ] text consistency verified: status, phases, gates, testing document, and log all agree
- [ ] closure audit was independent（subagent 复核）
- [ ] closure evidence exists in files

## Decision

### 启动编排方式

- 选择：新增 `packages/docker/entrypoint.sh`，后台启动 Python 代理 + `exec node` 前台启动 Node（PID 1 = Node）。
- 备选：(a) 复用 `start-vision-proxy.mjs`（带自动重启）——需在容器内跑 Node 脚本守护 Python，复杂度高；(b) 改 Node `main.ts` 内 spawn Python——把进程编排耦合进应用代码，不干净；(c) pm2/supervisor——引入额外进程管理器，镜像变大。
- 残余风险：容器内 Python 代理崩溃无自动重启（依赖容器重启或手动）；视频分析为可选能力，代理不可用时 Node 侧已有错误处理与重试。若后续需要自动重启，可再引入守护。

### 基础镜像选择

- 选择：保持 `node:22-alpine`，不切 glibc 镜像。已实测 alpine 可完成 better-sqlite3 本地编译（加 python3/make/g++）与 dashscope 安装。
- 备选：`node:22-bookworm-slim`（glibc，better-sqlite3 可直接用预编译二进制，Python 也更易装）——镜像更大、改动更大。
- 残余风险：alpine 下 better-sqlite3 每次镜像重建需本地编译（慢）；为一次性镜像层，可接受。

## Deferred But Adjudicated

### 容器内 Python 代理自动重启守护

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 视觉代理为可选能力；Node 侧已有失败处理；当前最小编排满足"纳入镜像"诉求。
- Successor Required: `yes`（触发条件：容器内代理崩溃导致实际用户不可用反馈）

## Closure

Status Note: 待实施与闭核算。
