# 2026-08-18 提取 Python 视觉代理为独立子包测试验证

关联计划：`docs/plans/2026-08-18-extract-vision-proxy-package-plan.md`

## 验证范围

本测试文档描述将视觉代理从 `packages/server/python/` 提取为 `packages/vision-proxy/` 独立子包后应保持的可观察状态。本次变更不引入任何用户可见的 Docker 部署行为变化，重点是仓库结构、开发模式代理可用性、env 归属与镜像职责的稳定。

## 前提

- 本机可运行 `pnpm` 与 `docker compose`（v2+）；存在可用 Python 解释器用于重建 venv。
- 开发模式无 `packages/vision-proxy/.env` 时，代理应能启动且 `/healthz` 200（无 key 仅影响真实 DashScope 调用）。
- `packages/server/.env` 中的密钥不参与本验证（gitignored，迁移由用户按 README 指引自行处理）。

## 测试方向

### 目录迁移与 workspace 子包

- [x] 应成立：`packages/server/python/` 目录完全移除；`packages/vision-proxy/` 存在且含 `pyproject.toml`、`qwen_vision_proxy.py`、`package.json` 三个文件。
- [x] 应成立：`pnpm install` 后 `pnpm-lock.yaml` 包含 `packages/vision-proxy` importer；再次 `pnpm install --frozen-lockfile` 不报锁文件失步。
- [x] 应成立：`pnpm -r build` 与 `pnpm -r typecheck` 正常通过（vision-proxy 无对应脚本被自动跳过，不报错）。
- [x] 不应成立：`packages/server/` 下残留任何 python 目录或 Python 源文件。

### 开发模式代理可用性

- [x] 应成立：从仓库根运行 `pnpm setup:vision-proxy` 在 `packages/vision-proxy/.venv` 创建虚拟环境并安装 `dashscope`、`python-dotenv`（锁定版本）；重复执行幂等（依赖已就绪即跳过）。
- [x] 应成立：`pnpm --filter @bilibili-downloader/server start:vision-proxy` 可拉起代理，`GET http://127.0.0.1:8765/healthz` 返回 200 `{"status":"ok"}`；无 `packages/vision-proxy/.env` 时行为相同。
- [x] 应成立：`qwen_vision_proxy.py` 的 `load_dotenv` 指向 `packages/vision-proxy/.env`（代码审查），不再读取 `packages/server/.env`。
- [x] 不应成立：启动命令因缺少 `packages/vision-proxy/.env` 而失败或打印密钥缺失误导。

### Docker 镜像职责稳定

- [x] 应成立：`docker compose config` 校验通过；`pnpm docker:build` 构建出 `bilibili-downloader`（server）与 `bilibili-downloader:vision-proxy` 两镜像（`--frozen-lockfile` 依赖更新后的 lockfile）。
- [x] 应成立：server 镜像内不存在 python、`/opt/vision-venv`、`qwen_vision_proxy.py`、`/app/python`（与双容器拆分基线一致）。
- [x] 应成立：vision-proxy 镜像内 `/app/python/qwen_vision_proxy.py` 存在，`/opt/vision-venv/bin/python` 可导入 `dashscope`、`dotenv`；`command -v node` 无结果。
- [x] 不应成立：`packages/docker/Dockerfile` 或 compose 中出现对 `packages/server/python` 的引用；server 构建阶段不再执行 `rm -rf /app/python`。

### 文档与引用一致性

- [x] 应成立：活动文档（README、codebase-map、module-boundaries、video-analysis-baseline、project-context）中的代理路径均为 `packages/vision-proxy/`，env 归属说明一致。
- [x] 不应成立：除历史 plan/log/audit 留档与本次讨论/测试/计划文档外，仓库中残留 `packages/server/python` 引用（grep 校验）。

### 范围外裁定

- [x] 已裁定：真实 DashScope 模型调用（AI 总结端到端）——需用户密钥 + 外部网络，不执行；`/healthz` 与无 key 启动路径已覆盖。
- [x] 已裁定：`packages/server/.env` 密钥自动迁移到 `packages/vision-proxy/.env`——gitignored 本地密钥文件，仅 README 指引，不自动搬运（对应计划 Deferred 项，reopen 条件见计划）。
- [x] 已裁定：`setup`/`start` 脚本实体迁入 vision-proxy 包内——本期仅委托根目录脚本，为优化候选（对应计划 Deferred 项）。

## 结果

### 通过

- [x] 目录迁移：`git mv` 后 `packages/server/python` 完全移除（旧 `.venv` 被开发代理进程占用，终止 watcher 进程树后删除）；`packages/vision-proxy/` 含 `pyproject.toml`、`qwen_vision_proxy.py`、`package.json`。
- [x] workspace 子包：`pnpm install` 后 `pnpm-lock.yaml` 新增 `packages/vision-proxy: {}` importer（diff 2 行）；`pnpm typecheck`/`pnpm build` 均为 "Scope: 7 of 8 workspace projects"，vision-proxy 无对应脚本被跳过，全部 exit 0。
- [x] 开发模式：`pnpm setup:vision-proxy` 创建 `packages/vision-proxy/.venv`（dashscope-1.26.6、python-dotenv-1.2.2 锁定版本），重复执行输出"依赖已就绪，无需重新安装"（幂等）；`start-vision-proxy` 拉起后 `GET http://127.0.0.1:8765/healthz` → 200 `{"status":"ok"}`（无 `.env`）。
- [x] env 归属：`qwen_vision_proxy.py` 已改为 `PROXY_DIR = Path(__file__).resolve().parent` + `load_dotenv(PROXY_DIR / ".env")`，无 `parents[1]`/`SERVER_DIR` 残留。
- [x] 脚本/Dockerfile：`node --check` 两个脚本通过；grep 确认代码与配置（mjs/json/yaml/toml/ts/Dockerfile）无 `server/python` 残留；Dockerfile builder 阶段含 `COPY packages/vision-proxy/package.json packages/vision-proxy/`，server 阶段 RUN 仅保留 `mkdir -p` + better-sqlite3 冒烟。
- [x] Docker：`docker compose config` 校验通过；`pnpm docker:build` 构建出 `Image bilibili-downloader Built` 与 `Image bilibili-downloader:vision-proxy Built`。
- [x] 镜像内容：server 镜像 `command -v python3` 无结果、`/app/python` 与 `/opt/vision-venv` 不存在、`find /app` 无 `qwen_vision_proxy.py`，`/app/public/index.html` 存在；vision-proxy 镜像 `command -v node`/`npm` 无结果、`/app/python/qwen_vision_proxy.py` 存在、venv python 导入 dashscope/dotenv 成功。
- [x] 引用一致性：`server/python` 残留仅存在于历史留档（logs/plans/testing 的旧记录）与本批 discussion/plan/testing 文档的现状描述中；活动文档全部对齐。

### 明确裁定

- [x] 真实 DashScope 调用：需用户密钥 + 外部网络，超出本地冒烟范围；healthz 与无 key 路径已覆盖。
- [x] 密钥自动迁移：`packages/server/.env`（gitignored）未搬运，README 提供指引；不阻塞关闭。
- [x] 脚本实体迁入包内：本期 package.json 委托根目录脚本，优化候选，不阻塞关闭。

## 执行证据

- `git mv packages/server/python/{pyproject.toml,qwen_vision_proxy.py} packages/vision-proxy/`；`git status` 显示两条 rename。
- `pnpm install`：Scope 8 个 workspace projects；`pnpm-lock.yaml` diff 仅新增 `packages/vision-proxy: {}`。
- `pnpm typecheck` / `pnpm build`：exit 0（Scope: 7 of 8 workspace projects）。
- `pnpm setup:vision-proxy`（两次）：首次安装成功，二次"依赖已就绪，无需重新安装"；`node scripts/setup-vision-proxy.mjs --postinstall` exit 0。
- 冒烟：`VISION_PROXY_NO_RESTART=1` 下 `node ../../scripts/start-vision-proxy.mjs`（workdir packages/server）→ healthz 200 `{"status":"ok"}`；验证后清理孤儿 python 进程。
- `node --check scripts/setup-vision-proxy.mjs` 与 `node --check scripts/start-vision-proxy.mjs` 通过。
- `docker compose config --quiet` 通过；`pnpm docker:build` 两镜像 Built。
- 镜像检查（docker run --entrypoint sh）：server 无 python/venv/`/app/python`/代理脚本，有 `/app/public/index.html`；vision-proxy 有 `/app/python/qwen_vision_proxy.py`、venv 导入 ok、无 node/npm。
- grep `server/python`：仅历史 docs 与本批文档，无活动代码/配置引用。