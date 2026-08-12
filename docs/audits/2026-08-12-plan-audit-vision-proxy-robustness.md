# Plan Audit — Vision Proxy 服务健壮性改进

- 计划：`docs/plans/2026-08-12-vision-proxy-robustness-plan.md`
- 来源：`docs/analysis/2026-08-12-vision-proxy-robustness-analysis.md`
- 审计日期：2026-08-12
- 审计方式：独立 subagent 两轮（冷启动）
  - 首轮 task `ses_0095de8a3ffeUaMpFZmPdmYEg9`：对照 live 代码与计划编写规则全量复核
  - 复核轮 task `ses_00958ade4ffeKs6aLO37rB9GuM`：仅复核修订后的阻塞项与措辞修正

## 首轮审计结论

`needs revision`

### 阻断问题（唯一）

- Phase 3 的 `QWEN_VISION_PROXY_TIMEOUT_MS` 只接入 `analysis-trigger.service.ts` 的 `getLlmConfig()`，但 `getLlmConfig()` 存在两处（trigger service 与 `analysis.controller.ts:306-330`），手动分析调用面会拿到 `visionProxyTimeoutMs: undefined` 而无超时，违反 Goal 3。
- 修订：`analysis.controller.ts` 加入 Phase 3 Targets，两处 config builder 均读 env；同时默认值在 `multimodalChat` 客户端内部兜底（`this.config.visionProxyTimeoutMs ?? 600000`），即使 config builder 漏读 env，两个调用面都获得超时。

### 非阻断建议（均已吸收）

1. Phase 1 Proof 误引"方向 9"（Node 侧超时，属 Phase 3）→ 改为"方向 1-6、11"。
2. 残余风险措辞修正：dashscope 1.26.6 自带 `DEFAULT_REQUEST_TIMEOUT_SECONDS = 300`（早于 Node 600s 超时）释放 Python 槽位，机制是 SDK 超时而非连接关闭。
3. 环境变量清单引用行号修正为 211-232（清单）/234-238（说明）。
4. 并发信号量须为**模块级共享**（per-instance 是空操作），503 响应同样走 `safe_send_json`。
5. testing 补反向 DNS（方向 11）与 `VISION_PROXY_NO_RESTART` 逃生门（方向 12）。
6. `VISION_PROXY_NO_RESTART` 补入 Infra env 清单与 Phase 4 登记项。
7. Source 补支撑分析记录 `docs/analysis/2026-08-12-vision-proxy-robustness-analysis.md`。
8. Phase 2 补 Windows Ctrl+C 控制台进程组语义说明。

## 事实核查（首轮通过）

- Baseline 与 live 代码一致（`getLlmConfig` 两处、`do_POST`/except 结构、无 socket 超时/body 上限/并发限制、`start-vision-proxy.mjs` 裸 spawn、`multimodalChat` 无 AbortController）。
- Python 侧技术主张在 venv Python 3.14.7 验证成立：`StreamRequestHandler.setup()` 应用 handler `timeout` 类属性；覆写 `handle()` + 模块级 BoundedSemaphore 模式可行；与 `ThreadingMixIn.process_request_thread` 不冲突。
- 验证命令真实存在（`pnpm typecheck`/`pnpm build`/`node --check`/venv `python -m py_compile`）。
- 反 slack、Item Types、Decision 项理由/备选/残余风险、testing 覆盖均合规。

## 复核轮结论

`approved`（阻断项已消解，修订版措辞修正全部落地，无新阻断项）。

## 关闭审计

本计划尚未实施；closure audit 将在计划关闭时另行独立执行（证据另行归档）。
