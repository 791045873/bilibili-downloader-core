# 2026-08-12 Vision Proxy 服务健壮性分析

来源：用户分析请求「server 包中的 Python 服务如何更健壮，是否存在一次异常后该服务再也无法调用」。

本文件是计划 `docs/plans/2026-08-12-vision-proxy-robustness-plan.md` 的 Source 支撑记录。

## 结论

- **单次请求异常不会让进程"再也无法调用"**：`qwen_vision_proxy.py` 的 `except Exception` 捕获 + `ThreadingMixIn.process_request_thread` 对每个请求独立 try/except/finally（`shutdown_request` 在 finally 中关闭连接），单请求异常只打日志、只关该连接，服务继续监听；每请求独立线程 + 独立 handler 实例，无共享可变状态。
- **但存在进程级不可用的真实风险**：
  1. 进程死亡无自动恢复：`start-vision-proxy.mjs` 裸 spawn，子进程退出即 `process.exit`，无重启、无健康检查。
  2. 无 body 上限 + 无 socket 超时 + 无并发上限：慢连接可无限占线程 → 线程/内存耗尽 → OOM 杀进程（需多次恶意请求，非一次）。
  3. except 分支内 `send_json` 写坏 socket 时二次异常逃逸（`BrokenPipeError`），该请求必失败，Node 侧无超时只能长等待。
  4. `address_string()` 每请求反向 DNS 解析可阻塞数秒。
- 一次异常后"再也无法调用"最可能的真实来源是 **进程死亡 + 无自愈**，而非单次 handler 异常。

## 改进方向（已落入计划）

1. Python 代理：body 上限（413）、非法 Content-Length（400）、socket 超时、模块级并发信号量（503）、`safe_send_json` 防二次逃逸、`address_string` 关闭反向 DNS、`GET /healthz`。
2. 启动自愈：`start-vision-proxy.mjs` 指数退避自动重启 + 优雅停止不重启 + `VISION_PROXY_NO_RESTART` 逃生门。
3. Node 侧端到端超时：`multimodalChat` 代理路径 AbortController 超时，默认在客户端兜底（覆盖 trigger 与手动分析两个调用面）。
4. 文档同步：架构基线环境变量清单、codebase-map、logs、testing。

## 关键不变量

- 视频文件由 Python SDK 本机读取并直传 DashScope，不经过代理 HTTP body；body 上限只约束配置 JSON（含字幕全文），与"通过 API 上传视频调大模型"不冲突。
- `/v1/chat/completions` 的 POST 行为与返回体、端口/主机默认值（127.0.0.1:8765）、既有环境变量语义保持不变。
