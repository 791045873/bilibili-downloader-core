# 2026-10-03 云端 baseURL 改用独立 env QWEN_API_BASE

承接同日 `docs/logs/2026-10-03-cloud-direct-dashscope.md`。用户指示云端 OpenAI SDK baseURL 直接用 `.env` 的 `QWEN_API_BASE`，替换上一轮的 `CLOUD_LLM_BASE_URL`→容器 `QWEN_VISION_PROXY_URL` 间接方案。详见 plan Amendment（`docs/plans/2026-10-03-cloud-direct-dashscope-plan.md`）。

## 变更
- `packages/adapters/src/llm/qwen-client.ts`：`LlmConfig` 加 `openaiBaseUrl?`（仅 cloud 用）。
- `packages/cloud-server/src/chat/openai-vision-client.ts`：constructor 用 `config.openaiBaseUrl` 作 baseURL（缺失抛 `QWEN_API_BASE` 文案）；`deriveOpenAiBaseUrl` 降级为防御性归一；`usesVisionProxy()`→false；注释更新。
- `packages/cloud-server/src/chat/chat.service.ts`：读 `process.env.QWEN_API_BASE` → `openaiBaseUrl`（缺失 503）。
- `packages/docker/docker-compose.cloud.yml` / `docker-compose.yml`：cloud-server 环境变量改 `QWEN_API_BASE: ${QWEN_API_BASE:-https://dashscope.aliyuncs.com/compatible-mode/v1}`，弃用 `CLOUD_LLM_BASE_URL`。
- `packages/docker/.env.example`：`CLOUD_LLM_BASE_URL`→`QWEN_API_BASE`（基址，无 `/chat/completions`）。
- 测试 `openai-vision-client.test.ts`：改用 `openaiBaseUrl`/`QWEN_API_BASE`。
- 文档对齐：system-baseline / app-overview / codebase-map / DEPLOYMENT-CHECKLIST（`CLOUD_LLM_BASE_URL`→`QWEN_API_BASE`）。

## 配置契约
云端 `QWEN_API_BASE`（baseURL 基址）与 NAS `QWEN_VISION_PROXY_URL`（本地代理端点）端到端不同变量名，完全解耦。

## 验证
- `pnpm --filter cloud-server typecheck`、`pnpm build` 绿。
- `openai-vision-client.test.ts` 全绿。
- `pnpm docker:cloud:config` / `pnpm docker:config` 渲染：cloud-server 注入 `QWEN_API_BASE=…/compatible-mode/v1`、无 `QWEN_VISION_PROXY_URL`；nas-worker 仍走本地代理。

## 残留
运行期真机冒烟（`enable_thinking`/`response_format` 对 compatible-mode 的接受性）仍为上线前人工动作。
