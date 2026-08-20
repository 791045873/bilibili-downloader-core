# 2026-08-20 拆分 Dockerfile：server 与 vision-proxy 独立构建

> Plan Status: completed
> Last Reviewed: 2026-08-20
> Source: 用户需求——将 Python 服务（vision-proxy）与 Node 服务（server）改为分离的 Dockerfile，打包成两个相互独立的镜像；Node 服务对 Python 服务 URL 可配置且完全自定义；同步调整 package.json 中打包命令。
> Related: `docs/plans/2026-08-18-docker-split-vision-proxy-plan.md`（当前多 target 基线来源）、`docs/plans/2026-08-18-extract-vision-proxy-package-plan.md`
> Audit: required（涉 deployment 保护区域，独立 subagent 复核）
> Protected area: `deployment`（ask-first）——改动 `packages/docker/Dockerfile`、docker-compose.yml、镜像命名与打包命令。用户已在会话中明确授权并确认决策（URL 仅环境变量；镜像独立命名；两个 Dockerfile 置于 `packages/docker/` 下）。
> Testing: `docs/testing/2026/08-20-split-dockerfile-server-vision-proxy-testing.md`

## Current Baseline

- 单文件多 target Dockerfile：`packages/docker/Dockerfile` 含 `builder` / `python-builder` / `server` / `vision-proxy` 四个 stage，`docker-compose.yml` 以 `build.target` 从同一 Dockerfile 构建两个镜像。
- 镜像命名：`bilibili-downloader`（server）与 `bilibili-downloader:vision-proxy`，共用同一个 repository 名 + tag，镜像间存在构建共享（同 Dockerfile、同 builder/python-builder 源）。
- server 镜像内 `ENV QWEN_VISION_PROXY_URL=http://vision-proxy:8765/v1/chat/completions` 硬编码默认值，隐含对 compose 服务名 `vision-proxy` 的耦合；docker-compose.yml 已用 `${QWEN_VISION_PROXY_URL:-http://vision-proxy:8765/v1/chat/completions}` 插值，运行时可覆盖。
- Node 服务读取 `process.env.QWEN_VISION_PROXY_URL`（`packages/server/src/analysis/analysis.controller.ts:478`、`analysis-trigger.service.ts:663`），已支持环境变量完全自定义；未设置时多模态调用在 `packages/adapters/src/llm/qwen-client.ts:102` 给出明确错误。
- 根 `package.json` 已有未提交改动：新增 `docker:save bilibili-downloader` 与 `docker:save vision-proxy` 两条命令（分别导出 `bilibili-downloader` 与 `bilibili-downloader:vision-proxy`），其镜像名/键名需随新命名同步。
- `packages/docker/package.json`：`docker:build` = `docker compose build`（构建两个镜像）、`docker:run` = `docker compose up -d`、`docker:down`、`docker:logs`。
- `.dockerignore` 位于仓库根，构建上下文为仓库根 `../..`，两个新 Dockerfile 均复用。
- 本机环境：Docker Compose v5.3.1 可用；Docker daemon 当前未运行（`docker version` 连接失败），`docker compose config` 不依赖 daemon 可本地校验，镜像实建需 daemon 可用。
- 运行契约（保持不变）：server 暴露宿主 3000；vision-proxy 容器内监听 `0.0.0.0:8765` 不发布宿主机端口；两容器共享 `/download` volume；`restart: unless-stopped`；server 依赖 vision-proxy 健康后启动。

## Goals

- 将单一多 target `Dockerfile` 拆为两个相互独立的 Dockerfile：`packages/docker/Dockerfile.server`（Node + 前端 + FFmpeg + tini）与 `packages/docker/Dockerfile.vision-proxy`（Python venv 视觉代理 + tini）。两文件各自完整自包含，构建阶段互不引用（无跨文件 `COPY --from`、无共享 stage），构建出两个没有任何构建层依赖的独立镜像。
- 镜像独立命名：`bilibili-downloader-server` 与 `bilibili-downloader-vision-proxy`（不再共用 repository 名 + tag）。
- Python 服务 URL 在 Node 服务中可配置、完全自定义：`QWEN_VISION_PROXY_URL` 环境变量为唯一配置入口（现状已支持）；移除 server 镜像内硬编码默认值，镜像不再耦合 compose 服务名，URL 由运行期环境变量完全控制。
- 同步调整打包命令：根 `package.json` 与 `packages/docker/package.json` 中 docker build / save 命令匹配新 Dockerfile 与新镜像名。
- 对外行为不变：compose 编排、端口、volume、健康检查、`pnpm docker:build` / `docker:run` / `docker:down` / `docker:logs` 命令名不变。

## Non-Goals

- 不改 `qwen_vision_proxy.py`、Node 分析代码、`QWEN_VISION_PROXY_URL` 读取逻辑（已满足"仅环境变量"自定义）。
- 不新增 DB 设置项、不改设置页 UI（用户确认 URL 仅环境变量配置）。
- 不拆分前端容器、不引入 nginx、不引入多平台构建矩阵（保持 linux 默认平台与现有 save 命名）。
- 不维护单一多 target Dockerfile 作为备用形态。

## Infrastructure And Config Prereqs

- 需要 Docker 支持 `docker compose`（v2+，本机 v5.3.1 满足）与普通 `docker build -f` 独立构建。
- 两个 Dockerfile 的构建上下文均为仓库根 `../..`（复用根 `.dockerignore`）；`docker-compose.yml` 的 `build.dockerfile` 分别指向两个新文件，删除 `build.target`。
- 环境变量桥接保持：compose 以 `${QWEN_VISION_PROXY_URL:-http://vision-proxy:8765/v1/chat/completions}` 注入 server，`QWEN_VISION_PROXY_*` 健壮性参数、`LOG_DIR`、`LOG_MAX_FILES`、`MAX_CONCURRENT_DOWNLOADS`、`DOWNLOAD_HOST_PATH` 语义不变。
- 新增应用依赖：无。
- 数据迁移/回滚：不涉及数据；回滚路径为恢复原单文件 Dockerfile 与旧镜像名（git 历史保留）。

## Execution Plan

### Phase 1 - 拆分 Dockerfile 为两个独立文件

Status: completed
Targets: `packages/docker/Dockerfile`（拆分并删除）、新增 `packages/docker/Dockerfile.server`、新增 `packages/docker/Dockerfile.vision-proxy`

- Item Types: `Decision | Fix | Proof`

- [x] `Decision`: 采用两个独立 Dockerfile（`Dockerfile.server` / `Dockerfile.vision-proxy`），每文件自包含各自构建阶段，构建互不共享。备选：(a) 保留单多 target 文件——不满足"分离的 Dockerfile、两个没有任何联系的镜像"诉求；(b) 各包目录下放 Dockerfile——用户已确认两文件置于 `packages/docker/`。残余风险：APT/NPM/PIP 镜像源与构建逻辑在文件中轻度重复（server 含 builder 与 server 两阶段；vision-proxy 含 python-builder 与 vision-proxy 两阶段），但各自独立可维护。
- [x] `Add`: `packages/docker/Dockerfile.server` = 原 `builder` + `server` 两个 stage 原样迁移；**移除** `ENV QWEN_VISION_PROXY_URL=...` 硬编码默认（镜像不耦合 compose 服务名，URL 由运行期环境变量注入）；其余 ENV（`PORT`/`OUTPUT_DIR`/`LOG_DIR`/`MAX_CONCURRENT_DOWNLOADS`）、HEALTHCHECK、ENTRYPOINT/CMD 不变。保留 builder 中 `COPY packages/vision-proxy/package.json packages/vision-proxy/`（pnpm workspace 需所有 workspace 包 package.json 才能解析 `--frozen-lockfile`，仅解析用途，不构成运行耦合）。
- [x] `Add`: `packages/docker/Dockerfile.vision-proxy` = 原 `python-builder` + `vision-proxy` 两个 stage 原样迁移；ENV（`QWEN_VISION_PROXY_HOST`/`QWEN_VISION_PROXY_PORT`/`LOG_DIR`）、HEALTHCHECK、ENTRYPOINT/CMD、Node 工具链删除逻辑不变。
- [x] `Fix`: 删除 `packages/docker/Dockerfile`（git 历史保留可回滚）。
- [x] `Proof`: 两个新 Dockerfile 语法完整、各自自包含（视觉审查 + 无跨文件 `COPY --from`）；`docker build -f Dockerfile.server` 与 `-f Dockerfile.vision-proxy` 各自可独立构建（daemon 可用时）；镜像职责与 Phase 2 验收一致。（注：`docker compose config` 校验依赖 Phase 2 的 compose 引用更新，故该 proof 归入 Phase 2。）

Exit Criteria:

- [x] `packages/docker/` 下不再存在多 target `Dockerfile`；两个新 Dockerfile 各自自包含、互不引用。
- [x] server 镜像内无 `QWEN_VISION_PROXY_URL` 硬编码默认；vision-proxy 镜像不含可运行 Node 组件、server 镜像不含 Python/venv/代理脚本。
- [x] `packages/docker/package.json` 与根 `package.json` 命令同步更新（见 Phase 2）。
- [x] `docs/logs/` 更新（Phase 3）。

### Phase 2 - 编排与打包命令对齐

Status: completed
Targets: `packages/docker/docker-compose.yml`, `packages/docker/.env.example`, `packages/docker/package.json`, 根 `package.json`

- Item Types: `Fix | Add | Proof`

- [x] `Fix`: `docker-compose.yml` 两个 service 的 `build.dockerfile` 分别改为 `packages/docker/Dockerfile.vision-proxy` 与 `packages/docker/Dockerfile.server`，删除 `build.target`；`image` 分别改为 `bilibili-downloader-vision-proxy` 与 `bilibili-downloader-server`；其余编排（depends_on、ports、environment、volumes、restart）保持不变。
- [x] `Add`: `.env.example` 补充 `QWEN_VISION_PROXY_URL` 说明：Node 访问 Python 视觉代理的完整 URL，可自定义指向任意可访问的代理地址（默认 `http://vision-proxy:8765/v1/chat/completions` 仅 compose 网络内服务名）。
- [x] `Fix`: 根 `package.json` 的 `docker:save` 命令键名与镜像名改为新命名：`docker:save server` → `docker save bilibili-downloader-server -o dist/docker/bilibili-downloader-server_linux-amd64.tar`；`docker:save vision-proxy` → `docker save bilibili-downloader-vision-proxy -o dist/docker/bilibili-downloader-vision-proxy_linux-amd64.tar`。
- [x] `Add`: `packages/docker/package.json` 新增 `docker:build:server`（`docker build -f Dockerfile.server -t bilibili-downloader-server ../..`）与 `docker:build:vision-proxy`（`docker build -f Dockerfile.vision-proxy -t bilibili-downloader-vision-proxy ../..`）独立构建命令，支持不依赖 compose 单独构建任一镜像；`docker:build`（compose build）保留。
- [x] `Proof`: `docker compose config` 校验通过（双 service、正确 dockerfile 路径、无 target、image 名正确）；`pnpm docker:build`（daemon 可用时）构建出两个新镜像名；`pnpm docker:build:server` 与 `pnpm docker:build:vision-proxy` 各自独立构建成功。

Exit Criteria:

- [x] compose/package.json/命令与新 Dockerfile 及新镜像名一致，无残留旧命名（`bilibili-downloader:vision-proxy`、`packages/docker/Dockerfile` + `target` 引用）。
- [x] 根 `package.json` 的 `docker:save` 键名与镜像名与新命名一致。
- [x] `docs/logs/` 更新（Phase 3）。

### Phase 3 - 文档对齐

Status: completed
Targets: `docs/context/codebase-map.md`, `docs/architecture/system-baseline.md`, `docs/architecture/module-boundaries.md`, `docs/design/app-overview.md`, `docs/architecture/2026-07-06-video-analysis-baseline.md`, `docs/context/source-of-truth-and-precedence.md`, `docs/context/project-context.md`, `README.md`, 新增 `docs/discussions/2026-08-20-dockerfile-split-scope.md`, 新增 `docs/logs/2026/08-20-*.md`

- Item Types: `Fix | Add | Proof`

- [x] `Add`: `docs/discussions/2026-08-20-dockerfile-split-scope.md` 记录拆分诉求、决策点（URL 仅环境变量、镜像独立命名、Dockerfile 置于 `packages/docker/`）、排除项（多 target 保留、DB 设置化 URL）。
- [x] `Fix`: `codebase-map.md` Docker 行改为"两个独立 Dockerfile（`Dockerfile.server` / `Dockerfile.vision-proxy`）+ compose 双容器编排"，Vision Proxy 行与 server 行同步；更新 Last Verified。
- [x] `Fix`: `system-baseline.md` Build And Package Tools 与 Deployment Shape 段落改为独立双 Dockerfile 构建、镜像名 `bilibili-downloader-server` / `bilibili-downloader-vision-proxy`；同时修正 L18 目录树条目 `docker/ — Dockerfile 与构建脚本`（单数歧义）为"两个独立 Dockerfile + compose 编排"。
- [x] `Fix`: `module-boundaries.md` `packages/docker/` 责任行改为"两个独立 Dockerfile + compose 编排，打包为两个相互独立的镜像"；同步 L66 依赖图 `docker ──(build)──→ server + frontend + vision-proxy` 措辞（保持语义、去除"同文件多 target"歧义）。
- [x] `Fix`: `app-overview.md` Docker surface 行措辞微调，明确"URL 经 `QWEN_VISION_PROXY_URL` 环境变量完全自定义"（该行本无旧镜像名字面量，仅需补充说明）。
- [x] `Fix`: `video-analysis-baseline.md` 环境变量段落说明容器模式默认 URL 由 compose 注入（原 Dockerfile 硬编码默认已移除）。
- [x] `Fix`: `source-of-truth-and-precedence.md` 环境/部署真相段落将 `packages/docker/Dockerfile` 改为两个 Dockerfile 路径。
- [x] `Fix`: `project-context.md` Active plan 指向本计划。
- [x] `Fix`: `README.md` Docker 段改为"两个独立 Dockerfile（server / vision-proxy）构建两个独立镜像"，镜像名与命令同步。
- [x] `Add`: `docs/logs/2026/08-20-*.md` 记录实施与验证结果。
- [x] `Proof`: 文档与最终 compose/Dockerfile/package.json 一致。残留扫描限定**活动文档与配置**（README / context / design / architecture / codebase-map / docker 配置 / package.json / .env.example / 本计划）：无旧镜像名 `bilibili-downloader:vision-proxy`、无 `build.target` 引用、无 `packages/docker/Dockerfile` 路径引用。历史 plan/log/bug/audit/testing 为 append-only 记录，其历史描述不计入残留。

Exit Criteria:

- [x] 活动文档与真实配置一致，无旧命名残留。
- [x] `docs/testing/2026/08-20-split-dockerfile-server-vision-proxy-testing.md` 各方向均已确认或明确裁定。
- [x] `docs/logs/` 更新。

### Phase 4 - 验证

Status: completed
Targets: 配置校验 + 镜像构建 + 运行冒烟

- Item Types: `Proof`

- [x] `Proof`: `docker compose config` 校验通过（本地可执行，不依赖 daemon）。
- [x] `Proof`: daemon 可用时执行 `pnpm docker:build`（compose 构建两镜像）、`pnpm docker:build:server`、`pnpm docker:build:vision-proxy`；镜像列表出现 `bilibili-downloader-server` 与 `bilibili-downloader-vision-proxy`。
- [x] `Proof`: 镜像职责检查：server 镜像无 python/venv/代理脚本且无 `QWEN_VISION_PROXY_URL` 默认；vision-proxy 镜像无 node/npm 可执行、有代理脚本与 venv。
- [x] `Proof`: 运行冒烟：server 容器内 `fetch('http://vision-proxy:8765/healthz')` 200；宿主 3000 可访问；`docker port` 仅 3000；`docker compose down` 干净退出。
- [x] `Proof`: 自定义 URL 验证：`QWEN_VISION_PROXY_URL` 设置为任意自定义地址后 server 读取该值（日志/健康探活可观测），未设置时多模态调用给出明确配置错误。

Exit Criteria:

- [x] 配置与构建命令全部通过；daemon 不可用导致无法实建时，实建项转为人工执行并在 testing 文档记录，不判定为通过。
- [x] `pnpm typecheck` / `pnpm build` 不受影响（本次无 TS 源码改动；如需跑通作为基线可执行确认）。

## Plan Audit

- Status: passed
- Reviewer / Agent: 独立 subagent（task `ses_fe0623b44ffeiWUfHijWLEpHBT`）
- Evidence: VERDICT approved，无 blocker；5 个 minor/nit 建议已全部并入计划（Phase1 compose-config proof 移至 Phase 2、残留扫描限定活动文档、补 system-baseline L18 与 module-boundaries L66、app-overview 措辞、pyproject 名不动）。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`docker compose config`；daemon 可用时 `pnpm docker:build` / `docker:build:server` / `docker:build:vision-proxy`）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan exception not applicable（涉 deployment、多文件、多模块，full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（subagent 或 human）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### URL 配置入 DB / 设置页

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 用户明确选择"仅环境变量"；DB 化 URL 需改 DB 模型、设置页 UI 与读取逻辑，属另一独立 slice。
- Successor Required: `no`

### 多平台（linux/amd64 + arm64）构建矩阵

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 当前 save 命名与构建命令面向 linux/amd64；用户未要求扩展平台。
- Successor Required: `no`

## Closure

Status Note: 拆分已完成并通过真实构建与运行验证；全部执行项与 Exit Criteria 全绿；plan audit 通过，独立 closure audit 复核通过后关闭。

Closure Audit Evidence:

- Reviewer / Agent: 独立 subagent（闭包复核，task `ses_fe056808effezatd91J22qHUa3`）——冷却复核 live diff、两个新 Dockerfile、compose、package.json、testing、owner docs 与运行证据后裁定 approve closure（2 MINOR / 2 NIT，均不阻塞）。
- Evidence: `docker compose config` 通过；`docker build -f Dockerfile.vision-proxy` 与 `docker build -f Dockerfile.server` 各自独立构建成功（Image Built）；`docker compose up -d` 双容器 healthy，server 容器内 `fetch('http://vision-proxy:8765/healthz')` 200，宿主 3000 可访问，`docker port` 仅 3000；`docker compose down` 干净退出；server 镜像无 venv/代理脚本且 `QWEN_VISION_PROXY_URL` 未设置，vision-proxy 镜像无 node/ffmpeg、有代理脚本与可导入 dashscope/dotenv 的 venv；`docker:save server` / `docker:save vision-proxy` 实测导出两个 tar 成功。
- 审计建议落实：MINOR 1（清理 `packages/server/python/` 陈旧残留，消除 server 镜像内 Python egg-info 杂质）与 NIT 1（project-context 计划状态改为已关闭）、NIT 2（testing 环境说明改为 daemon 可用并记录实测）已在关闭前落实；MINOR 2（vision-proxy 镜像 evidence 时间戳来自历史构建）为描述性措辞，实质验证已在本轮重构建复核通过。

Follow-up:

- 无（无降级项）。
