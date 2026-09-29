# 09-28 云端/NAS Phase 1b 内联发布 + 本地下线 Testing

> 需求：`docs/requirements/2026-09-17-cloud-inline-publish-local-retire.md`
> 计划：`docs/plans/2026-09-28-cloud-inline-publish-local-retire-plan.md`
> 定位：记录需求级观察态（应呈现/不应呈现），非测试脚本。

## 检查应覆盖的状态

### T1 内联发布 + 完成门槛

- 分析成功后 `summary` + `summary_segment`（含 `screenshot_url`）已写入云 DB。
- **内容入库成功才** `ai_summary_task.status = completed`；内容写库失败则 `failed`（不置 completed）。
- 该 `completed` 记录在无本地 md/截图环境下可被 Phase 1a 渲染接口正确返回。
- 不应出现：先 completed 再异步补发布（旧 fire-and-forget 时序）。

### T2 截图不阻塞完成

- 截图上传失败 / COS 未配置 → 内容仍入库并 `completed`，`screenshot_url` 为空。
- 不应出现：因截图失败把记录置 `failed`。

### T3 段↔截图结构化映射（B3）

- 截图按分析引擎输出的 `segments[].screenshotFiles` 结构上传并回写对应段 `screenshot_url`。
- 不应出现：读取本地 md、用正则反解图片链接。

### T4 H4 raw_response 隔离

- LLM 成功、后续步骤失败 → `status=failed`，`raw_response` 保留模型 JSON，`error_message` 记录原因。
- LLM 本身失败 → `status=failed`，`raw_response` 为 NULL，`error_message` 记录错误。
- 不应出现：`raw_response` 被写成错误串。

### T5 重跑幂等

- 重跑分析按 `(summary_id, seq)` 原地 upsert，删除多余尾行；文本变更行向量置空后重算（沿用既有语义）。

### T6 停止写本地 + 移除挂载

- 分析不再产出对外本地 md 与本地截图副本；`summary_output` 不再写入。
- `/summary-files` 静态挂载已移除；服务端不再产出该前缀链接；无悬空 helper import。
- **既有历史本地文件未被删除**（删除属 Phase 4）。

### T7 端点下线

- `POST /api/summary-tasks/:id/publish`、`POST/GET /api/knowledge/backfill`、`POST /api/summary-tasks/repair` 均返回 404（路由不存在）。
- 前端无 publish / repair 调用入口；`AiSummaryTasks.tsx` 不再展示 `knowledge_status` 标签。

### T8 无回归

- 触发→分析→查看总结（Phase 1a 渲染）正常；QA 来源"AI 总结"整页正常。
- rebuild 端点本切片未改动（其收窄属独立需求）；不因本切片报错。

## 验证命令

- `pnpm --filter @bilibili-downloader/server test`（测试容器，`TEST_DATABASE_URL`）
- `pnpm typecheck`
- `pnpm build`

## 结论

- 状态：**通过（2026-09-29）**。
- T1/T2（内联发布、内容入库=completed、截图不阻塞）：由 `publishInline` 服务测试与 trigger 代码路径覆盖（内容 upsert 成功即 completed；COS/embedding best-effort 不回退 failed）；单测见 `tests/knowledge/vector-search.test.ts`。
- T3（B3 结构化映射）：新增用例断言 `screenshotFiles → COS 上传并回写 screenshot_url`，空段回写 null。
- T4（H4）：trigger 三处失败路径已移除 `rawResponse` 写入（代码级）；由 `upsertAiSummaryTask` 语义（未传即保留/NULL）保证不写错误串。**运行级组合断言留待部署后人工确认**（E2E=none，trigger 集成层不做重型 mock）。
- T5（重跑 upsert 清尾行）：由既有 `tests/database/knowledge.test.ts` 覆盖。
- T6（停写本地 + 移除挂载）：engine 去 writeFile、main.ts 去 useStaticAssets（代码级）；grep 无 `/summary-files` 产出。
- T7（端点下线）：publish/backfill/repair 路由与前端引用均已删除（typecheck/build 绿、grep 无残留）；运行级 404 留待部署后确认。
- T8（无回归）：全套 server 测试 18 文件 / 128 项通过；rebuild 仅连带适配发布器契约、语义未改。
- 已知副作用（已裁决）：本地 md 停写后，旧"本地完整性检查"会误报缺失，由「完整性检查重定义」需求承接（Phase 1b Non-Goal）。
