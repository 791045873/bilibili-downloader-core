# Testing - 2026-08-15 LLM 配置前端化（模型 + API Key）

## Meta

- Plan: `docs/plans/2026-08-15-llm-config-frontend.md`
- Date: 2026-08-15
- 验证范围：DB settings 存储、config 端点、getLlmConfig 优先级、前端设置页 UI

## Directions

### D1 类型检查

- Status: passed
- Evidence: `pnpm --filter @bilibili-downloader/server typecheck`、`pnpm --filter @bilibili-downloader/frontend typecheck`、全仓 `pnpm typecheck`（6 包）全部 Done，零错误。

### D2 端点行为（curl 实测）

- Status: manual - 待执行
- Steps:
  1. `GET /api/analysis/config` 返回 `{ apiKeyConfigured, apiKeyMasked, baseUrl, modelName }`（无 visionModelName 字段），key 未配置时 `apiKeyConfigured=false`、`apiKeyMasked=""`；有环境变量时返回 env 生效值。
  2. `PUT /api/analysis/config` 仅传 `{ modelName: "qwen3-flash" }`，返回更新后的 config，`modelName` 变化且其余字段保持。
  3. `PUT /api/analysis/config` 传 `{ apiKey: "" }`，key 被清除，`apiKeyConfigured=false`。
  4. `POST /api/analysis/config/test` 传正确 apikey/url/model → `{ ok:true, message:"连接成功..." }`；传错误 key → `{ ok:false, error:"HTTP 401: <完整错误体>" }`（完整错误信息不截断）。
  5. 测试回退验证：仅传 `{ baseUrl, modelName }`（不含 apiKey）→ 使用已保存的旧 Key 调用成功。
  6. 无 env 回退验证：清除 DB 中 `llm.*` 配置后，即使环境变量 `QWEN_API_KEY`/`QWEN_API_BASE`/`QWEN_MODEL` 存在，`GET /api/analysis/config` 返回空值、`getLlmConfig` 报「缺少 LLM 配置」。
  7. 端到端：修改模型后，对一个 pending/failed 的 AI 总结任务触发重跑，观察 `ai_summary_task.model_name` 为最新模型（即时生效验证）。
  8. 日志检查：PUT/测试请求日志不包含 apiKey 明文。
  9. `GET /api/analysis/models` 应 404（端点已删除）。

### D3 前端设置页 UI

- Status: manual - 待执行
- Steps:
  1. 打开 `/settings`，出现「AI 总结（LLM）设置」卡片，含模型（普通输入框）、API 地址、API Key（密码框显示掩码占位），无视觉模型字段、无预设模型下拉。
  2. 修改模型并保存 → 「已保存 ✓」，刷新后模型值保持。
  3. 不改动字段直接保存 → 无网络请求、无状态变化。
  4. 输入新 API Key 保存 → 自动 refetch 后占位变为「已配置，输入以替换」；清除 Key 保存 → 「未配置，输入以设置」。
  5. 点击「测试连接」：填写正确配置 → 绿色「测试成功：连接成功...」；填入错误 key/model → 红色「测试失败：<完整错误信息>」；测试期间按钮 loading。
