# 2026-08-12 Vision Proxy 服务健壮性 — 测试方向

关联计划：`docs/plans/2026-08-12-vision-proxy-robustness-plan.md`

本文件描述 Python 视觉薄代理健壮性改造后应观察到的需求级状态与反状态，供计划验证与闭核算使用。验证命令：`pnpm typecheck`、`pnpm build`、`node --check scripts/start-vision-proxy.mjs`、venv Python `-m py_compile`，叠加下述运行级观测。

## 1. 正常调用不回归

**应成立:**

- `/v1/chat/completions` 正常多模态请求（文本 + 本地路径 image/video）仍返回 200 + OpenAI 风格 body，行为与返回体与改造前一致。
- `GET /healthz` 返回 200，不触发 DashScope 调用。

**不应成立:**

- 正常请求被误拒（413/503/超时误杀）；视频文件上传（DashScope SDK 本机读取）因代理 body 上限被阻断。

## 2. 超大请求防护

**应成立:**

- 请求 `Content-Length` 超过上限时返回 413 JSON，服务继续可用。
- 超出上限的请求 body 不被读入内存（上限判定发生在读取前）。

**不应成立:**

- 超大 body 导致内存膨胀或进程 OOM。

## 3. 非法/缺失 Content-Length

**应成立:**

- 无 `Content-Length` 或值非数字时返回 400 JSON（含清晰错误），服务继续可用。

**不应成立:**

- 非法请求让进程崩溃或后续请求被污染。

## 4. 慢连接防护

**应成立:**

- 声明大 `Content-Length` 却慢速发送 body 的客户端，在 socket 超时后连接被断开、处理线程释放，不无限占用。

**不应成立:**

- 单个慢连接永久占住线程，累积后服务无响应。

## 5. 并发上限

**应成立:**

- 并发请求数超过上限时，多出请求收到 503 JSON 并被关闭连接；其余请求正常完成。
- 并发尖峰下线程数有界，不无限增长。

**不应成立:**

- 并发尖峰导致线程无界增长最终 OOM 杀进程。

## 6. 单次异常后仍可调用

**应成立:**

- 制造一次失败（如 base64 媒体被拒、DashScope 返回非 200）后，下一次正常请求立即成功。

**不应成立:**

- 一次异常后服务永久不可调用（响应写失败/连接泄漏导致后续请求全部失败）。

## 7. 进程崩溃自愈

**应成立:**

- 手动杀掉代理子进程后，`start-vision-proxy` 在退避后自动拉起，`/healthz` 恢复 200。
- 持续崩溃（如端口被占）时重启退避逐步放大，不空转打日志。

**不应成立:**

- 进程退出后永久不拉起；崩溃时 1s 高频无意义重启。

## 8. 优雅停止不重启

**应成立:**

- 对 `start-vision-proxy` 发送 SIGINT/SIGTERM 时，子进程一并退出且不再重启，脚本以正常状态结束（win32 下 Ctrl+C 作用于控制台进程组，子进程同收信号，不额外重启）。

**不应成立:**

- 手动停止后又被自动拉起；Ctrl+C 后僵尸进程残留。

## 9. Node 侧端到端超时

**应成立:**

- 代理长时间不响应（运行级模拟：代理挂起）时，`multimodalChat()` 在 `QWEN_VISION_PROXY_TIMEOUT_MS` 后抛出明确错误（含代理端点与超时信息），不无限等待。
- 未显式配置超时时，客户端默认兜底生效，`getLlmConfig` 的两个调用面（AI 总结 trigger 与手动分析）都获得超时。

**不应成立:**

- fetch 永久挂起、分析任务永远卡在 analyzing；某个调用面因配置缺失而完全没有超时。

## 10. 正常分析链路不回归

**应成立:**

- 配置了视觉代理的真实多模态分析在超时阈值内正常完成，不被超时误杀。
- `pnpm typecheck`、`pnpm build` 零错误。

**不应成立:**

- 正常分析因默认超时过短被中断；`/v1/chat/completions` 契约变化导致 Node 解析失败。

## 11. 反向 DNS 关闭

**应成立:**

- 请求日志中的来源显示为 IP 直写，不触发反向域名解析；无 DNS 依赖环境下日志不阻塞。

**不应成立:**

- 每请求等待反向 DNS 解析（阻塞请求处理或日志）。

## 12. NO_RESTART 逃生门

**应成立:**

- `VISION_PROXY_NO_RESTART=1` 时，代理子进程退出后脚本不自动重启、直接退出。

**不应成立:**

- 逃生门失效仍自动重启，阻塞运维/脚本编排场景。

## 运行级观测方式

- 静态/逻辑级：代码检查覆盖（body 上限前置判定、socket timeout、模块级 BoundedSemaphore、safe_send_json、address_string 直接返回 IP、AbortController 分支与客户端默认兜底）。
- 运行级：启动 `pnpm --filter @bilibili-downloader/server start:vision-proxy`，用 curl/脚本构造超大 body、非法 Content-Length、慢连接、并发尖峰、kill 进程、Ctrl+C、`VISION_PROXY_NO_RESTART=1`，逐项对照方向 2/3/4/5/7/8/11/12。DashScope 真实成功路径（方向 1/10）依赖有效 `DASHSCOPE_API_KEY` 与本地媒体文件，如不可用则逻辑级覆盖并标注，留用户手动验证。
