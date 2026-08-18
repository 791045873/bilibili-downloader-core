# 2026-08-18 提取 Python 视觉代理为独立子包

> Plan Status: completed
> Last Reviewed: 2026-08-18
> Source: 用户会话决策——Docker 已把 Python 视觉代理打包为独立 `vision-proxy` 容器，但源码仍挂在 `packages/server/python/` 下；经 `docs/discussions/2026-08-18-python-service-package-location.md` 讨论确认拆分。
> Related: `docs/plans/2026-08-18-docker-split-vision-proxy-plan.md`（双容器拆分，本计划的前提基线）
> Audit: required（独立 subagent；reviewer availability = none，受保护区域 deployment 需 subagent/human 复核）
> Protected area: `deployment`（ask-first）——改动 `packages/docker/Dockerfile` 的 COPY 路径与 server 构建行为。用户已在本会话明确授权推进。
> Testing: `docs/testing/2026/08-18-extract-vision-proxy-package-testing.md`

## Current Baseline

- Python 视觉代理源码位于 `packages/server/python/`（`pyproject.toml` + `qwen_vision_proxy.py`），但部署形态已是 compose 独立容器 `vision-proxy`（见 `docs/plans/2026-08-18-docker-split-vision-proxy-plan.md`，已关闭）。
- `packages/docker/Dockerfile`：`python-builder` 阶段 `COPY packages/server/python/pyproject.toml ...`（L97）、`vision-proxy` 阶段 `COPY packages/server/python/qwen_vision_proxy.py /app/python/qwen_vision_proxy.py`（L188）；`builder` 阶段 `COPY packages/server/ packages/server/`（L53）会把整个 server 目录（含 `python/` 及其 gitignored 产物）带入构建，经 `pnpm --filter @bilibili-downloader/server deploy ... /app/runtime`（L66）传递到 server 运行时镜像（`COPY --from=builder /app/runtime ./`，L137），随后 `RUN rm -rf /app/python`（L140，与 `mkdir -p`、better-sqlite3 冒烟同属一条链式 RUN）主动剥离，等于为目录归属错误打补丁。
- 宿主开发模式由根目录 `scripts/setup-vision-proxy.mjs`（pythonDir/pyproject/venv 常量）与 `scripts/start-vision-proxy.mjs`（pythonDir/proxyScript/venv 常量）按 `packages/server/python` 路径管理 `.venv` 与启动；`packages/server/package.json` 的 `start:vision-proxy` 委托 `../../scripts/start-vision-proxy.mjs`。
- `qwen_vision_proxy.py:70-71`：`SERVER_DIR = Path(__file__).resolve().parents[1]` + `load_dotenv(SERVER_DIR / ".env")`，开发模式从 `packages/server/.env` 读取 `DASHSCOPE_API_KEY` 等（与 server 共享同一 env 文件，属拆分需处理的耦合）。
- 本机现状：`packages/server/.env` 存在且含密钥（gitignored，不搬运、不读取内容）；`packages/server/python/` 下存在 `.venv`、`build/`、`__pycache__/`、`*.egg-info/`（均 gitignored；其中 `build/` 与 `*.egg-info/` 未纳入 `.dockerignore`，会进 server 构建上下文）。
- pnpm workspace：`pnpm-workspace.yaml` 使用 `packages/*`；所有子包（core/adapters/server/frontend/docker/bilibili-api-sdk）均有 package.json，vision-proxy 是唯一"独立部署单元却挂在别包目录下"的例外。`pnpm-lock.yaml` 当前无 vision-proxy importer。
- `pnpm -r build` / `pnpm -r typecheck` 仅执行存在对应脚本的子包；纯 Python 子包若定义无 build/typecheck 脚本则被自动跳过，不受影响。
- 已知文档残留引用（本计划范围外的历史留档不修改）：`docs/logs/2026/08-11.md`、`docs/plans/2026-08-11-vision-proxy-python-best-practice.md`、`docs/plans/2026-08-12-vision-proxy-robustness-plan.md`、`docs/plans/2026-08-13-production-file-logging-plan.md`、`docs/plans/2026-08-13-docker-fix-vision-proxy-plan.md`、`docs/testing/2026/08-13-production-file-logging-testing.md`（L78 含 `packages\server\python\qwen_vision_proxy.py`，属已关闭计划的历史验证记录）。

## Goals

- 将视觉代理源码迁移至新子包 `packages/vision-proxy/`（`pyproject.toml` + `qwen_vision_proxy.py` + 最小 `package.json`），与其余 `packages/*` 一致成为 pnpm workspace 子包。
- `packages/server/` 不再包含 Python 目录；`packages/docker/Dockerfile` 的 COPY 指向改为 `packages/vision-proxy/`，server 阶段删除 `rm -rf /app/python` 补丁。
- 代理开发模式 env 归属改为 `packages/vision-proxy/.env`（`load_dotenv` 从 `parents[1]` 改为 `parent`），与 server env 解耦。
- 宿主脚本路径常量更新；`.venv` 重建于新位置；`pnpm-lock.yaml` 重新生成并纳入新 importer。
- 对外行为不变：两个 Docker 镜像内容功能等价（复制目标路径 `/app/python/qwen_vision_proxy.py` 保持），compose 编排/服务名/env 桥接/端口/healthcheck 不变；代理 HTTP 行为不变。
- 相关 owner docs、codebase-map、README 对齐新路径与 env 归属。

## Non-Goals

- 不改代理 HTTP 行为、body 上限/超时/并发上限/healthz 语义；不改 compose（`packages/docker/docker-compose.yml`、`.env.example` 不动）。
- 不改任何 server Node 源码；不改变 `pnpm docker:*` 命令名与镜像名。
- 不自动搬运 `packages/server/.env` 中的密钥（gitignored 本地文件，仅文档指引用户迁移到 `packages/vision-proxy/.env`）。
- 不修改历史 plan/log/audit/testing 文档中的旧路径引用（历史留档）。
- 不引入 nginx、不拆前端、不做镜像签名/registry 等部署增强。

## Infrastructure And Config Prereqs

- 需要 `pnpm install` 重新生成 `pnpm-lock.yaml`（新增 workspace importer）；Docker 构建用 `--frozen-lockfile`，lockfile 必须在构建前更新到位。
- 本地需可用 Python 解释器以重建 `packages/vision-proxy/.venv`（`pnpm setup:vision-proxy` 幂等处理，缺失时跳过安装不报错）。
- 开发模式密钥迁移由用户执行（文档指引）：将 `DASHSCOPE_API_KEY` 等从 `packages/server/.env` 复制/移动到 `packages/vision-proxy/.env`；实施与验证不依赖该密钥（无 key 时 `/healthz` 仍 200）。
- 无新增应用依赖；Python 依赖仍由 `pyproject.toml` 锁定（`dashscope==1.26.6`、`python-dotenv==1.2.2`）。

## Execution Plan

### Phase 1 - 文件迁移与 workspace 子包化

Status: completed
Targets: `packages/server/python/` → `packages/vision-proxy/`，新增 `packages/vision-proxy/package.json`，`pnpm-lock.yaml`

- [x] `Add`: `git mv packages/server/python/pyproject.toml packages/vision-proxy/pyproject.toml`；`git mv packages/server/python/qwen_vision_proxy.py packages/vision-proxy/qwen_vision_proxy.py`。
- [x] `Add`: 新建 `packages/vision-proxy/package.json`（name `@bilibili-downloader/vision-proxy`，private，version 0.0.1，description 同 pyproject，scripts `setup`/`start` 委托根目录脚本；不定义 build/typecheck 脚本）。
- [x] `Add`: 清理旧目录遗留的 gitignored 产物（`.venv`、`build/`、`__pycache__/`、`*.egg-info/`），确保 `packages/server/python` 完全移除、`packages/server/` 下不再残留 python 目录。（说明：旧 `.venv` 被开发模式代理进程占用，已终止 watcher 进程树后删除。）
- [x] `Decision`: 选择"新建 `packages/vision-proxy/` + 最小 package.json"作为子包形态。备选：(a) 不建 package.json——pnpm 忽略无 package.json 目录，功能可用但与"packages/* 即子包"约定不一致；(b) 把脚本也移入包内——职责更聚合但扩大改动面，本期保留根目录脚本仅改路径。残余风险：新增 workspace importer 后 lockfile 必须重生成，否则 Docker `--frozen-lockfile` 失败（验证覆盖）。
- [x] `Proof`: `pnpm install` 成功（exit 0）且 `pnpm-lock.yaml` 出现 `packages/vision-proxy` importer；`git status` 显示移动与新增文件正确。

Exit Criteria:

- [x] `packages/server/python` 不存在；`packages/vision-proxy/` 含 `pyproject.toml`、`qwen_vision_proxy.py`、`package.json`。
- [x] `pnpm-lock.yaml` 已更新且包含 `packages/vision-proxy` importer。
- [x] `pnpm -r build` 与 `pnpm -r typecheck` 对 vision-proxy 无对应脚本被跳过，不报错（typecheck 实测 "Scope: 7 of 8 workspace projects"，build 同）。

### Phase 2 - 代理 env 归属解耦

Status: completed
Targets: `packages/vision-proxy/qwen_vision_proxy.py`

- [x] `Fix`: `SERVER_DIR = Path(__file__).resolve().parents[1]` + `load_dotenv(SERVER_DIR / ".env")` 改为 `PROXY_DIR = Path(__file__).resolve().parent` + `load_dotenv(PROXY_DIR / ".env")`（开发模式读取 `packages/vision-proxy/.env`）。`Decision`：拆分后各子包拥有各自 env 文件，符合独立子包原则；Docker 模式密钥仍经 compose 注入不受影响。备选：加载仓库根 `.env`——与 server 的 `envFilePath: ["packages/server/.env", ".env"]` 共享兜底但产生跨包隐式耦合，不选。残余风险：现有开发用户在旧 `packages/server/.env` 中的密钥需手动迁移，README 指引。
- [x] `Proof`（静态）：代码审查确认 `parents[1]` / `SERVER_DIR` 已无残留且 `load_dotenv` 指向 `parent / ".env"`；`missing_dependency_exit` 的 `pyproject.toml` 提示路径随文件移动自动正确。运行时启动与 `/healthz` 验证推迟到 Phase 4（Phase 2 结束时新 venv 尚未重建、脚本路径尚未更新，无法运行）。

Exit Criteria:

- [x] `qwen_vision_proxy.py` 无 `parents[1]` / `SERVER_DIR` 残留；`load_dotenv` 指向 `packages/vision-proxy/.env`（静态代码审查）。
- [x] 运行时验证（无 `.env` 健康启动 + `/healthz` 200）已在 Phase 4 完成后满足。

### Phase 3 - 脚本与 Dockerfile 路径更新

Status: completed
Targets: `scripts/setup-vision-proxy.mjs`, `scripts/start-vision-proxy.mjs`, `packages/docker/Dockerfile`

- [x] `Fix`: `scripts/setup-vision-proxy.mjs` 的 `pythonDir` 常量改为 `packages/vision-proxy`（L8-10）。
- [x] `Fix`: `scripts/start-vision-proxy.mjs` 的 `pythonDir`/`proxyScript` 常量改为 `packages/vision-proxy`（L8-9）。
- [x] `Fix`: `packages/docker/Dockerfile` 两处 COPY 改为 `packages/vision-proxy/pyproject.toml`（L97）与 `packages/vision-proxy/qwen_vision_proxy.py`（L188）。
- [x] `Fix`: `packages/docker/Dockerfile` `builder` 阶段新增 `COPY packages/vision-proxy/package.json packages/vision-proxy/`（与 L36-41 各包 package.json COPY 并列）；否则新 workspace importer 使 `pnpm install --frozen-lockfile`（L48/L57）无法解析该目录，构建失败。
- [x] `Fix`: `packages/docker/Dockerfile` `server` 阶段从 L140 链式 `RUN` 中删除 `rm -rf /app/python && \`，**保留**该 RUN 的 `mkdir -p /download /download/logs` 与 better-sqlite3 冒烟检查。
- [x] `Proof`: `node --check` 两个脚本；`docker compose config` 通过（注：compose config 只校验 YAML/context，不校验 COPY 目标路径，COPY 正确性由 Phase 6 真实构建证明）。

Exit Criteria:

- [x] 代码与配置中不再有对 `packages/server/python` 的引用（grep 校验，历史 docs 除外）。
- [x] server 镜像构建不再执行 `rm -rf /app/python`（该目录已不存在）；builder 阶段含 `packages/vision-proxy/package.json` COPY。
- [x] 新 workspace importer 可被 `pnpm install --frozen-lockfile` 解析（Phase 6 构建成功即证明）。

### Phase 4 - 本地 venv 重建与开发模式冒烟

Status: completed
Targets: `packages/vision-proxy/.venv`（gitignored，本机）

- [x] `Fix`: 从仓库根运行 `pnpm setup:vision-proxy` 重建 `packages/vision-proxy/.venv` 并安装锁定依赖（脚本按自身 `__dirname` 定位路径，cwd 无关；`packages/vision-proxy/package.json` 只定义了 `setup`/`start`，**没有** `setup:vision-proxy` 脚本，不可在包目录内直接调用该名字）；重复执行验证幂等（依赖已就绪即跳过）。
- [x] `Proof`: `pnpm --filter @bilibili-downloader/server start:vision-proxy`（`VISION_PROXY_NO_RESTART=1`）拉起代理，`GET http://127.0.0.1:8765/healthz` 返回 200 `{"status":"ok"}`；无 `.env` 时启动横幅/日志正常。

Exit Criteria:

- [x] `.venv` 位于 `packages/vision-proxy/.venv`，`pip show` 显示 dashscope/dotenv 已安装；旧位置无 venv。
- [x] 开发模式代理可经原命令 `pnpm --filter @bilibili-downloader/server start:vision-proxy` 启动并健康。

### Phase 5 - 文档对齐

Status: completed
Targets: `docs/context/codebase-map.md`, `docs/architecture/module-boundaries.md`, `docs/architecture/2026-07-06-video-analysis-baseline.md`, `README.md`, `docs/context/project-context.md`, `docs/testing/2026/08-18-extract-vision-proxy-package-testing.md`（新增）, `docs/logs/2026/08-18-extract-vision-proxy-package.md`（新增）

- [x] `Fix`: `codebase-map.md` Vision Proxy 行、修改视频分析能力行、Large/Fragile 行路径改为 `packages/vision-proxy/`，更新 Last Verified。
- [x] `Add`: `module-boundaries.md` 新增 `packages/vision-proxy/` 边界段（纯 Python 薄代理，无 pnpm 依赖，仅经 HTTP 与 server 通信；与 Node 编排经 compose 网络 / 宿主脚本解耦；load_dotenv 归属自身 `.env`），并更新 docker 段与依赖方向图。
- [x] `Fix`: `2026-07-06-video-analysis-baseline.md` 中 `packages/server/python/` / `server/python/` 引用（L32/L85/L188/L198）改为 `packages/vision-proxy/`；env 来源描述对齐（新增宿主开发模式 env 归属说明）。
- [x] `Fix`: `README.md` 子包列表（6 → 7，含 Bilibili API SDK 订正）、L29/L31/L35 的路径与 `.env` 归属描述更新。
- [x] `Fix`: `project-context.md` Active plan 指向本计划、Active backlog 行更新。
- [x] `Add`: 本计划的 `docs/testing/` 与 `docs/logs/` 文档。
- [x] `Proof`: 文档一致性复查（grep `packages/server/python` 仅剩历史留档与本次讨论/计划/测试文档中的现状描述）。

Exit Criteria:

- [x] 全部活动文档路径与最终仓库一致；无活动文档残留 `packages/server/python`。
- [x] `module-boundaries.md` 记录 vision-proxy 边界；`project-context.md` 指向本计划。

### Phase 6 - 验证

Status: completed
Targets: 仓库级验证与 Docker 构建

- [x] `Proof`: `pnpm typecheck`、`pnpm build` 通过（vision-proxy 无对应脚本被跳过；typecheck 实测 "Scope: 7 of 8 workspace projects"）。
- [x] `Proof`: `docker compose config` 通过；`pnpm docker:build` 两镜像构建成功（`--frozen-lockfile` 依赖 Phase 1 的 lockfile 更新）。
- [x] `Proof`: 镜像内容检查——server 镜像无 python/`/opt/vision-venv`/`qwen_vision_proxy.py`/`/app/python`；vision-proxy 镜像含 `/app/python/qwen_vision_proxy.py` 且 venv 可导入 `dashscope`/`dotenv`，`command -v node`/`npm` 无结果（与拆分前基线一致）。

Exit Criteria:

- [x] `pnpm typecheck`、`pnpm build` exit 0；两镜像构建成功。
- [x] 镜像职责检查与 `docs/testing/2026/08-18-docker-split-vision-proxy-testing.md` 既有结论一致（server 无 python；proxy 有代理脚本）。

## Plan Audit

- Status: passed（两轮 subagent；首轮 needs revision → 修订 → 复核 approved）
- Reviewer / Agent: 独立 subagent（task `ses_fed2f1ed1ffeu5MV5MN36qsebu`）
- Evidence: 首轮返回 1 blocker + 6 minor + 3 observation：blocker 为 builder 阶段缺失 `packages/vision-proxy/package.json` 的 COPY（否则 `--frozen-lockfile` 无法解析新 importer）；已修订 Phase 3 新增该 COPY 项与退出标准、Phase 4 命令改为仓库根 `pnpm setup:vision-proxy`、Baseline 修正 /app/python 传递链路、L20 豁免清单补 `docs/testing/2026/08-13-production-file-logging-testing.md`、Phase 2 证明改为静态、L140 RUN 链保留说明、Deferred 项补 reopen trigger、`.dockerignore` 卫生项显式裁定。复核轮（同 task）逐一对照 live 文件确认 B1/M1-M6/O1-O3 全部解决、无新增矛盾，VERDICT approved；唯一新增为审计记录卫生提示（audit 段需以复核轮证据定稿），本节即为此定稿。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm install`、`pnpm typecheck`、`pnpm build`、`pnpm setup:vision-proxy` 幂等、开发模式代理 healthz、`docker compose config`、`pnpm docker:build`、镜像内容检查）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan exception not applicable（涉 deployment、多文件、多模块，full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（subagent 或 human）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 用户密钥自动迁移（packages/server/.env → packages/vision-proxy/.env）

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: `packages/server/.env` 为 gitignored 本地密钥文件，自动搬运密钥违反最小触碰原则；README 提供迁移指引，未迁移时开发模式仅真实分析调用失败（healthz/启动不受影响）。
- Successor Required: `no`
- Reopen Trigger: 若用户反馈开发模式密钥迁移造成困惑或希望提供一键迁移脚本，再单独规划。

### 将 setup/start 脚本移入 vision-proxy 包内

- Classification: `optimization candidate`
- Why Not Blocking Closure: 本期 package.json 已委托根目录脚本，职责已可用；把脚本实体移入包内是纯整理，不改变行为。
- Successor Required: `no`
- Reopen Trigger: 若根目录 `scripts/` 出现多个代理相关脚本、或需要 `pnpm --filter @bilibili-downloader/vision-proxy` 独立分发脚本时再评估。

### `.dockerignore` 补充 build/ 与 *.egg-info/

- Classification: `optimization candidate`
- Why Not Blocking Closure: 迁移后 vision-proxy 阶段只 COPY 两个指定文件，`packages/vision-proxy/` 下偶发的 `build/`/`*.egg-info/` 不会进入任一镜像，仅轻微增大根目录构建上下文；server 包上下文瘦身（`COPY packages/server/` 不再携带 python 目录）已达成，本项为锦上添花。
- Successor Required: `no`
- Reopen Trigger: 若构建上下文体积或镜像层出现可测的回归，或新包开始 COPY 整个 `packages/vision-proxy/` 目录时再补充。

## Closure

Status Note: 提取已完整落地并通过仓库级与 Docker 验证；独立 closure audit 复核通过后关闭。

Closure Audit Evidence:

- Reviewer / Agent: 独立 subagent（闭包复核，task `ses_fed149d4effeee7bp8ZRrrYJts`）
- Evidence: 首轮 VERDICT reject closure——唯一阻塞为日志文件缺失（Phase 5 目标 `docs/logs/2026/08-18-extract-vision-proxy-package.md` 未创建，closure gate「log all agree」被提前勾选）；其余 6 项验证全部 PASS、无 scope 泄漏、历史文档未改动、Deferred 项均正确非阻塞。日志已补齐后复核通过（见下）。
- 复核：日志文件已创建并含实施摘要/决策/验证结果；cold-replay 重查 plan 状态、阶段状态、退出标准、closure gates、testing 文档、log 全部一致后 VERDICT approve closure。

Follow-up:

- 用户将 `packages/server/.env` 中密钥迁移到 `packages/vision-proxy/.env`（README 已指引；触发条件见 Deferred 项）。