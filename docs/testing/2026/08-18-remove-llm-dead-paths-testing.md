# 2026-08-18 移除多模态直连分支与 chatCompletion 测试验证

关联计划：`docs/plans/2026-08-18-remove-llm-dead-paths-plan.md`

## 验证范围

本测试文档描述移除 `multimodalChat` 直连分支与 `chatCompletion` 死代码后应保持的可观察状态。本次变更不改变代理链路行为；重点是：多模态调用必须经 Python 代理、未配置时报明确错误、编译与镜像/开发模式不受影响、文档不再描述已删除的能力。

## 前提

- 本机可运行 `pnpm` 与 `docker compose`（v2+）。
- 开发模式无 `QWEN_VISION_PROXY_URL` 时，代理链路不可用是预期行为（多模态调用报错）；代理自身 `/healthz` 仍 200。
- 历史文档（plan/log/audit/requirements/testing 旧记录）不参与一致性检查。

## 测试方向

### 直连分支移除

- [x] 应成立：`qwen-client.ts` 的 `multimodalChat` 不再包含直连 `baseUrl/chat/completions` 分支；未配置 `visionProxyUrl` 时直接抛出明确错误（提及 QWEN_VISION_PROXY_URL）。
- [x] 应成立：`analysis-engine.ts` 的早期守卫与 `usesVisionProxy()` 保留，视频分析流程仍要求代理。
- [x] 不应成立：任何多模态代码路径在没有代理配置时尝试直连模型（`POST /api/analysis/config/test` 的纯文本连通性探测除外，见范围外裁定）。

### chatCompletion 移除

- [x] 应成立：`chatCompletion` 方法与 `ChatCompletionRequest` 接口及其再导出（`llm/index.ts`）已删除。
- [x] 不应成立：活动代码/配置/文档中残留 `chatCompletion`/`ChatCompletionRequest` 引用（历史留档除外）。

### 编译与运行稳定

- [x] 应成立：`pnpm typecheck` 与 `pnpm build` 全部通过（无 import/类型断裂）。
- [x] 应成立：开发模式 `start-vision-proxy` 代理 `GET http://127.0.0.1:8765/healthz` 返回 200；`docker compose config` 通过。
- [x] 不应成立：本次变更影响 Python 代理、compose、Dockerfile 或环境变量。

### 文档一致性

- [x] 应成立：`video-analysis-baseline.md` 流程与透传描述为"多模态必走代理"，无"无代理直连/chatCompletion 构造字幕分析"描述。
- [x] 应成立：env-cleanup 测试文档与计划的失效说明已标注（其"无代理直连"方向随本计划失效）。
- [x] 不应成立：活动文档把已删除的直连/chatCompletion 能力描述为可用。

### 范围外裁定

- [x] 已裁定：`POST /api/analysis/config/test` 的纯文本连通性探测（`analysis.controller.ts` 直连 `{baseUrl}/chat/completions` 最小 chat）——属设置页测试功能，与多模态代理链路无关，本计划不触碰。
- [x] 已裁定：真实 DashScope 模型调用（含文本/多模态端到端）——需用户密钥 + 外部网络 + 完整分析环境，不执行；代理 healthz 与编译验证已覆盖。
- [x] 已裁定：历史 plan/log/audit/requirements/testing 旧文档与 `docs/discussions/` 决策记录中的 `chatCompletion`/直连描述——历史留档不修改，不参与残留扫描。
- [x] 已裁定：本测试文档自身对 `chatCompletion`/`ChatCompletionRequest`/直连的措辞——为验证工件描述，非过期声明，不参与计划 Phase 2/3 的残留扫描。

## 结果

### 通过

- [x] 直连分支移除：`multimodalChat` 无直连分支，方法开头对未配置 `visionProxyUrl` 抛「LLM 多模态调用需要配置 QWEN_VISION_PROXY_URL（当前仅支持经 Python 视觉代理调用）」；`analysis-engine.ts` 早期守卫与 `usesVisionProxy()` 保留。
- [x] chatCompletion 移除：`qwen-client.ts` 删除 `chatCompletion` 方法与 `ChatCompletionRequest` 接口；`llm/index.ts` 删除再导出；grep 确认活动代码无 `chatCompletion`/`ChatCompletionRequest`。
- [x] 文档对齐：`video-analysis-baseline.md` 更新模块树 L21、架构原则 L38/39/40、LLM 适配器接口块、`multimodalChat` 透传描述、流程图（单次调用）、env 块注释（"多模态选图"措辞）；`env-cleanup` 测试文档 L32 与计划 Deferred 项已标注失效/现状变更。
- [x] 编译运行：`pnpm typecheck`/`pnpm build` exit 0；开发模式代理 healthz 200 `{"status":"ok"}`；`docker compose config` 通过。
- [x] 残留扫描：活动文件（含 `analysis-engine.ts` 注释——已改写规避"多模态选图"字样）对 `chatCompletion`/`ChatCompletionRequest`/`无代理直连`/`多模态选图` 0 命中；`.venv` 内 dashscope SDK 第三方源码的 `ChatCompletion` 命名 gitignored，与项目无关。

### 明确裁定

- [x] `POST /api/analysis/config/test` 文本直连探测：属设置页测试功能，保留、不触碰。
- [x] 真实 DashScope 调用：范围外；healthz 与编译已覆盖。
- [x] 历史留档与讨论记录：不修改、不参与扫描。

## 执行证据

- `pnpm typecheck` / `pnpm build`：exit 0（Scope: 7 of 8 workspace projects）。
- 冒烟：`VISION_PROXY_NO_RESTART=1` 下 `node ../../scripts/start-vision-proxy.mjs` → healthz 200 `{"status":"ok"}`；验证后清理进程。
- `docker compose config --quiet` 通过。
- 残留扫描：README/context/design/architecture/vision-proxy/docker/adapters src/server src/scripts（不含 .venv）对 `chatCompletion`/`ChatCompletionRequest`/`无代理直连`/`多模态选图` 0 命中（含改写后的 `analysis-engine.ts:297` 注释）。