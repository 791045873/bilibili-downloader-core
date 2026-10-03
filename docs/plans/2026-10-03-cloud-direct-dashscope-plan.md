# Plan: 云端多模态直连 DashScope、移除云侧 Python vision-proxy

> Created: 2026-10-03
> Requirement: `docs/requirements/2026-09-17-cloud-project-split.md`（L35/36/58/98）
> Protected area: 部署（compose / 公网形态）——人工已批准（2026-10-03 用户显式："设立计划并审计，然后进行开发"）
> Reviewer availability: none → 独立子代理 fresh-eyes plan audit + closure audit（部署保护区，须审计）

## Decision Summary

- 需求早已规定：云端多模态用 `openai` SDK 连「所配置的 URL」；Python vision-proxy 组件「**仅 NAS** 用于读取本地视频文件」（需求 L36）。当前 compose 却在云侧捆了 vision-proxy 并默认指向它——与需求偏离。本计划把云侧对齐需求：**云端直连 DashScope OpenAI 兼容端点，云侧不再部署 vision-proxy**。
- 业务代码零改：`openai-vision-client.ts` 已是「baseURL = 去 `/chat/completions` 后缀」，把 `QWEN_VISION_PROXY_URL` 指向 DashScope compatible-mode 即直连。仅改 compose / 文案 / 文档。
- 官方文档已核实（百炼「OpenAI 兼容-Chat」+「安装 SDK」）：compatible-mode 支持 OpenAI 风格多模态 `image_url`、专有参数经 body/extra_body 透传、`response_format`、Bearer `apiKey`。云端问答只发 `image_url`（不发 `video_url`），故兼容端点足够。

## Scope（改动文件）

- `packages/docker/docker-compose.cloud.yml`：删 `vision-proxy` service + cloud-server 的 `depends_on` + `cloud-proxy-logs` 卷；cloud-server `QWEN_VISION_PROXY_URL` 默认改为 DashScope compatible-mode 端点。
- `packages/docker/docker-compose.yml`（单机）：cloud-server 去 `depends_on: vision-proxy`、`QWEN_VISION_PROXY_URL` 默认改 DashScope；**保留** vision-proxy service 与 nas-worker 的依赖（NAS 仍需）。
- `packages/docker/.env.example`：澄清 `QWEN_VISION_PROXY_URL` 语义（云=模型兼容端点；NAS=本地 Python 代理）、更新三镜像职责与两机说明、注明 `llm.apiKey` 须为百炼 Key、补单机 override footgun 提示。
- `packages/cloud-server/src/chat/openai-vision-client.ts`：仅文案——文件头注释、L127 错误文案、L149-150 注释去除"仅经 Python 视觉代理"措辞（不改逻辑/签名；`usesVisionProxy()` 无调用方，保留）。
- `DEPLOYMENT-CHECKLIST.md`：C 节 `QWEN_VISION_PROXY_URL`、D 节启动次序（L26 云侧不再 gate on vision-proxy healthy）、D-bis 云侧 compose 描述、L37「两侧各自本地 vision-proxy」改为「云侧直连模型端点、仅 NAS 本地代理」。
- `docs/architecture/system-baseline.md`：部署形态 / L104-105 等更新为"云侧直连 DashScope、vision-proxy 仅 NAS"。
- `docs/architecture/module-boundaries.md`（**audit B1**）：L91 依赖图 `cloud-server ──(HTTP)──→ vision-proxy` + L68 通信边界「chat 多模态在 cloud-server … 经 HTTP 契约」更新为云侧直连模型端点。
- `docs/design/app-overview.md`（**audit S3**）：L12 三镜像描述区分云侧直连、NAS 本地代理。
- `docs/context/codebase-map.md`（**audit S3**）：L24 Docker 拓扑行轻量更新。
- `docs/logs/`：新增实施日志。

## Non-Goals

- 不改 NAS 分析链路（仍经本地 vision-proxy 读 `file://`）。
- 不重命名 `QWEN_VISION_PROXY_URL`（需求保留此名；云端语义=OpenAI 兼容端点 URL）。
- 不改 embedding 配置。

## Config Contract 决策（audit B2 已采纳 compose 级解耦）

- 容器内 env 仍是 `QWEN_VISION_PROXY_URL`（符合需求命名；`chat.service.ts`/`openai-vision-client.ts`/tests 零改）。
- **compose 级解耦**：cloud-server 服务的 `QWEN_VISION_PROXY_URL` 由**独立宿主变量** `CLOUD_LLM_BASE_URL` 注入默认 DashScope 端点：
  `QWEN_VISION_PROXY_URL: ${CLOUD_LLM_BASE_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions}`
  nas-worker 仍用 `${QWEN_VISION_PROXY_URL:-http://vision-proxy:8765/v1/chat/completions}`。
- 效果：单机 compose 下即便用户在 `.env` 全局设 `QWEN_VISION_PROXY_URL`（现有文档引导其设此项），也**只影响 NAS**，不会误改云端模型端点；云端覆盖走 `CLOUD_LLM_BASE_URL`。两机部署各自 `.env` 独立，本就安全。
- `.env.example` 增补 `CLOUD_LLM_BASE_URL` 说明（云端模型兼容端点，默认 DashScope compatible-mode）。

## Stages

### S1 — compose + 代码文案
- 改两份 compose（cloud + 单机）+ `openai-vision-client.ts` 文案 + `.env.example`。
- Item Types: `Fix`

### S2 — 文档对齐
- `DEPLOYMENT-CHECKLIST.md` + `docs/architecture/system-baseline.md` + `docs/logs/` 日志。
- Item Types: `Fix`

## Verification

- `pnpm --filter cloud-server typecheck`、相关测试（openai-vision-client 7、cookie-refresh 2）绿。
- `pnpm build` 绿。
- `pnpm docker:cloud:config`：渲染无 `vision-proxy`、cloud-server 无 `depends_on`、`QWEN_VISION_PROXY_URL`=DashScope、`DATABASE_URL` fail-closed 仍在。
- `pnpm docker:config`（单机）：cloud-server 无 `depends_on: vision-proxy` 且其 `QWEN_VISION_PROXY_URL`=DashScope（经 `CLOUD_LLM_BASE_URL`）；nas-worker 仍=`vision-proxy:8765`；`vision-proxy` 服务仍在。
- grep 断言 `docker-compose.cloud.yml` 无 `vision-proxy` service。

## 运行期兼容风险与补救（audit S1）

- 唯一待实测点：DashScope compatible-mode 对本项目所配 Qwen-VL 模型是否接受**顶层** `enable_thinking` 与 `response_format:{type:"json_object"}`（当前经代理走的是 DashScope 原生协议，compatible-mode 不等价）。`openai-vision-client.ts:172` 对返回硬 `JSON.parse`，非 JSON 会使该轮失败。
- 补救路径（上线前冒烟若失败按此修，均为后继小改）：`enable_thinking` 下沉 `extra_body`；或去掉 `response_format` 依赖 prompt 强约束 JSON。
- 诚实口径：本计划闭合只交付「**配置对齐**（云侧 compose 去 proxy、直连 DashScope）」，不等于「云端直连已运行期验证通过」——后者是上线前人工冒烟。

## Exit Criteria

- [x] 云侧 compose 不含 vision-proxy；云端 `QWEN_VISION_PROXY_URL` 默认 DashScope compatible-mode（经 `CLOUD_LLM_BASE_URL`）；NAS 侧不变。
- [x] 文档/清单与新形态一致，无残留"云侧 vision-proxy"陈述（含 module-boundaries / app-overview / codebase-map / checklist / system-baseline）。
- [x] typecheck/build/测试/compose config 全绿。
- [~] 运行期冒烟（真机对 DashScope 发图 + `enable_thinking`/`response_format`）列为上线前人工验证（环境受限，计划内不执行）。

## Audit

- Status: **PASS-WITH-REQUIRED-FIXES**（独立子代理 fresh-eyes，reviewer availability=none；部署保护区）
- Date: 2026-10-03
- 逐条对照 live code 确认计划技术主线成立：云端已用 openai SDK（`openai-vision-client.ts:87-93,151-154`）、baseURL 去尾使 DashScope 直连为纯配置改动、云端仅发 `image_url`（`chat.service.ts:198,242`，无 `video_url`）、唯一构造点 `chat.service.ts:304`、`usesVisionProxy()` 无调用方。
- Blockers（已并入 Scope/Config）：
  - **B1** 文档漏项——`docs/architecture/module-boundaries.md:91/68` 直陈 cloud→vision-proxy，须纳入并更新。已加入 Scope。
  - **B2** 单机 footgun——cloud/nas 共用 `${QWEN_VISION_PROXY_URL}`，全局 .env 覆盖会误伤云端。采纳 compose 级解耦（云端经 `CLOUD_LLM_BASE_URL` 注入，容器 env 名不变、代码零改）。已改 Config Contract。
- Should-fix（已并入）：S1 运行期兼容补救路径 + 诚实闭合口径；S2 checklist L26 启动次序 / L37 文案；S3 `app-overview.md:12` / `codebase-map.md:24`；S4 `openai-vision-client.ts:3/127` 文案落实。

## Closure

- Status: **已闭合（配置对齐完成）**。独立子代理 fresh-eyes closure audit（2026-10-03，部署保护区）Verdict=**PASS，无 Blocker**。
- 逐条对照真实 diff + 实跑 `docker compose config` 两份文件核验：cloud.yml 去 vision-proxy service/depends_on/cloud-proxy-logs + 云端默认 DashScope；单机 cloud-server 去 depends_on + 用 `CLOUD_LLM_BASE_URL`，vision-proxy 与 nas-worker 依赖保留；nas.yml 未改。B2 解耦实证：本机 .env 的全局 `QWEN_VISION_PROXY_URL` 仅落到 nas-worker（`127.0.0.1:8765`），云端仍解析为 DashScope。代码仅文案改动、`chat.service.ts` 未动。文档 module-boundaries/system-baseline/app-overview/codebase-map/checklist 均已对齐，无残留"云侧 vision-proxy"陈述。
- 验证：cloud-server typecheck 绿、`pnpm build` 全包绿、`openai-vision-client.test.ts` 7/7 绿、两份 compose config 渲染绿（DATABASE_URL fail-closed 仍在）。
- closure should-fix（已落实）：`openai-vision-client.ts:168` 空响应文案去"代理"、`app-overview.md:147` 503 文案去"vision-proxy"。
- 遗留（非本计划范围）：`README.md` 仍描述拆分前两镜像布局（pre-existing，建 backlog 单独刷新，不阻断本次闭合）。
- 运行期真机冒烟（DashScope compatible-mode 对所配 Qwen-VL 的 `enable_thinking`/`response_format` 顶层接受性）仍为上线前人工动作，未执行。

## Amendment（2026-10-03，同日迭代）

用户指示："OpenAI 的 baseURL 使用 .env 中的 `QWEN_API_BASE` 即可"。据此将上文的 `CLOUD_LLM_BASE_URL`→容器 `QWEN_VISION_PROXY_URL`（去尾派生 baseURL）间接方案，简化为**云端读独立 env `QWEN_API_BASE` 直接作为 OpenAI SDK baseURL**：

- `adapters` `LlmConfig` 加 `openaiBaseUrl?`（仅 cloud 用，NAS QwenClient 不读）；`chat.service.ts` 读 `process.env.QWEN_API_BASE` → `openaiBaseUrl`；`openai-vision-client.ts` 用 `openaiBaseUrl` 作 baseURL（`deriveOpenAiBaseUrl` 降级为防御性归一，容忍误带 `/chat/completions`）。
- compose（cloud.yml + 单机）cloud-server 环境变量由 `QWEN_VISION_PROXY_URL/CLOUD_LLM_BASE_URL` 改为 `QWEN_API_BASE`（基址，无 `/chat/completions`）。`CLOUD_LLM_BASE_URL` 废弃。
- 效果：云端（`QWEN_API_BASE`）与 NAS（`QWEN_VISION_PROXY_URL`）**端到端完全不同变量名**，彻底消除共享覆盖 footgun（强于原 compose 级解耦）。
- 需求偏离说明：需求 2026-09-17 原写"云端经 `QWEN_VISION_PROXY_URL`"，本次经用户裁决改为 `QWEN_API_BASE`（语义更清晰）。
- 验证：cloud-server typecheck + build + `openai-vision-client.test.ts`（已改用 `openaiBaseUrl`/`QWEN_API_BASE`）+ 两份 compose config；独立 closure audit。详见 `docs/logs/2026-10-03-cloud-qwen-api-base.md`。


