# Plan: LLM 配置前端化管理（模型 + API Key）

## Objective

用户可在前端设置页配置 AI 总结使用的模型与 API Key（含 baseUrl），修改后即时生效，所有未完成 AI 总结的任务应用最新配置。支持在配置页调用连接测试，失败时完整返回错误信息。

> 补充调整（2026-08-15，本计划内）：仅配置一个模型，不再区分视觉模型；删除预设模型列表；新增「测试连接」能力；LLM 配置（API Key/API 地址/模型）仅存 DB，**不再回退环境变量** `QWEN_API_KEY`/`QWEN_API_BASE`/`QWEN_MODEL`；测试连接未提供 API Key 时使用已保存的旧 Key。

## Design

### 1. 数据库（`database.service.ts`）

- 新增键值表 `app_settings (key TEXT PRIMARY KEY, value TEXT)`（幂等 CREATE）。
- 新增方法：`getSettings(keys: string[]): Record<string, string>`、`setSettings(entries: Record<string, string>)`（upsert，空串=删除）。
- Key 约定：`llm.apiKey` / `llm.baseUrl` / `llm.modelName`。（`llm.visionModelName` 不再使用，视觉调用统一走 `modelName`。）

### 2. LLM 配置解析

- `analysis-trigger.service.ts` 与 `analysis.controller.ts` 的 `getLlmConfig()`：**仅读 DB**（`app_settings`），不再读取环境变量 `QWEN_API_KEY`/`QWEN_API_BASE`/`QWEN_MODEL`；缺 `apiKey/baseUrl/modelName` 报错。`visionModelName` 不再使用（视觉模型复用主模型）。`QWEN_VISION_PROXY_URL`/`QWEN_VISION_PROXY_TIMEOUT_MS` 仍为环境变量（本地视觉代理，不属于 LLM 账号凭据）。

### 3. 新端点（`analysis.controller.ts`）

- `GET /api/analysis/config` → `{ apiKeyConfigured, apiKeyMasked, baseUrl, modelName }`（仅 DB 值；apiKeyMasked 为 `****{末4位}` 或空串）。
- `PUT /api/analysis/config` → body `{ apiKey?, baseUrl?, modelName? }`，仅更新传入字段（`apiKey` 空串=清除），返回更新后的 config。
- `POST /api/analysis/config/test` → body `{ apiKey?, baseUrl?, modelName? }`；缺省字段使用**已保存的配置**（不回退环境变量；API Key 未传时用旧 Key，因为前端拿不到明文）。做一次最小 chat 调用，返回 `{ ok: true, model, message }` 或 `{ ok: false, error }`（HTTP 200，完整错误信息，不截断）。
- ~~`GET /api/analysis/models`~~（删除，不再提供预设列表）。

### 4. 前端

- `api/index.ts`：`getAnalysisConfig` / `updateAnalysisConfig` / `testAnalysisConfig` + 类型（移除 visionModelName 与 models）。
- `Settings.tsx`：新增「AI 总结（LLM）设置」区——模型（Input）、API 地址（Input）、API Key（`Input.Password`，掩码提示，留空=不修改）、保存按钮（仅提交脏字段）、「测试连接」按钮（提交当前表单值，展示成功/完整错误信息）、即时生效说明文案。

## Changed Files

1. `packages/server/src/database/database.service.ts`
2. `packages/server/src/analysis/analysis-trigger.service.ts`
3. `packages/server/src/analysis/analysis.controller.ts`
4. `packages/frontend/src/api/index.ts`
5. `packages/frontend/src/pages/Settings.tsx`
6. `docs/testing/2026/08-15-llm-config-frontend.md`（手动验证记录）

## Verification

- `pnpm --filter @bilibili-downloader/server typecheck`
- `pnpm --filter @bilibili-downloader/frontend typecheck`
- `pnpm typecheck`

## Audit

`Audit: cold-replay`。本计划涉及新增数据库表与 API，非 protected 区域（不涉及 app 内 auth/permissions/data-deletion/payment/deployment），非高风险；reviewer availability 为 `none`，采用冷回放自检并记录该限制。API Key 属外部凭据，遵循掩码返回 + 日志脱敏（请求日志仅收集 SAFE_LOG_KEYS 白名单，`apiKey` 不入日志）。

## Closure

2026-08-15 关闭。

- 冷回放自检：确认无遗漏的 `QWEN_*` 配置构建点（trigger service 与 controller 均已 DB 优先/env 回退）；`app_settings` 表在 `initSchema()` 中幂等创建，先于任何读写；PUT 仅更新传入字段、空串清除、日志不含明文 key；`apiKey` 不在 `SAFE_LOG_KEYS` 白名单，测试请求体不会入日志。
- 调整后冷回放：仅保留单模型（移除 visionModelName 于 DB/env/前端三处）；移除 `GET /analysis/models` 与预设列表（前后端均无残留引用）；新增 `POST /analysis/config/test`，缺省字段使用已保存配置（无环境变量回退；API Key 未传时用旧 Key），返回 `{ ok:true, message }` 或 `{ ok:false, error }`（HTTP 200，完整错误不截断）；`getLlmConfig` 与 config 端点仅读 DB，不再读取 `QWEN_API_KEY`/`QWEN_API_BASE`/`QWEN_MODEL`（代码无残留引用；视觉代理 env 保留）。
- 验证：server / frontend / 全仓 `pnpm typecheck` 全部通过。
- 测试记录：`docs/testing/2026/08-15-llm-config-frontend.md`（D2/D3 手工 curl + UI 步骤留用户执行）。
- 记录：`docs/logs/2026/08-15.md`。
