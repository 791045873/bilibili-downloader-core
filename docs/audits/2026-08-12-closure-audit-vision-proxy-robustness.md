# Closure Audit — Vision Proxy 服务健壮性改进

- 计划：`docs/plans/2026-08-12-vision-proxy-robustness-plan.md`
- 计划审计：`docs/audits/2026-08-12-plan-audit-vision-proxy-robustness.md`（passed）
- 审计日期：2026-08-12
- 审计方式：独立 subagent（冷启动，task `ses_009509cdbffe2GThDpLZc5mP4B`），对照 live 代码、计划、docs 与验证证据

## 结论

`approved`

## 代码核查（全部通过）

- `qwen_vision_proxy.py`：body 上限前置判定（缺失/非法 `Content-Length` → 400，超限 → 413，负值 → 400）；socket 超时类属性（经 `StreamRequestHandler.setup` 生效）；模块级 `BoundedSemaphore` 门控在 `do_GET`/`do_POST`（`_acquire_slot`），503 + `close_connection=True`，`finally` 释放，无泄漏/双释放；`safe_send_json` 捕获 `OSError`，所有发送路径（503/404/400/413/500/200）均走安全写，裸 `send_json` 仅被 `safe_send_json` 调用；`address_string` 仅返回 IP；`GET /healthz` 不触发 DashScope。
- `start-vision-proxy.mjs`：退避 1s→30s 上限、≥60s 稳定重置；`NO_RESTART` 守卫；SIGINT/SIGTERM kill 子进程不重启并退出；spawn 失败 + NO_RESTART 场景补 `process.exit(1)`（闭核算建议，已落地）。
- `qwen-client.ts`：`fetchWithTimeout`（AbortController + setTimeout，`finally` 清定时器）；超时错误含端点与毫秒数；默认 `?? 600000` 客户端兜底，仅作用于代理路径。
- 两处 `getLlmConfig` 均读取 `QWEN_VISION_PROXY_TIMEOUT_MS` 并经 `parseVisionProxyTimeoutMs` 校验为正整数。

## 文档对齐（通过）

- 架构基线环境变量清单含五个新变量与 `/healthz` 说明；codebase-map Vision Proxy 行更新为 2026-08-12；log 有实施记录；analysis source 存在；计划 Audit 段 passed 且与审计文件一致；测试文档含 12 个方向。

## 验证与测试方向

- `pnpm typecheck`、`pnpm build`、`node --check scripts/start-vision-proxy.mjs`、venv `python -m py_compile` 全部通过（闭核算重跑了后两项）。
- 运行级证据：/healthz 200；超大 body 413；非法/缺失 Content-Length 400；并发占满 503；异常后服务存活；杀进程自动拉起；Node 超时 1200ms 精确抛错。
- 方向 1/10（真实 DashScope 成功链路）依赖有效 key 与本地媒体文件，测试文档已标注留用户手动验证；其余 10 个方向静态+运行级覆盖。

## 非阻断建议（均已按情况处理）

1. 负值 Content-Length 防护 → 已加 400 守卫。
2. `fetchWithTimeout` 不含 `response.json()` body 读取窗口 → 记为 Deferred（watch-only，触发条件已写明）。
3. spawn 失败 + `NO_RESTART=1` 静默挂起 → 已补 `process.exit(1)`。

## 最终状态

计划标记 `completed`；所有 Closure Gates 已勾选；Closure 段记录本审计证据；log 的"已关闭"表述自此准确。
