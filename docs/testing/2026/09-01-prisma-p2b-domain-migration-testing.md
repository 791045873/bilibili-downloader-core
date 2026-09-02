# Testing — P2b 域迁移（summary / summary_segment → Prisma，事务等价）

- 日期：2026-09-01
- Plan：`docs/plans/2026-09-01-prisma-p2b-domain-migration-plan.md`
- 结果：**PASS**（48/48 tests；typecheck、build 通过；仅 `database.service.ts` 一处变更）

## 切换内容

- `upsertSummaryKnowledge`：显式 BEGIN/COMMIT/ROLLBACK → `db.transaction(async (tx) => ...)`：
  - `Summary.upsert`（create 含 createdAt/updatedAt 同一 Instant；update 仅 updatedAt —— 与现 SQL now() 写入位置逐条对应；`conflictOn: { bvid, cid }`）
  - `SummarySegment.where({ summaryId }).deleteAll()` 全量删除旧 segments（0 行 no-op）
  - 逐条 `create` 重插（可选字段 `?? null` 合并，与现 SQL 一致）
  - `rawResponse` 经 `JSON.parse` 写 JSONB（库内内容与 `$6::jsonb` 等价）
  - "Published summary knowledge to cloud" 日志点原样保留
- `updateSummaryKnowledgeStatus` **保持旧栈**（写 ai_summary_task，属 P2c 域）——master plan 审计既定约束。

## 事务语义实证（新增 2 用例）

1. **首写回滚**：segments 内重复 `seq` → 第二条 INSERT 违反 `summary_segment_summary_id_seq_key`，事务中段失败 → 断言 rejects 且 summary/summary_segment 均无残留行（证明 Prisma 事务回调抛错即回滚，等价于现 ROLLBACK）。
2. **重复发布回滚**：旧数据存活（segments 仍为旧 1 条 "keep"）——失败不破坏既有状态。

## 等价性证据

- 既有 knowledge.test.ts 2 用例（首写、重复发布幂等）原样通过；`toEqual({ tips: [] })` 钉住 JSON.parse→JSONB 内容等价；`frame_description` null 断言钉住可选字段 `?? null` 语义。
- task.test.ts 删除契约用例（经 upsertSummaryKnowledge 写 summary 后 deleteTask 保留）原样通过。
- 全量：8 文件 **48/48** 通过；`pnpm typecheck`、`pnpm build` 通过。
- diff 复核：仅 `database.service.ts` 变更；签名/args 契约不变；消费方 knowledge-publisher.service.ts 零改动。

## 差异记录

- `JSON.parse` 失败点从 SQL 内移到事务外：对外行为一致（调用方收到异常、库无变更）。
- `upsert` 返回行 id 可直接使用（P2b 实测，无需 tx 内复查回退）。
