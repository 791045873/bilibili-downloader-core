# Plan: Vision Proxy Python 依赖与代码最佳实践改进

日期：2026-08-11
状态：completed（2026-08-11 独立闭核算 PASS-WITH-NOTES，仅补日志与状态标记，均已落地）

## 背景与动机

`packages/server/python/` 当前存在三项偏离 Python 最佳实践的现状：

1. 依赖用 `requirements.txt` + `>=` 区间，版本不可复现。
2. 直接 `pip install` 进全局 Python，无虚拟环境隔离。
3. `qwen_vision_proxy.py` 无任何日志（`log_message` 被禁用），排障依赖猜。

目标：引入 venv 隔离 + `pyproject.toml` 锁定版本 + logging，同时保持 Node 编排侧调用契约（HTTP 接口、端口、`QWEN_VISION_PROXY_URL`）完全不变。

## 工具选择

- 本机未安装 uv / poetry / rye，不引入新工具链。采用标准库 `python -m venv` + pip + `pyproject.toml`（setuptools 后端，空包仅装依赖）。
- 版本锁定为精确版本，取自当前已安装的可用版本：`dashscope==1.26.6`、`python-dotenv==1.2.2`。

## Scope（实施项）

1. 新建 `packages/server/python/pyproject.toml`（setuptools build 后端、`packages = []`、锁定依赖、`requires-python >= 3.10`）；删除 `packages/server/python/requirements.txt`。
2. `scripts/setup-vision-proxy.mjs` 改造：
   - 探测系统 Python（沿用现有候选顺序）。
   - 缺失 `.venv` 时 `python -m venv` 创建（目录 `packages/server/python/.venv`，已被 .gitignore 忽略）。
   - 幂等检查改为基于 venv Python 的依赖导入探测（postinstall 静默跳过），不再每次跑 pip。
   - 安装命令改为在 `packages/server/python/` 目录下用 venv Python 执行 `pip install .`（从 pyproject.toml 安装）。
   - 依赖解析从 requirements.txt 改为解析 pyproject.toml `[project].dependencies`。
3. 新增 `scripts/start-vision-proxy.mjs`：优先使用 venv Python，缺失时回退系统 Python，spawn `qwen_vision_proxy.py`（stdio inherit）。
4. `packages/server/package.json`：`start:vision-proxy` 改为 `node ../../scripts/start-vision-proxy.mjs`（pnpm 以包目录为 CWD，`../..` 回到仓库根）。
5. `packages/server/python/qwen_vision_proxy.py`：引入 `logging`（stderr），`log_message` 恢复为记录请求，异常处 `logger.exception` 保留 traceback，启动横幅改由 logger 输出；HTTP 行为与返回体不变。`missing_dependency_exit`（第 21-26 行）的修复提示同步更新：`requirements.txt` 改为 `pyproject.toml`，指引仍指向 `pnpm setup:vision-proxy`。
6. 文档同步：
   - `README.md`：`requirements.txt` 表述改为 `pyproject.toml` + venv，命令说明更新。
   - `docs/architecture/2026-07-06-video-analysis-baseline.md`：目录树中的 `requirements.txt` 改为 `pyproject.toml`。
   - `docs/context/codebase-map.md`：Vision Proxy 行更新验证日期。
   - `docs/logs/2026/08-11.md`：追加实施记录。
7. `.gitignore`：补充 `*.egg-info/` 与 `build/`（`pip install .` 的 setuptools 残留，首装即会产生）。

## 明确不做

- 不引入 uv/poetry/pip-tools。
- 不改变 HTTP 契约、端口、环境变量名、Node 编排侧任何调用。
- 不触碰 Docker 部署（grep 确认 docker 包无 Python 引用）。

## 验证命令

- `pnpm setup:vision-proxy`：首次成功创建 venv 并安装；二次运行幂等跳过。
- `pnpm setup:vision-proxy --postinstall`：静默 exit 0。
- `.venv` 内 `python -c "import dashscope, dotenv"` 通过；全局 Python 未新增安装（安装目标隔离在 venv）。
- `pnpm --filter @bilibili-downloader/server start:vision-proxy`：按真实用户路径启动，监听 127.0.0.1:8765，请求日志输出到 stderr。
- `pnpm --filter @bilibili-downloader/server typecheck`：通过（TS 编译，不校验 script 引用；脚本引用以实际执行验证）。
- `node --check scripts/setup-vision-proxy.mjs` 与 `node --check scripts/start-vision-proxy.mjs`：分别语法校验。
- `git status`：无 `.venv/`、`__pycache__/`、`*.egg-info/`、`build/` 进入暂存区。

## 风险与退出标准

- venv 创建或 `pip install .` 失败：保留现有"跳过/警告"式软失败语义（postinstall 不阻断，手动命令以非 0 退出）。
- `qwen_vision_proxy.py` 缺少依赖时启动提示信息更新为新的安装指引（仍指向 `pnpm setup:vision-proxy`）。
- venv 解释器路径：Windows `.venv\Scripts\python.exe`，POSIX `.venv/bin/python`，launcher 按平台分支解析。
- 工作区已有与本计划无关的未提交改动（package.json 删除旧 `setup:vision-proxy`、setup 脚本幂等逻辑），实施与闭核算以 working tree 为基线。

## Audit

Audit: 待独立 subagent 计划审计（reviewer 不可用，采用独立 subagent 复核；非受保护区、非高风险）。闭核算同样由独立 subagent 执行。
