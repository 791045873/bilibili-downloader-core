# 2026-08-21 LLM 并发调用限制测试验证

关联计划：`docs/plans/2026-08-21-llm-concurrency-limit-plan.md`

## 验证范围

本测试文档描述"同时最多 2 个大模型调用"落地后应保持的可观察状态。核心是：所有 AI 总结任务的 LLM 多模态调用在 Node 侧统一限流为最多 2 个在途，超出者排队等待而非失败；Python 代理作为兜底上限也为 2，且 `/healthz` 不再占用信号量槽位。

## 前提

- 本机可运行 `pnpm`。
- 不需要真实 DashScope 密钥/外部网络（用 stub HTTP 服务模拟代理行为）。
- 开发模式 `start-vision-proxy` 可启动（healthz 检查）。

## 测试方向

### Node 侧并发上限与排队语义

- [x] 应成立：并发发起 4 个 `multimodalChat` 调用（stub 代理延迟响应），任意时刻在途（未返回）的调用数不超过 2。
- [x] 应成立：第 3、4 个调用**排队等待**，当前 2 个完成后才继续；最终 4 个全部成功返回，不报并发受限错误。
- [x] 应成立：成功调用返回体与改造前一致（`{ data, rawContent, model }`）。
- [x] 不应成立：并发超过 2 时出现 503/并发受限失败（Node 侧排队而非拒绝）。

### Python 代理兜底与健康检查

- [x] 应成立：`qwen_vision_proxy.py` 默认 `MAX_CONCURRENCY` 为 2（无 env 时 `_request_slots` 容量为 2）。
- [x] 应成立：`/healthz` 在任何并发下（含 2 个 LLM 调用在途）都返回 200 `{"status":"ok"}`，不再占用信号量槽位。
- [x] 已裁定：代理在 2 个并发在途时对第 3 个请求仍按原语义返回 503（兜底）——由代码审查确认 `do_POST` 仍经 `_acquire_slot()`（`blocking=False`）强制信号量；真实"2 在途 + 第 3 请求 503"需持住 2 个真实 DashScope 调用，属真实外部调用范围外，不执行。

### 配置与文档一致性

- [x] 应成立：`docker-compose.yml` server 服务含 `MAX_CONCURRENT_LLM_CALLS`（默认 2）；vision-proxy 的 `QWEN_VISION_PROXY_MAX_CONCURRENCY` 默认 2。
- [x] 应成立：`.env.example` 与架构基线 `2026-07-06-video-analysis-baseline.md` 的 env 清单与 live 代码一致（`MAX_CONCURRENT_LLM_CALLS` 默认 2、`QWEN_VISION_PROXY_MAX_CONCURRENCY` 默认 2）。
- [x] 不应成立：文档把并发上限描述为 8 或描述为"503 拒绝为主语义"。

### 范围外裁定

- [x] 已裁定：真实 DashScope 模型调用——需用户密钥 + 外部网络，不执行；用 stub 服务覆盖并发行为，healthz 与无 key 启动路径已覆盖。
- [x] 已裁定："测试连接"端点（直连 DashScope 原生端点，不经代理）——不在本限流范围内，不测试。
- [x] 已裁定：历史 plan/log/audit/testing 文档中的旧"默认 8/503 拒绝"描述——历史留档不修改，不参与一致性检查。

## 结果

### 通过

- [x] Node 并发上限：运行级 stub 冒烟 `peakInFlight=2`、`totalReqs=4`、`ok=4`、`failed=0`、`elapsedMs=720`（4×300ms 延迟 / 2 并发 ≈ 2 批）。第 3、4 个排队等待且全部成功，无 503/失败。
- [x] 成功返回体：stub 返回合法 JSON，`multimodalChat` 正常解析为 `{ data, rawContent, model }`。
- [x] Python 默认并发：`qwen_vision_proxy.py:81` 默认 `"8"` → `"2"`；`do_GET` 不再调用 `_acquire_slot`（grep 确认 `_acquire_slot` 仅剩 `do_POST` 使用，L220/225）。
- [x] healthz：代理启动后 `GET /healthz` 200 `{"status":"ok"}`；且 `do_GET` 代码不再占槽，任意并发下均 200。
- [x] 配置一致性：compose `MAX_CONCURRENT_LLM_CALLS:-2`、`QWEN_VISION_PROXY_MAX_CONCURRENCY:-2`；`.env.example` 与架构基线同步；`docker compose config --quiet` 通过。
- [x] `pnpm typecheck` exit 0；`pnpm build` exit 0；Python `ast.parse` 语法 OK。

### 明确裁定

- [x] 代理"2 在途 + 第 3 请求 503"：需持住真实 DashScope 调用，范围外；由代码审查确认 `do_POST` 信号量语义未变。
- [x] 真实 DashScope 调用：范围外（stub 已覆盖 Node 侧并发核心行为）。
- [x] 测试连接端点 / 历史文档：范围外。

## 执行证据

- `node llm-concurrency-smoke.cjs` → `{"peakInFlight":2,"totalReqs":4,"ok":4,"failed":0,"elapsedMs":720}`，exit 0。
- `pnpm typecheck` exit 0（Scope: 7 of 8 workspace projects，全部 Done）。
- `pnpm build` exit 0（core/adapters/server Done，frontend vite built）。
- `python -c "ast.parse(...)"` → `python syntax OK`。
- 代理启动冒烟：healthz status=200 body=`{"status":"ok"}`。
- `docker compose -f packages/docker/docker-compose.yml config --quiet` exit 0。
- grep：`_acquire_slot`/`_request_slots` 仅出现于 `do_POST` 路径（L205-206 定义、L220/225 使用）。

