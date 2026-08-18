# 2026-08-18 环境变量清理范围讨论

## 需求来源

用户会话中提出：对项目中的环境变量做一次清理，凡是不再使用、过时或重复的统统移除。

## 盘点方法

对以下来源做了全量交叉核对：`packages/server/src` 与 `packages/vision-proxy`、`packages/core/adapters/frontend/bilibili-api-sdk`、根目录与 `packages/docker` 的脚本/配置、`docker-compose.yml`、`Dockerfile`、`.env.example`、活动文档（README / context / design / architecture）、本机 gitignored 的 `packages/server/.env` 与 `packages/vision-proxy/.env`。

## 现状分类

### 保留（活跃使用）

- server（15）：`OUTPUT_DIR` `LOG_DIR` `LOG_MAX_FILES` `MAX_CONCURRENT_DOWNLOADS` `MAX_CONCURRENT_LOW_RES_DOWNLOADS` `COOKIE_FILE` `ANALYSIS_LLM_VIDEO_DIR` `QWEN_VISION_PROXY_URL` `QWEN_VISION_PROXY_TIMEOUT_MS` `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `NOTIFICATION_EMAIL`
- 代理（9）：`QWEN_VISION_PROXY_HOST` `QWEN_VISION_PROXY_PORT` `QWEN_VISION_PROXY_MAX_BODY_BYTES` `QWEN_VISION_PROXY_MAX_CONCURRENCY` `QWEN_VISION_PROXY_SOCKET_TIMEOUT` `DASHSCOPE_API_KEY` `DASHSCOPE_BASE_HTTP_API_URL` `LOG_DIR` `LOG_MAX_FILES`
- 脚本/部署：`VISION_PROXY_NO_RESTART`（start-vision-proxy）；`PORT`（server/Dockerfile/compose）；`DOWNLOAD_HOST_PATH`/`HOME`/`USERPROFILE`（compose volume 默认路径）；`APT_MIRROR`/`NPM_REGISTRY`/`PIP_INDEX_URL`（Dockerfile 构建参数）

### 废弃（代码不再读取）

- `QWEN_API_KEY` / `QWEN_API_BASE` / `QWEN_MODEL`：2026-08-15 LLM 配置迁移到 `app_settings` 表后移除 env 回退，代码无残留；仅残留于本机 `.env` 与历史文档（历史文档按留档规则不动）。
- `QWEN_VISION_MODEL`：同日视觉模型并入主模型后移除，代码无残留；仍残留在 `docs/architecture/2026-07-06-video-analysis-baseline.md` 的 env 块（L224）与透传描述（L258）及本机 `.env`。
- `TENCENT_COS_SECRET_ID/KEY/REGION/BUCKET`（另有仅文档存在的 `TENCENT_COS_TEMP_PREFIX`、`TENCENT_COS_SIGNED_URL_EXPIRES_SECONDS`）：`packages/adapters/src/cos/` 的 `TencentCosTempImageStore` 是导出但从未被实例化的死代码，`cos-nodejs-sdk-v5` 依赖无消费者；多模态无代理时实际直接调用 `baseUrl/chat/completions`（`qwen-client.ts:203`），不再走 COS 上传。文档 L106/L247-253/L261 的 COS 备用路径描述过期。

### 重复/别名

- `DASH_SCOPE_API_KEY`：`DASHSCOPE_API_KEY` 的别名回退，存在于代理代码（`qwen_vision_proxy.py:238/240`）、`docker-compose.yml`（L13）、`.env.example`（L6/L8）。本机 `.env` 实际只用 `DASHSCOPE_API_KEY`，别名无使用者。

## 决策点

1. **DASH_SCOPE_API_KEY**：移除。用户确认走推荐方向。代理只认 `DASHSCOPE_API_KEY`；compose 与 `.env.example` 同步删别名。残余风险：若某部署环境历史上只设置了别名，将不再被接受——仓库与文档从未推荐别名作为主键，风险可接受。
2. **COS 死代码与依赖**：一并移除。用户确认。删除 `packages/adapters/src/cos/`、adapters 根导出与 `./cos` exports 映射、`cos-nodejs-sdk-v5` 依赖；`pnpm-lock.yaml` 重生成。文档同步删除 COS 备用路径描述，并把"无 QWEN_VISION_PROXY_URL"路径更正为"直接调用兼容接口（图片需公网可访问 URL）"。
3. **本地 .env 文件**：一并清理。用户确认。按进程归属拆分：
   - `packages/server/.env` 仅保留 server 读取的键（如 `MAX_CONCURRENT_DOWNLOADS`、`QWEN_VISION_PROXY_URL`），删除代理专用（`QWEN_VISION_PROXY_HOST/PORT`、`DASHSCOPE_API_KEY`）与全部废弃键（`QWEN_API_*`、`QWEN_VISION_MODEL`、`TENCENT_COS_*`）。
   - `packages/vision-proxy/.env` 仅保留代理读取的键（`DASHSCOPE_API_KEY`、`QWEN_VISION_PROXY_HOST/PORT`），删除 server 专用与废弃键。
   - 不打印、不提交任何密钥值；文件仍由 gitignore 忽略。

## 待确认（非阻塞）

- 无。三项范围均已由用户确认。

## 推进路径

- 完整 plan：`docs/plans/2026-08-18-env-var-cleanup-plan.md`（涉 deployment compose 桥接与依赖移除，full plan + 独立 plan/closure audit）。