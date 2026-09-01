# 2026-08-24 AI 总结截图上传 COS 与知识发布管道（Phase 1）日志

> 关联计划：`docs/plans/2026-08-24-cos-summary-knowledge-publish-plan.md`
> 需求：`docs/requirements/2026-08-24-cos-summary-knowledge-publish.md`
> 测试文档：`docs/testing/2026/08-24-cos-summary-knowledge-publish.md`

## 范围

- 分析完成后异步发布：截图上传腾讯云 COS（公网 URL）+ 总结知识写入云端 `summary`/`summary_segment`（与本地同一 PostgreSQL 库）+ 本地 md 图片链接改写为 COS URL。
- `ai_summary_task` 增 `knowledge_status`/`knowledge_error`；提供 `POST /api/summary-tasks/:id/publish` 重试；前端列表展示发布状态并提供"发布"入口。
- 本地截图/md 备份保留（影子双写）；用户穿搭照片、向量化/RAG、问答服务、历史回填不在本轮。

## 决策

- COS 用 `cos-nodejs-sdk-v5`（server 本地模块 `knowledge/`），凭据 `TENCENT_COS_SECRET_ID/KEY/REGION/BUCKET`；公网 URL 默认 `https://<bucket>.cos.<region>.myqcloud.com`（可 `TENCENT_COS_PUBLIC_URL_PREFIX` 覆盖）。
- md 改指 COS：发布时重写本地 md 相对图片链接为 COS 公网 URL（绝对 URL 原样保留），现有 markdown 端点对绝对 URL 透传，无需改端点。
- 幂等：云端按 (bvid,cid) 事务内删旧插新；重试已发布总结时沿用 md 中已存在的 COS 绝对 URL，不重传。
- 发布状态：pending → synced/failed；失败不影响本地完成态；缺 COS 配置置 failed。

## 实施

- `packages/server/src/knowledge/cos-store.service.ts`：COS 薄封装（配置读取、putObject 上传、publicUrl）。
- `packages/server/src/knowledge/knowledge-publisher.service.ts`：解析 raw_response→segments、按 md 图片引用上传本地截图、upsert summary/segments、重写 md、更新 knowledge_status。
- `database.service.ts`：`summary`/`summary_segment` 建表（UNIQUE(bvid,cid)、FK 级联、(summary_id,seq) 唯一）、`ai_summary_task` 增 `knowledge_status`/`knowledge_error`（IF NOT EXISTS）、`upsertSummaryKnowledge`/`updateSummaryKnowledgeStatus`。
- `analysis-trigger.service.ts`：`runAnalysis`/`runRebuild` completed 分支挂载异步发布（fire-and-forget + 错误捕获）。
- `analysis-task.controller.ts`：`POST /summary-tasks/:id/publish`（仅 completed + raw_response 非空）。
- 前端：`AiSummaryTaskEntry` 增字段；列表"状态"列加发布 Tag、"操作"列加"发布"按钮。
- 部署：compose 注入 `TENCENT_COS_*`（占位透传）；`.env.example` 补充 COS 配置与"桶需公有读"提醒。

## 验证

- 端到端（测试记录 TESTCOS/999，发布后清理）：上传 COS 成功、`summary`+2 `summary_segment`（timestamp_seconds 5/10、screenshot_url=COS URL）、本地 md 改写为 COS URL、`knowledge_status=synced`；幂等与清理正常。
- `pnpm typecheck`、`pnpm build`、`pnpm docker:build:server` 通过；镜像含 `cos-nodejs-sdk-v5`；凭据不入镜像。
- 测试方向 TD-1~8 回填：TD-1 公网读、TD-3 自动挂载、TD-4 失败注入、TD-5 UI 交互标注 out of scope/待真实环境确认。

## 未决事项

- **目标桶 `ai-summary-1325700411` 当前私有读（匿名 GET 403）**：需用户在 COS 控制台开通"公有读私有写"后，md 预览图片方可公网显示（代码无关）。备选：改用签名 URL（独立决策）。
- 历史 89 条已完成总结回填（Phase 4）；向量化/RAG（Phase 2）；问答服务与穿搭照片（Phase 3）——后续需求。
- 计划关闭由用户人工确认。

## 2026-09-01 追记：桶公网读已开通并复验

- 用户确认桶已开通"公有读私有写"。
- 复验方法：对不存在对象 `summary/TESTCOS-999/screenshots/segment-0-frame-0.jpg` 匿名 GET——私有读桶返回 403，公有读桶返回 404 NoSuchKey。
- 实测结果：HTTP 404，响应体 `<Code>NoSuchKey</Code>`，确认公网读生效（2026-08-24 首测为 403）。
- 已回填：测试文档 TD-1/TD-6 状态改 `passed`、计划 Deferred"COS 桶公网读权限"改 `resolved`、计划 Closure Status Note 更新。原未决事项第一条就此解决，无剩余代码侧 follow-up。
- **计划已关闭**（2026-09-01 用户确认）：`Plan Status: closed`；`project-context.md` active requirement / active plan 置 `none`。