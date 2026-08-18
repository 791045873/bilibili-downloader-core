# 2026-08-18 移除多模态直连分支与 chatCompletion 死代码

关联计划：`docs/plans/2026-08-18-remove-llm-dead-paths-plan.md`

## 实施摘要

- `qwen-client.ts`：`multimodalChat` 删除"未配置代理直连 `baseUrl/chat/completions`"分支，方法开头对未配置 `visionProxyUrl` 抛「LLM 多模态调用需要配置 QWEN_VISION_PROXY_URL（当前仅支持经 Python 视觉代理调用）」；删除无调用方的 `chatCompletion` 方法与 `ChatCompletionRequest` 接口。
- `llm/index.ts`：删除 `ChatCompletionRequest` 再导出。
- `analysis-engine.ts`：仅改写 L297 注释（"多模态选图"→"图像选择"）；早期守卫与 `usesVisionProxy()` 保留不变。
- 文档对齐：`video-analysis-baseline.md` 更新模块树 L21、架构原则 L38/39/40、LLM 适配器接口块、`multimodalChat` 透传描述（无直连回退）、流程图（单次调用流）、env 块注释措辞；`env-cleanup` 测试文档 L32 与计划 Deferred 项标注失效/现状变更。

## 关键决策落地

- 保留 `analysis-engine.ts` 早期守卫 + `usesVisionProxy()`：调用点快速失败 + 方法内防御双保险。
- `POST /api/analysis/config/test` 的纯文本连通性探测保留（设置页测试功能，与多模态代理链路无关）。

## 验证结果

- `pnpm typecheck` / `pnpm build` exit 0（Scope: 7 of 8 workspace projects）。
- 开发模式代理 healthz 200 `{"status":"ok"}`（代理链路未受影响）；`docker compose config` 通过。
- 残留扫描：活动文件（不含 `.venv`）对 `chatCompletion`/`ChatCompletionRequest`/`无代理直连`/`多模态选图` 0 命中（`analysis-engine.ts:297` 注释已改写规避；`.venv` 内 dashscope 第三方 SDK 的 `ChatCompletion` 命名 gitignored，与项目无关）。

## 说明

- 测试方向详情见 `docs/testing/2026/08-18-remove-llm-dead-paths-testing.md`。
- 真实 DashScope 模型调用（含文本/多模态端到端）未执行（需用户密钥 + 外部网络 + 完整分析环境），按范围外裁定；代理 healthz 与编译验证已覆盖。
- 历史文档与 `docs/discussions/` 决策记录中的直连/chatCompletion 描述不修改（历史留档）。