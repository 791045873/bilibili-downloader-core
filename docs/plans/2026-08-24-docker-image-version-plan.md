# 2026-08-24 Docker 镜像版本化：对应包 version 作为镜像 tag

> Plan Status: completed
> Last Reviewed: 2026-08-24
> Source: 用户需求——在使用 docker compose 打包镜像时，使用对应包的 version 作为镜像的 version（server 镜像 ↔ `packages/server/package.json`，vision-proxy 镜像 ↔ `packages/vision-proxy/pyproject.toml`），每次打包都有明确的版本指定（不再静默使用 `latest`）。
> Related: `docs/plans/2026-08-20-split-dockerfile-server-vision-proxy-plan.md`（镜像命名基线）、`docs/plans/2026-08-18-docker-split-vision-proxy-plan.md`
> Audit: required（涉 deployment 保护区域，独立 subagent 复核）
> Protected area: `deployment`（ask-first）——改动 docker-compose.yml 镜像 tag、打包/导出命令与镜像版本语义。用户已在会话中直接提出该改动需求，构成人工授权。
> Testing: `docs/testing/2026/08-24-docker-image-version-testing.md`

## Current Baseline

- `packages/docker/docker-compose.yml` 两个 service 的 `image` 为无 tag 的 `bilibili-downloader-server` 与 `bilibili-downloader-vision-proxy`，docker compose 构建/运行均隐式使用 `latest`；版本不可见、不可追溯。
- 包版本：`packages/server/package.json` version `0.0.1`；`packages/vision-proxy/pyproject.toml` version `0.0.1`；`packages/docker/package.json` version `0.0.1`（无自身镜像）。
- `packages/docker/package.json` 当前仅 5 个脚本：`docker:build`=`docker compose build`、`docker:save`=`docker save -o ../../dist/bilibili-downloader-images.tar bilibili-downloader:latest bilibili-downloader:vision-proxy`（镜像名沿用旧命名，已失效）、`docker:run`=`docker compose up -d`、`docker:down`、`docker:logs`。注：`docker:build:server` / `docker:build:vision-proxy` 已在 commit `dc758ef`（2026-08-24）被移除，但 `README.md` L38 与 `docs/context/codebase-map.md`（L20/L35）仍引用这两个命令——属既有文档漂移，本计划重建这两个命令将顺带修复失效引用。
- 根 `package.json`：`docker:save` 经 `pnpm --filter @bilibili-downloader/docker docker:save` 路由到上述失效命令；`docker:save server` / `docker:save vision-proxy` 为直接 `docker save`（无 tag，输出 `dist/docker/*_linux-amd64.tar`）。
- compose 已支持 `${VAR:-default}` 插值（`QWEN_VISION_PROXY_URL`、`DOWNLOAD_HOST_PATH` 等）；`.env.example` 指导用户在 `packages/docker/.env` 写自定义配置（该文件被根 `.gitignore` 的 `.env` 规则忽略）。
- 本机环境：Docker Compose v5.3.1 可用；daemon 状态需现场确认，`docker compose config` 不依赖 daemon 可本地校验。
- 运行契约（保持不变）：server 暴露宿主 3000；vision-proxy 容器内监听 `0.0.0.0:8765` 不发布宿主机端口；两容器共享 `/download` volume；`restart: unless-stopped`；server 依赖 vision-proxy 健康后启动。

## Goals

- 镜像 tag = 对应包 version：`bilibili-downloader-server:<server 包 version>`、`bilibili-downloader-vision-proxy:<vision-proxy 包 version>`，由包文件自动推导，升版本号即换 tag，无需手改 compose。
- 每次构建/启动的版本显式且可见：compose 层用 `${SERVER_VERSION:?...}` / `${VISION_PROXY_VERSION:?...}` 必填插值，缺失即报错并给出指引；构建日志打印实际使用的版本。
- 支持显式覆盖：设置 `SERVER_VERSION` / `VISION_PROXY_VERSION` 环境变量可覆盖包版本（例如发测试 tag），未设置时回退到包文件版本。
- 打包/导出命令同步版本化：`docker:build`、`docker:build:server`、`docker:build:vision-proxy`、`docker:save*` 全部产出带版本 tag 的镜像引用；修复 `docker:save` 的失效镜像名。
- 对外命令名与 README 流程不变：`pnpm docker:build` → `pnpm docker:run` 依旧可用；直接 `docker compose` 命令在首次经 pnpm 脚本同步后也可用（`.env` 落盘）。

## Non-Goals

- 不改 Dockerfile 构建内容、不改镜像内部实现（不新增版本 LABEL/ARG，tag 已承载版本信息）。
- 不引入 registry 推送、不引入多平台矩阵、不新增 `latest` 别名（用户要求显式版本，不做静默 latest）。
- 不改运行契约、端口、volume、健康检查、`.env.example` 中既有运行参数的语义。
- 不触碰各包 version 值本身（保持 0.0.1）。

## Infrastructure And Config Prereqs

- 需要 Docker Compose v2+ 支持 `${VAR:?err}` 必填插值（本机 v5.3.1 满足）与普通 `docker build -f` / `docker save`。
- 新增脚本 `packages/docker/compose.mjs` 为纯 Node 运行时脚本（Node 24 已支持 ESM + `node:child_process`），无新增依赖，Windows PowerShell 与 NAS/Linux 均可用。
- 数据迁移/回滚：不涉及数据；回滚路径为恢复 git 历史中的 compose/package.json 无 tag 形态（`.env` 为 gitignore 生成物，删除即复原）。

## Execution Plan

### Phase 1 - 版本解析与命令派发脚本 `packages/docker/compose.mjs`

Status: completed
Targets: 新增 `packages/docker/compose.mjs`

- Item Types: `Add | Proof`

- [x] `Add`: 新增 `packages/docker/compose.mjs`：
  - 解析版本：`SERVER_VERSION` = 环境变量 `SERVER_VERSION`（已设则优先）否则读 `packages/server/package.json` 的 `version`；`VISION_PROXY_VERSION` = 环境变量 `VISION_PROXY_VERSION` 否则读 `packages/vision-proxy/pyproject.toml` 的 `version = "..."`。解析失败/缺失即报错退出（不静默 fallback）。
  - 校验版本为合法 docker tag（`[A-Za-z0-9_][A-Za-z0-9._-]{0,127}`），非法即报错。
  - 将 `SERVER_VERSION` / `VISION_PROXY_VERSION` 合并写入 `packages/docker/.env`（保留文件内其他用户配置行，仅更新/追加这两个键；无文件则新建），使后续直接 `docker compose` 命令也能取到显式版本。
  - 打印 `[compose.mjs] server=… vision-proxy=…` 一行实际版本，保证"每次打包版本可见"。
  - 以 `packages/docker` 为 cwd、携带上述两个环境变量派发命令（用 `spawn` + args 数组而非 shell 字符串拼接，避免 Windows 引号问题）：
    - 任意其他参数 → `docker compose <args...>`（覆盖 build / up -d / down / logs / config）
    - `build-server` / `build-vision-proxy` → `docker build -f Dockerfile.<target> -t bilibili-downloader-<target>:<version> ../..`
    - `save-server` / `save-vision-proxy` → 先 `mkdir -p ../../dist/docker` 再 `docker save -o ../../dist/docker/bilibili-downloader-<target>_linux-amd64.tar bilibili-downloader-<target>:<version>`
    - `save` → 先 `mkdir -p ../../dist` 再 `docker save -o ../../dist/bilibili-downloader-images.tar bilibili-downloader-server:<v> bilibili-downloader-vision-proxy:<v>`
  - 子进程退出码原样透传。注：wrapper 对任意子命令都会解析/校验两个版本（即使 `build-server` 只用 SERVER_VERSION）；若 pyproject 缺失会显式报错——接受该取舍，保证版本必填语义一致。
- [x] `Proof`: `node --check` 语法通过；无参数/未知参数给出用法；版本解析、env 覆盖、`.env` 合并行为可用最小调用验证（见 Phase 4）。

Exit Criteria:

- [x] `compose.mjs` 可解析两包版本、支持 env 覆盖、`.env` 合并不丢用户行、派发命令正确。
- [x] 无新增依赖、无 TS 源码改动。

### Phase 2 - compose / package.json / .env.example 对齐

Status: completed
Targets: `packages/docker/docker-compose.yml`, `packages/docker/package.json`, 根 `package.json`, `packages/docker/.env.example`

- Item Types: `Fix | Add | Proof`

- [x] `Fix`: `docker-compose.yml` 两个 service 的 `image` 改为 `bilibili-downloader-server:${SERVER_VERSION:?未设置 SERVER_VERSION：请先运行任意 pnpm docker:* 命令同步版本，或设置 SERVER_VERSION 环境变量}` 与 `bilibili-downloader-vision-proxy:${VISION_PROXY_VERSION:?…}`；其余编排（build.dockerfile、depends_on、ports、environment、volumes、restart）保持不变。
- [x] `Fix`: `packages/docker/package.json` 脚本改为经 `compose.mjs` 派发：`docker:build`=`node compose.mjs build`、`docker:run`=`node compose.mjs up -d`、`docker:down`=`node compose.mjs down`、`docker:logs`=`node compose.mjs logs -f --no-log-prefix`、`docker:save`=`node compose.mjs save`、新增 `docker:save:server`=`node compose.mjs save-server`、`docker:save:vision-proxy`=`node compose.mjs save-vision-proxy`、新增 `docker:config`=`node compose.mjs config`（校验用）。
- [x] `Add`: 重建 `docker:build:server`=`node compose.mjs build-server` 与 `docker:build:vision-proxy`=`node compose.mjs build-vision-proxy`（dc758ef 移除后随本计划恢复，顺带修复 README/codebase-map 的失效引用）。
- [x] `Fix`: 根 `package.json` 的 `docker:save server` / `docker:save vision-proxy` 改为路由至 `pnpm --filter @bilibili-downloader/docker docker:save:server` / `docker:save:vision-proxy`（消除无 tag 的 `docker save`，统一版本解析）。
- [x] `Add`: `.env.example` 补充 `SERVER_VERSION` / `VISION_PROXY_VERSION` 说明：由 compose.mjs 自动从包文件推导并写入本目录 `.env`，一般无需手工配置；如需临时覆盖（如测试 tag）可设置同名环境变量。
- [x] `Proof`: `node compose.mjs config`（即 `docker compose config`）通过，镜像名带 `:0.0.1`；`pnpm docker:build` 等命令在 daemon 可用时可实建带版本 tag 的镜像（无 daemon 则转人工，不判定通过）。

Exit Criteria:

- [x] 所有 docker 构建/导出命令产出带版本 tag 的镜像引用，无残留无 tag 命令；`docker:save` 失效镜像名已修复。
- [x] `docker compose config` 输出镜像名为 `bilibili-downloader-server:0.0.1` / `bilibili-downloader-vision-proxy:0.0.1`。

### Phase 3 - 文档对齐

Status: completed
Targets: `README.md`, `docs/context/codebase-map.md`, `docs/context/project-context.md`, `docs/architecture/system-baseline.md`, 新增 `docs/logs/2026/08-24-docker-image-version.md`

- Item Types: `Fix | Add | Proof`

- [x] `Fix`: `README.md` Docker 段补充镜像版本语义：两个镜像以各自包 version 打 tag（`bilibili-downloader-server:<server 包版本>` / `bilibili-downloader-vision-proxy:<vision-proxy 包版本>`），`pnpm docker:build` 自动读取，升版本即换 tag；可用 `SERVER_VERSION` / `VISION_PROXY_VERSION` 覆盖。
- [x] `Fix`: `codebase-map.md` Docker 行补充"镜像以对应包 version 打 tag（compose.mjs 推导，`SERVER_VERSION`/`VISION_PROXY_VERSION` 可覆盖）"，更新 Last Verified。
- [x] `Fix`: `project-context.md` Active plan 指向本计划。
- [x] `Fix`: `system-baseline.md` Build And Package Tools 与 Deployment Shape 段落补充镜像版本语义（deployment 真相 owner doc）。
- [x] `Add`: `docs/logs/2026/08-24-docker-image-version.md` 记录实施与验证结果。
- [x] `Proof`: 文档与最终 compose/脚本/package.json 一致；活动文档残留扫描：无 `image: bilibili-downloader-server`（无 tag 形式）、无直接 `docker save bilibili-downloader-server -o`（无 tag）等旧形态（历史 append-only 文档不计入）。

Exit Criteria:

- [x] README / codebase-map / project-context 与真实配置一致。
- [x] `docs/testing/2026/08-24-docker-image-version-testing.md` 各方向已确认或明确裁定。

### Phase 4 - 验证

Status: completed
Targets: 脚本行为 + 配置校验 + 构建/导出（daemon 可用）

- Item Types: `Proof`

- [x] `Proof`: `node --check packages/docker/compose.mjs` 通过；版本解析/覆盖/.env 合并的最小行为验证（无 daemon 依赖）。
- [x] `Proof`: `pnpm --filter @bilibili-downloader/docker docker:config`（经 wrapper 的 `docker compose config`）输出镜像名带 `:0.0.1`。
- [x] `Proof`: `pnpm typecheck` 不受影响（本次无 TS 改动，跑通作为基线确认）。
- [x] `Proof`: daemon 可用时 `pnpm docker:build` / `docker:build:server` / `docker:build:vision-proxy` 构建出带 tag 镜像，`docker images` 可见 `bilibili-downloader-server:0.0.1` / `bilibili-downloader-vision-proxy:0.0.1`；`docker:save server` 导出成功（无 daemon 则转人工并在 testing 文档记录，不判定通过）。

Exit Criteria:

- [x] 脚本行为与配置校验全绿；实建项在 daemon 可用前提下通过。

## Plan Audit

- Status: passed
- Reviewer / Agent: 独立 subagent（task `General_8375580`）
- Evidence: VERDICT needs-changes，无 Blocker。1 项 Major（Current Baseline 失真：`docker:build:server`/`docker:build:vision-proxy` 已在 commit `dc758ef` 移除，README/codebase-map 仍引用为既有漂移）已修正基线并标注漂移、Phase 2 改 `Add`；3 项 Minor 已并入（`${VAR:?err}` 错误提示改为中性指引兼容 down/logs；Phase 3 补 `system-baseline.md` deployment owner doc；测试补"wrapper 落盘后直接 compose 可用"方向）；4 项 Nit 已并入（save 前 mkdir -p、spawn args 数组、双版本恒校验取舍说明、错误消息实测）。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`node --check`、`docker compose config`、`pnpm docker:build` 实建、`docker:save` 导出、`docker:run` 运行冒烟 + `docker:down`）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan exception not applicable（涉 deployment、多文件）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（subagent 或 human）
- [x] closure evidence exists in files

## Deferred But Adjudicated

- 无降级项。镜像内容层（版本 LABEL/ARG）与 registry 推送不在本 slice 范围，属后续独立任务。

## Closure

Status Note: 实施完成并通过真实构建、导出与运行冒烟验证；全部执行项与 Exit Criteria 全绿；plan audit 通过（subagent 复核，Major/Minor/Nit 均已并入），独立 closure audit 复核通过后关闭。

Closure Audit Evidence:

- Reviewer / Agent: 独立 subagent（闭包复核，task `General_8376058`）——冷却复核 live diff、compose、compose.mjs 各派发分支、package.json、testing、owner docs 与验证证据后裁定 approve（0 Blocker / 0 Major / 2 Minor / 3 Nit，均不阻塞）。
- Evidence: `node --check` 通过；`docker compose config` 输出 `bilibili-downloader-server:0.0.1` / `bilibili-downloader-vision-proxy:0.0.1`；`pnpm docker:build` 实建两镜像成功（Image Built，~71s）；`docker:build:vision-proxy` 独立构建派发成功；`docker:save server` 与 `docker:save` 导出 tar 成功；`docker:run` 双容器 healthy、宿主 3000 返回 200、容器运行 `:0.0.1` 镜像；`docker:down` 干净退出；`pnpm typecheck` 基线通过。
- 审计建议落实：Minor 1（project-context Active plan 更新为已关闭）、Minor 2（.env.example 明示"覆盖值会写入 .env 并持续生效直至下次回写"）、Nit 1（compose.mjs 去除 .env 尾随空行）、Nit 2（docker 缺失时给出明确报错）已在关闭前落实；Nit 3（`export` 形式 .env 行不被合并识别）为罕见输入、非本计划引入，裁定不处理。
- 补充说明：daemon 上残留的旧 `:latest` / `bilibili-downloader:*` 镜像为 dc758ef 时代历史构建产物，本次任何命令未产出无 tag 镜像引用。

Follow-up:

- 无（无降级项）。
