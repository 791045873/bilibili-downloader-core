# 2026-08-13 生产环境文件日志（Node + Python 双落盘）— 测试方向

关联计划：`docs/plans/2026-08-13-production-file-logging-plan.md`

本文件描述 `LOG_DIR` 文件日志能力应观察到的需求级状态与反状态，供计划验证与闭核算使用。验证命令：`pnpm typecheck`、`pnpm build`、venv `python -m py_compile`、`pnpm docker:build` + 下述运行级观测。

## 1. 未设置 `LOG_DIR` 行为不变

**应成立:**

- 不设置 `LOG_DIR` 时，Node 启动无文件生成，终端日志与现状一致。
- 不设置 `LOG_DIR` 时，Python 薄代理启动无文件生成，stderr 日志与现状一致。

**不应成立:**

- 默认开启文件日志；创建 `LOG_DIR` 目录或任何 `server-*.log` / `vision-proxy.log`。

## 2. Node 文件日志生成

**应成立:**

- 设置 `LOG_DIR=<dir>` 启动 Node，发起正常请求与错误请求后，`<dir>/server-YYYY-MM-DD.log`（当天）生成且包含 `HTTP request started/completed/failed` 等日志。
- 文件内容与终端同一条日志一致（含 context），但为纯文本（无 ANSI 颜色）。
- 终端输出保持现状（不受影响）。

**不应成立:**

- 文件为空；文件只有终端输出的一部分；日志乱码或缺失 context。

## 3. Node 错误日志含 stack

**应成立:**

- 触发服务端异常（如对不存在的路由发请求返回 404，或内部错误）时，文件日志的 `ERROR` 行包含错误 message，`error(err, stack)` 调用点的 stack 追加在消息后。

**不应成立:**

- 原始 request body 或 `.env` 密钥写入文件（安全裁剪被绕过）。

## 4. Python 文件日志生成与轮转

**应成立:**

- 设置 `LOG_DIR=<dir>` 启动薄代理，请求 `/healthz` 与 `/v1/chat/completions`（可构造 404/400 触发错误）后，`<dir>/vision-proxy.log` 生成且包含请求行、异常 traceback。
- 终端 stderr 输出保持现状。

**不应成立:**

- `vision-proxy.log` 未生成；文件缺少 traceback；终端日志消失。

## 5. 跨天轮转与保留

**应成立（逻辑级）:**

- Node 侧 `rotating-file-stream` 配置 `interval: "1d"` + `maxFiles`（`LOG_MAX_FILES`，默认 7）：跨天时活动文件名切换为 `server-<新日期>.log`，历史文件按 `maxFiles` 清理。
- Python 侧 `TimedRotatingFileHandler(when="midnight", backupCount=7)`：跨天时把 `vision-proxy.log` 轮转为 `vision-proxy.log.YYYY-MM-DD`，保留最近 `backupCount` 个历史文件。

**不应成立:**

- 无限增长不轮转；保留超过 `LOG_MAX_FILES` 天；活动文件未按天切换。

## 6. Docker 落盘

**应成立:**

- `pnpm docker:build` 成功；容器内 `LOG_DIR=/download/logs`，运行后挂载卷中出现 `/download/logs/server-YYYY-MM-DD.log`。
- `docker:run` 命令零改动（仍挂载 `$HOME/...:/download`）。

**不应成立:**

- 容器启动报 `LOG_DIR` 目录不存在/无权限；日志落在容器非挂载目录导致重启丢失。

**裁定（2026-08-13 验证）：** `docker:build` 在本机失败于既有问题，与本次 `ENV LOG_DIR`/`mkdir` 改动无关（diff 确认 Dockerfile 仅新增这两行）。失败点两次验证不一致：首轮失败于 `node:22-alpine` 基础镜像 `apk add --no-cache ffmpeg`（Dockerfile:30）Alpine v3.24 仓库解析 ffmpeg 8.1.2 动态库依赖失败（`unable to select packages`，exit 69）；干净环境复现则先失败于 `pnpm install --frozen-lockfile`（Dockerfile:20）better-sqlite3 缺 Python。两处均发生在本次改动的 `ENV LOG_DIR`/`mkdir` 之前的既有步骤。Dockerfile 改动经语法与 diff 审查有效；完整容器冒烟需在 ffmpeg 基础镜像问题修复后由用户手动执行。

## 运行级观测方式

- Node：`LOG_DIR=./logs pnpm --filter @bilibili-downloader/server start:dev`（或构建后 `LOG_DIR=./logs node packages/server/dist/main.js`），`curl` 正常路由 + 错误路由，检查 `./logs/server-*.log`。
- Python：`LOG_DIR=./logs .venv\Scripts\python.exe packages\server\python\qwen_vision_proxy.py`，`curl /healthz` + 一个 404/400 请求，检查 `./logs/vision-proxy.log`。
- 安全：检查日志文件无 API key / 密钥 / 原始 body。
- 轮转：逻辑级代码检查 + 可选 `interval` 改小（如 `1h` 或 `1s`）临时验证切换与清理，验证后还原为 `1d`。
- Docker：`pnpm docker:build` 后运行容器，`docker exec` 查看 `/download/logs`。
