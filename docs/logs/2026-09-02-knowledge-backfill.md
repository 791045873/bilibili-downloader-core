# Log — 2026-09-02 knowledge-backfill（历史总结知识回填批量接口）

- Plan（2026-09-01 起草）经 Prisma 迁移后基线核对 + 独立 subagent 审计（PASS WITH REVISIONS）后实施：
  - 门面新增 `listAiSummaryTasksForKnowledgeBackfill()`：completed + rawResponse 非空 + 非 synced；**审计钉住的关键语义**——`knowledge_status` 可空，裸 notIn 会把 NULL 行（回填主体）静默排除，必须 `or(isNull, notIn)`；自动化用例钉住。
  - `knowledge-backfill.service.ts`：内存态单批次、并发 2、每条经 `getAiSummaryTaskById` 重查（publish 无 synced 守卫）、失败隔离不中断、skipped/synced/failed 计数 + failures 明细。
  - `knowledge-backfill.controller.ts`：POST（运行中 409/空集 {total:0}/启动 {message,total}）+ GET 进度。
- 验证：49/49（含新增回填集合语义用例）、typecheck、build 通过；本地冒烟：空集 POST 201 {total:0}、GET 200 idle 结构正确。
- 测试文档 TD 状态更新：TD-6 passed；TD-1/3 本地冒烟部分验证；TD-2 全量、TD-4 运行中 409、TD-5 混合成败 → 部署后用户触发确认（user-confirmed）。
- 闭合：cold-replay 自检（非保护区）。后续：用户部署镜像后触发真实回填；Phase 2 向量化（数据前置已就绪）。
