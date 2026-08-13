# Discussion — 生产环境文件日志（Node + Python 双落盘）

- 日期：2026-08-13
- 状态：已澄清，human 已授权（deployment 改动）
- 关联计划：`docs/plans/2026-08-13-production-file-logging-plan.md`

## 需求来源

用户（human）明确要求：Node（NestJS）服务与 Python（qwen_vision_proxy）服务的日志，除终端输出外，在生产环境运行时需进入对应的日志文件。

## 已澄清的决策（human 逐项确认）

1. **Node 实现方式**：自定义 `ConsoleLogger` 双写（继承 Nest `ConsoleLogger`，终端不变 + 文件追加写），而非引入 winston/pino。
2. **触发开关**：`LOG_DIR` 环境变量（设置才写文件，未设置行为不变），而非 `NODE_ENV=production`。
3. **文件日志级别**：全量（终端与文件一致，log/warn/error/debug）。
4. **Docker 落盘位置**：`/download/logs`（复用已挂载下载卷，`docker:run` 零改动）。
5. **轮转**：用库处理（Node `rotating-file-stream`、Python 标准库 `TimedRotatingFileHandler`），每天轮转一次，保留最近 7 天（`LOG_MAX_FILES` 可覆盖）。
6. **命名**：按推荐——Node `server-YYYY-MM-DD.log`；Python 活动文件 `vision-proxy.log` + 轮转后 `vision-proxy.log.YYYY-MM-DD`。

## deployment 受保护区授权

本需求涉及改动 `packages/docker/Dockerfile`（`ENV LOG_DIR=/download/logs` + `RUN mkdir -p /download/logs`），属 `deployment` protected area（ask-first）。

- human 已在对话中明确提出该需求并选择落盘位置 `/download/logs`，构成对本次 deployment 改动的授权。
- required evidence：owner doc 对齐（`docs/design/app-overview.md` 的 Docker surface，见计划 Phase 5）+ Dockerfile 验证（`pnpm docker:build` + 运行冒烟，见计划 Phase 4）。

## 未决 / 待办

- 无未决事项。计划已含三处阻断问题的修订（`bufferLogs` 回归、Python 命名方案、deployment 证据）。
