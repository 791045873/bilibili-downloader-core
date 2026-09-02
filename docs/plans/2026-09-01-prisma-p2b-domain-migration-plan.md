# Plan：P2b — 域迁移：summary / summary_segment（含显式事务等价）

> 日期：2026-09-01
> 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
> 需求：`docs/requirements/2026-09-01-prisma-orm-introduction.md`
> 前置：P0、P1、P2a 已闭合
> Audit: 已通过独立 subagent 审计并修订，见 `docs/audits/2026-09-01-plan-audit-prisma-p2b-domain-migration-plan.md`

## 1. Goal

把 `summary` / `summary_segment` 域的数据访问切换为 Prisma 8。本域唯一方法是 `upsertSummaryKnowledge`（显式 BEGIN/COMMIT 多步事务），核心要求是**事务语义等价**：summary upsert + 旧 segments 全量删除重插要么全成要么全回滚。`updateSummaryKnowledgeStatus` 虽被 knowledge-publisher 相邻调用，但它写的是 `ai_summary_task`（P2c 域），**本阶段保持旧栈不动**（master plan 审计既定约束）。

## 2. 已核实事实（P2a/P2b 探查实证）

- 事务：`db.transaction(async (tx) => { ... })`，tx 上同样可访问 `tx.orm.public.<Model>`；回调内抛错即回滚（P2b 探查确认，最终由本轮回滚用例实证）。
- int8 列输入**必须** `bigint`（number 被拒）；JSONB 列输入收 JS 对象（现有 API 传 JSON 字符串 → 转换层 `JSON.parse` 后写入，库内 jsonb 内容等价）。
- Timestamptz 输入必须 `Temporal.Instant`；`summary.created_at/updated_at` 现 SQL 用 `now()`，切换后由转换层生成（同一 Instant 写两列，保持"同值"现状）。
- 既有行为测试 `tests/database/knowledge.test.ts` 已钉住：首写、重复发布幂等（summary 更新 + segments 全量替换）。

## 3. Scope

### 3.1 方法切换（1 个）

`upsertSummaryKnowledge(args)`：
1. `JSON.parse(args.rawResponse)` → 对象（args.rawResponse 为 JSON 字符串；现状 SQL `$6::jsonb` 同样经历一次字符串→jsonb 解析，等价。解析失败行为：现状 SQL 抛错回滚，Prisma 路径 JSON.parse 抛错在事务外抛出、未写库——对外行为一致：调用方收到异常、库无变更；此差异记录于 testing 文档）。
2. `db.transaction(async (tx) => { ... })`：
   - `tx.orm.public.Summary.upsert({ create: {..., rawResponse: parsedObj, createdAt: now, updatedAt: now }, update: { videoTitle, videoUrl, modelName, rawResponse: parsedObj, updatedAt: now }, conflictOn: { bvid, cid } })`
   - 可选字段（timestampSeconds/frameDescription/screenshotUrl）显式 `?? null` 合并（与现 SQL 一致），不传 undefined
   - `await tx.orm.public.SummarySegment.where({ summaryId: upserted.id }).deleteAll()`（deleteAll 需前置 where；0 行时 no-op——首写路径已由既有用例覆盖）
   - 逐条 `tx.orm.public.SummarySegment.create({ summaryId, seq, title, content, timestampSeconds, frameDescription, screenshotUrl })`
   - 返回 summaryId（BigInt→number）。**验证点**：`upsert` 返回行的 id 可直接使用（P2a 未消费过 upsert 返回值）；若实测返回形态不符，回退为 tx 内按 conflictOn 复查一次
3. 保留"Published summary knowledge to cloud"日志点原样。
4. 签名/返回类型（Promise<void>）不变；输入 args 契约不变。

### 3.2 复用

- §3.2 映射层转换器（P2a 已落地于 `database.service.ts`）：`bigintToNumber`、`toIsoString`、`Temporal.Instant` 输入、输入侧 BigInt。
- 补充转换：`parseJsonb(rawResponse: string): object`（JSON.parse，异常向上抛）。

## 4. Out Of Scope

- `updateSummaryKnowledgeStatus`（写 ai_summary_task，P2c 随域切换）。
- `initSchema` / 播种 / 一次性迁移（P3）。
- 消费方文件（knowledge-publisher.service.ts 零改动）。

## 5. 风险

| 风险 | 对策 |
| --- | --- |
| 事务回滚语义不等价（如 upsert 冲突分支、deleteAll 流式消费） | 用例覆盖：成功路径、重复发布幂等（既有）、**回滚路径**（确定性 DB 级注入：segments 内重复 `seq`，第二条 INSERT 违反 `summary_segment_summary_id_seq_key`，保证失败发生在 summary upsert 与首条 insert 之后）→ 断言首写场景 summary 无残留行；重复发布场景旧数据存活。非法字段（如缺 title）可能在客户端校验期抛错——仍回滚，但属客户端校验，不作为 DB 回滚的证明依据 |
| `rawResponse` JSON.parse 抛错点从 SQL 内移到 SQL 外 | 对外异常行为一致（调用方收到异常、库无变更）；testing 文档记录差异 |
| segments 循环单条 create 性能（现状同为逐条 INSERT） | 现状即逐条，等价优先；数据量小（单次总结 ≤ 数十条） |
| `deleteAll` 类型强制前置 where / 流式返回只可消费一次 | `await` 一次消费；typecheck 实证；0 行删除 no-op |

## 6. 验证与闭合判据

1. 既有 knowledge.test.ts 2 用例原样通过 + 新增回滚用例；全量 47+ 用例绿；`pnpm typecheck`、`pnpm build` 通过。
2. diff 复核：`upsertSummaryKnowledge` 签名不变、日志点原样、`updateSummaryKnowledgeStatus` 未动、消费方零改动。
3. `docs/testing/` 追加 P2b 记录、`docs/logs/` 日志、总 plan checklist、`project-context.md` Active plan 行。
4. cold-replay 闭合自检。

## 7. Checklist

- [x] `upsertSummaryKnowledge` 切换（transaction + upsert + deleteAll + create 循环 + JSONB 解析）
- [x] 回滚用例新增（2 例：首写无残留、重复发布旧数据存活）
- [x] 全量回归 + diff 复核（48/48、typecheck、build；仅 database.service.ts 一处）
- [x] 文档同步 + cold-replay 闭合（2026-09-01：对照 §3.1/§6 与 testing 证据逐项核对；upsert 返回行验证点实测通过、无需回退）

## 8. Closure 记录

- §6 判据 1–4 全部满足；本域不含保护区删除路径，cold-replay 闭合合规。
- §3.1 实测确认：upsert 返回行可直接使用；`JSON.parse` 失败点外移属既记录差异，对外行为一致。
