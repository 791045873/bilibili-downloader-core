# 2026-08-13 生产环境文件日志（Node + Python 双落盘）

> Plan Status: completed
> Last Reviewed: 2026-08-13
> Source: 用户需求——Node（NestJS）服务与 Python（qwen_vision_proxy）服务的日志除终端输出外，在生产环境运行时需进入对应日志文件
> Related: `docs/plans/2026-08-11-vision-proxy-python-best-practice.md`（Python logging 引入）、`docs/plans/2026-08-12-vision-proxy-robustness-plan.md`、`docs/discussions/2026-08-13-production-file-logging.md`（需求澄清 + human 授权记录）
> Audit: required（独立 subagent；reviewer availability = none）
> Protected area: `deployment`（ask-first）——本计划改动 `packages/docker/Dockerfile`（`ENV LOG_DIR`），需 human 授权 + owner doc + Dockerfile 验证。授权记录见 `docs/discussions/2026-08-13-production-file-logging.md`；owner doc 对齐见 Phase 5（`docs/design/app-overview.md`）。
> Testing: `docs/testing/2026/08-13-production-file-logging-testing.md`

## Current Baseline

- Node（`packages/server/src`）：全部日志走 NestJS 内置 `Logger`（`@nestjs/common`），14 个文件（13 个 `new Logger(Xxx.name)` + `main.ts:11` 的 `new Logger("Bootstrap")`）以 `logger.log/warn/error` 输出；`main.ts` 直接 `NestFactory.create(AppModule)`，无 `useLogger`，无任何文件传输，输出仅到 stdout/stderr。
- Python（`packages/server/python/qwen_vision_proxy.py`）：`logging.basicConfig(..., stream=sys.stderr)`（仅终端），无文件 handler；由 `scripts/start-vision-proxy.mjs` 以 `stdio: "inherit"` 拉起。
- 生产运行：Docker `CMD node packages/server/dist/main.js`（stdout 由容器采集，不落宿主机文件）；`pnpm start:prod` = `node --env-file=.env dist/main`；视觉代理独立于 Docker，跑在宿主/NAS。
- 日志内容已统一走 `packages/server/src/logging/server-log.util.ts` 的 `createLogMessage` 安全裁剪（allowlist + 截断）。

## Goals

- 以环境变量 `LOG_DIR` 为开关：**未设置 → 行为不变（仅终端）**；**设置后 → 终端 + 文件双写**。
- Node：新增自定义 logger（继承 Nest `ConsoleLogger`），`super.*()` 保留终端输出，同时追加写文件；`main.ts` 用 `app.useLogger(...)` 装配（Nest 的 `Logger.overrideLogger` 经 `localInstance` getter 覆盖后续 `new Logger(context)` 实例），14 个文件的 `logger.*` 调用零改动。
- 文件轮转：Node 用 `rotating-file-stream`（新增 runtime 依赖）按天轮转；Python 用标准库 `logging.handlers.TimedRotatingFileHandler`（`when="midnight"`）按天轮转。
- 文件命名（每天一个文件）：Node 活动文件 `server-YYYY-MM-DD.log`（rotating-file-stream 文件名生成函数实现，跨天自动切换新文件）；Python 活动文件 `vision-proxy.log` + 轮转后 `vision-proxy.log.YYYY-MM-DD`（TimedRotatingFileHandler 默认行为，活动文件名固定）。保留最近 7 天，可配置。
- 文件日志级别与终端一致（全量 log/warn/error/debug）。
- Docker：`packages/docker/Dockerfile` 增加 `ENV LOG_DIR=/download/logs`，复用已挂载的下载卷，`docker:run` 零改动。

## Non-Goals

- 不改现有 `logger.*` 调用、日志级别、日志文本格式（保持现状文本格式，不引入结构化 JSON）。
- 不引入 winston / pino / nestjs-pino（选择更轻量的自定义 `ConsoleLogger` + `rotating-file-stream`）。
- 不改变视觉代理「独立于 Docker 运行」的现有架构；不把 Python 依赖打进 Docker 镜像。
- 不新增日志级别过滤或采样（用户已选「全量」）。
- 不把日志写进数据库或远程收集服务（如 ELK/云日志）。

## Infrastructure And Config Prereqs

- 新增环境变量：`LOG_DIR`（可选，触发开关 + 落盘目录）、`LOG_MAX_FILES`（可选，默认 7）。
- Node 新增 runtime 依赖：`rotating-file-stream`（server 包）。Python 无新依赖（`TimedRotatingFileHandler` 为标准库）。
- 新增 Node 源码文件：`packages/server/src/logging/file-logger.ts`。

## Execution Plan

### Phase 1 - Node 文件 logger（`packages/server/src/logging/file-logger.ts`）

Status: completed
Targets: `packages/server/src/logging/file-logger.ts`, `packages/server/package.json`

- Item Types: `Add | Decision | Proof`
- Prereqs: 无

- [x] `Add`: `FileConsoleLogger extends ConsoleLogger`，重写 `log/error/warn/debug/verbose`（并覆盖 `fatal` 以防未来使用）：先 `super.*()`（保留终端），再按当前日期把格式化后的同一条消息追加写文件。`error` 分支不把任意 `optionalParams`（如原始 body）原样落盘，只落经 `createLogMessage` 的 message 与 `err.stack`。
- [x] `Add`: 用 `rotating-file-stream` 创建按天轮转写流：`mkdir -p LOG_DIR`（该库不自动建目录）；文件名用自定义生成函数 `(time) => server-YYYY-MM-DD.log`（含 `time === null` 兜底为当前日期），`interval: "1d"`，`maxFiles` 取 `LOG_MAX_FILES` 默认 7；`LOG_DIR` 未设置时**不创建写流**（空操作，行为不变）。
- [x] `Add`: `packages/server/package.json` 依赖新增 `rotating-file-stream`。
- [x] `Decision`: 轮转方案与命名（记录于 Decision 节）。
- [x] `Proof`: `pnpm typecheck`、`pnpm build`；运行级冒烟（见 Testing）。

### Phase 2 - 装配（`packages/server/src/main.ts`）

Status: completed
Targets: `packages/server/src/main.ts`

- [x] `Add`: `app.useLogger(new FileConsoleLogger())`（`NestFactory.create(AppModule)` 保持现状，**不加 `bufferLogs`**，避免异步 listen 失败如 EADDRINUSE 时缓冲日志不 flush 导致启动错误提示丢失）。
- [x] `Add`: `Bootstrap` 的 `logger`（`main.ts:11`）无需替换——`localInstance` getter 在 `useLogger` 后动态返回 override 实例。
- [x] `Proof`: 启动 + 触发请求/错误，确认终端与文件均出现日志；`LOG_DIR` 未设置时行为与现状一致。

### Phase 3 - Python 文件 handler（`packages/server/python/qwen_vision_proxy.py`）

Status: completed
Targets: `packages/server/python/qwen_vision_proxy.py`

- [x] `Add`: `__main__` 中保留 `basicConfig`（终端）；若 `LOG_DIR` 存在，`mkdir` 该目录并给 logger 追加 `TimedRotatingFileHandler`（`when="midnight"`，`backupCount` 取 `LOG_MAX_FILES` 默认 7，活动文件名 `vision-proxy.log`、轮转后 `vision-proxy.log.YYYY-MM-DD`，编码 utf-8）。
- [x] `Proof`: venv `python -m py_compile`；运行级冒烟（请求 + 异常，确认文件生成与轮转）。

### Phase 4 - Docker 落盘位置（`packages/docker/Dockerfile`）

Status: completed
Targets: `packages/docker/Dockerfile`

- [x] `Add`: `ENV LOG_DIR=/download/logs`（复用已挂载卷），并在 Dockerfile 增加 `RUN mkdir -p /download/logs`（rotating-file-stream 不自动建目录）。
- [x] `Proof`: `pnpm docker:build` + 运行冒烟，确认 `/download/logs/server-*.log` 生成。

### Phase 5 - 文档对齐

Status: completed
Targets: `docs/context/codebase-map.md`, `docs/architecture/2026-07-06-video-analysis-baseline.md`, `docs/design/app-overview.md`, `docs/logs/2026/08-13.md`, `docs/testing/2026/08-13-production-file-logging-testing.md`

- [x] `Add`: 在 server 可观测性相关文档补充「`LOG_DIR` 开启文件日志、按天轮转、命名约定」的说明。
- [x] `Add`: `docs/design/app-overview.md` 的 Docker surface 对齐：补充 `LOG_DIR`/`LOG_MAX_FILES` 环境变量与日志落盘位置 `/download/logs`（deployment owner doc 证据）。
- [x] `Add`: `docs/testing/2026/08-13-production-file-logging-testing.md`。
- [x] `Add`: `docs/logs/2026/08-13.md` 追加记录。

## Exit Criteria

- [x] 未设置 `LOG_DIR` 时 Node/Python 行为与现状完全一致（仅终端，无文件生成）。运行级确认：不设 `LOG_DIR` 启动 server 请求 200 后无任何 `.log` 文件。
- [x] 设置 `LOG_DIR` 后 Node/Python 终端输出不变，且分别生成 `server-YYYY-MM-DD.log` / `vision-proxy.log`（轮转后 `vision-proxy.log.YYYY-MM-DD`）。运行级确认：Node 生成 `server-2026-08-13.log`（含启动/请求/WARN），Python 生成 `vision-proxy.log`（含启动横幅/请求行/异常 traceback）。
- [x] 每天轮转一次，保留最近 7 天（`LOG_MAX_FILES` 可覆盖）。逻辑级确认：`rotating-file-stream` `interval:"1d"` + `maxFiles`、`TimedRotatingFileHandler(when="midnight", backupCount)` 配置正确。
- [x] 14 个文件的 `logger.*` 调用零改动；`main.ts` 仅装配层改动。`git diff` 确认 `main.ts` 仅加 import + `useLogger`。
- [x] 文件日志内容仍走 `createLogMessage` 安全裁剪，无 body/密钥泄漏。运行级确认：日志文件不含 `.env` 中 4 组密钥。
- [x] `pnpm typecheck`、`pnpm build` 通过；venv `python -m py_compile` 通过。
- [x] `pnpm docker:build` 通过，运行后 `/download/logs/server-*.log` 生成。**部分受阻**：本机 `docker:build` 失败于既有 `apk add ffmpeg` 基础镜像问题（与本次改动无关，见 testing 文档裁定），Dockerfile 改动经 diff/语法审查有效。
- [x] `docs/testing/2026/08-13-production-file-logging-testing.md` 所有方向均已确认或明确裁定。

## Plan Audit

- Status: passed
- Reviewer / Agent: 独立 subagent（reviewer availability = none）
- Evidence: task `ses_005d87235ffeHRqaCjq5H3MfbK`（首轮 `needs revision` → 修订 B1/B2/B3 → 复核轮 `approved`）；审计文件 `docs/audits/2026-08-13-plan-audit-production-file-logging.md`

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck`、`pnpm build`、venv `python -m py_compile`、`pnpm docker:build`、运行级冒烟）
- [x] `docs/testing/2026/08-13-production-file-logging-testing.md` exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan exception not applicable（跨 Node/Python/Docker、涉部署改动，full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（subagent 复核）
- [x] closure evidence exists in files

## Decision

### 轮转与命名

- 选择：Node 用 `rotating-file-stream`（`interval: "1d"` + 文件名生成函数）按天轮转，活动文件 `server-YYYY-MM-DD.log`；Python 用标准库 `TimedRotatingFileHandler`（`when="midnight"`），活动文件 `vision-proxy.log` + 轮转后 `vision-proxy.log.YYYY-MM-DD`（TimedRotatingFileHandler 活动文件名恒等于 baseFilename，无法内嵌日期，故接受固定活动名 + 日期后缀）。保留最近 7 天（`LOG_MAX_FILES` 可覆盖）。
- 备选：(a) 手写日期切分——零依赖但需自处理跨零点切换/进程重启接续/旧文件清理，易漏边界；(b) 按大小轮转——用户明确要求按天；(c) winston/pino——功能强但需改全部 logger 注入或加较重依赖，超出「双落盘」诉求；(d) Python 用自定义 `namer` 得到 `vision-proxy-YYYY-MM-DD.log`——可做但增加实现复杂度，且活动文件仍固定，收益有限。
- 残余风险：全量日志（含每请求访问日志）文件增长较快，7 天保留 + 每天轮转可接受；`rotating-file-stream` 新增一个轻量 runtime 依赖（当前未在 pnpm-lock，实施时需确认可用版本，预期无传递依赖）。

### 开关变量

- 选择：`LOG_DIR` 作为显式开关（设置即启用文件日志），而非复用 `NODE_ENV=production`。理由：显式、不污染开发环境，且 Node/Python 共用一套语义。

### 安全

- 文件日志复用 `createLogMessage` 安全裁剪链；`FileConsoleLogger.error` 重写只落经 `createLogMessage` 的 message 与 `err.stack`，不把任意 `optionalParams`（如原始 request body、环境变量含 `.env` 密钥）原样落盘。实施时需人工确认无密钥泄漏。

## Deferred But Adjudicated

### 日志级别过滤 / 采样 / 远程收集

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 用户已明确选择「全量、仅文件双写」；级别过滤、采样、远程日志收集属后续独立需求。
- Successor Required: `no`

## Closure

Status Note: 全计划已完成。Plan audit 独立 subagent 首轮 `needs revision`（B1/B2/B3）→ 修订后复核 `approved`；闭核算独立 subagent `approved`。代码、文档、验证、testing 方向五方一致；`docker:build` 因既有 ffmpeg 基础镜像问题在本机受阻，与本次改动无关，已在 testing 文档明确裁定。

Closure Audit Evidence:

- Reviewer / Agent: 独立 subagent，task `ses_0059c1354ffeesBI8XgQpF1B1d`
- Evidence: `docs/audits/2026-08-13-closure-audit-production-file-logging.md`

Follow-up:

- 无（非阻塞 follow-up 仅见 Deferred 段；docker:build 容器级冒烟待 ffmpeg 基础镜像问题修复后由用户手动执行，见 testing 文档方向 6 裁定）。
