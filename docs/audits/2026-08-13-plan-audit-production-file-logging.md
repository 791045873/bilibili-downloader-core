# Plan Audit — 生产环境文件日志（Node + Python 双落盘）

- 计划：`docs/plans/2026-08-13-production-file-logging-plan.md`
- 来源：用户需求——Node 与 Python 服务日志除终端外，生产环境落盘文件
- 审计日期：2026-08-13
- 审计方式：独立 subagent 两轮（冷启动）
  - 首轮 task `ses_005d87235ffeHRqaCjq5H3MfbK`：对照 live 代码 + node_modules 源码全量复核
  - 复核轮同 task（resume）：仅复核修订后的阻断项与非阻断建议吸收情况

## 首轮审计结论

`needs revision`

### 阻断问题

1. **B1 — `bufferLogs: true` 引入启动失败日志丢失回归**：`Logger.localInstance`（`@nestjs/common` logger.service.js:35-46）在 `staticInstanceRef` 为 `ConsoleLogger` 子类时直接返回 override 实例，`useLogger` 已足够覆盖 14 个文件，无需 `bufferLogs`；且 `bufferLogs` 仅调用 `Logger.attachBuffer()`，flush 只发生在 listen 成功回调或同步异常，`EADDRINUSE` 为异步 error 事件不触发 flush，会导致 `main.ts:48-58` 现有启动错误提示（含 EADDRINUSE）静默丢失。
2. **B2 — Python 静态 `TimedRotatingFileHandler` 无法实现 `vision-proxy-YYYY-MM-DD.log`**：活动文件名恒等于 `baseFilename`，跨零点把当前文件重命名为 `baseFilename + "." + time.strftime(suffix)`，活动文件不内嵌日期；代理是 `serve_forever` 长进程不重启。
3. **B3 — deployment 受保护区证据不完整**：policy 要求 `owner doc + Dockerfile 验证`，仓库无 deployment owner doc，授权无持久记录，Phase 5 未更新 `app-overview.md`。

### 非阻断建议（均已吸收）

- N1 `rotating-file-stream` 不自动建目录，需补 `mkdir`。
- N2 `server-YYYY-MM-DD.log` 需自定义文件名生成函数，处理 `time === null`。
- N3 实际仅 `log/warn/error` 被调用，`debug/verbose/fatal` 为 0，建议仍覆盖全方法。
- N4 `rotating-file-stream` 未在 pnpm-lock，实施时确认版本。
- N5 14 文件为 13×`Xxx.name` + 1×`"Bootstrap"`。
- N6 `error` 重写避免把任意 `optionalParams` 原样落盘。

## 事实核查（首轮通过）

- Baseline 准确：`main.ts:14` 直接 `NestFactory.create`、无 useLogger；14 文件 `new Logger(...)`；`server-log.util.ts:66` 提供 `createLogMessage` 安全裁剪。
- 机制主张成立但 bufferLogs 有缺陷（即 B1）；继承 `ConsoleLogger` 正确（logger.service.js:132-136 禁止 extends Logger）。
- Python `when="midnight"` + `backupCount` 语义正确，与 `basicConfig(stream=sys.stderr)` 双写可行，`logger.exception` traceback 会进文件。
- Dockerfile `ENV OUTPUT_DIR=/download` + `RUN mkdir -p /download` + `docker:run` 挂载 `/download` 成立，`ENV LOG_DIR=/download/logs` 复用卷、零改动成立。
- 安全链路成立（日志统一走 `createLogMessage`）。

## 复核轮结论

`approved`（三处阻断均已消解，非阻断建议全部吸收，无残留阻断项）。

## 关闭审计

本计划尚未实施；closure audit 将在计划关闭时另行独立执行（证据另行归档）。
