# 2026-10-03 云端多模态直连 DashScope、移除云侧 vision-proxy

Plan: `docs/plans/2026-10-03-cloud-direct-dashscope-plan.md`（部署保护区，人工批准 + 独立 plan audit PASS-WITH-REQUIRED-FIXES，blocker/should-fix 已并入）

## 变更
- `packages/docker/docker-compose.cloud.yml`：删 `vision-proxy` service + cloud-server `depends_on` + `cloud-proxy-logs` 卷；cloud-server `QWEN_VISION_PROXY_URL` 经新宿主变量 `CLOUD_LLM_BASE_URL` 默认 DashScope compatible-mode。
- `packages/docker/docker-compose.yml`（单机）：cloud-server 去 `depends_on: vision-proxy`，其 `QWEN_VISION_PROXY_URL` 经 `CLOUD_LLM_BASE_URL` 默认 DashScope；vision-proxy 服务与 nas-worker 依赖保留（NAS 仍需）。
- `packages/docker/.env.example`：澄清 `CLOUD_LLM_BASE_URL`（云端模型端点）与 `QWEN_VISION_PROXY_URL`（仅 NAS）语义、三镜像职责、两机说明、llm.apiKey 须为百炼 Key。
- `packages/cloud-server/src/chat/openai-vision-client.ts`：仅文案（头注释 / L127 错误文案 / body 注释），逻辑/签名零改。
- 文档对齐：`DEPLOYMENT-CHECKLIST.md`（C/D/D-bis、启动次序）、`docs/architecture/system-baseline.md`、`docs/architecture/module-boundaries.md`、`docs/design/app-overview.md`、`docs/context/codebase-map.md`。

## 配置契约（audit B2）
容器内 env 仍为 `QWEN_VISION_PROXY_URL`（代码/tests 零改）；compose 级用独立宿主变量 `CLOUD_LLM_BASE_URL` 注入云端默认，消除「单机全局 `QWEN_VISION_PROXY_URL` 同时覆盖云/NAS」footgun。

## 验证
- `pnpm --filter cloud-server typecheck` 绿；`pnpm build` 全包绿。
- `tests/chat/openai-vision-client.test.ts` 7/7 绿（URL+body+header 等价、`enable_thinking`/`response_format` 透传）。
- `pnpm docker:cloud:config`：仅 cloud-server，无 vision-proxy，`QWEN_VISION_PROXY_URL`=DashScope。
- `pnpm docker:config`（单机）：cloud-server 无 `depends_on`、`QWEN_VISION_PROXY_URL`=DashScope；nas-worker 仍走本地代理（实测本机 .env 全局值只落到 nas-worker，验证解耦生效）；vision-proxy 保留。

## 残留（上线前人工）
DashScope compatible-mode 对所配 Qwen-VL 是否接受顶层 `enable_thinking` 与 `response_format:{json_object}` 需真机冒烟；失败补救：`enable_thinking` 下沉 extra_body / 去 response_format 依赖 prompt 约束 JSON。本次仅交付「配置对齐」，非「运行期已验证」。
