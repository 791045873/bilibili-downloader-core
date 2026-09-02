# Testing — P2c 域迁移（ai_summary_task → Prisma）

- 日期：2026-09-02
- Plan：`docs/plans/2026-09-01-prisma-p2c-domain-migration-plan.md`
- 结果：**PASS**（49/49 tests；typecheck、build 通过；仅 `database.service.ts` 一处变更）

## 切换内容（8 方法：7 切换 + 1 raw SQL 保留）

| 方法 | 处理 |
| --- | --- |
| claimAiSummaryTask | **保留 raw SQL**（`ON CONFLICT ... WHERE` 原子守卫，master plan 既定约束）；回读走 Prisma |
| getAiSummaryTaskByResource / getAiSummaryTaskById | `.where().first()` |
| upsertAiSummaryTask | 字段保留计算保留；写路径 `.upsert({create, update, conflictOn: {bvid, cid}})`；**update 分支显式全量覆盖**（`?? null`、lastTriggeredAt/lastCompletedAt 未提供显式置 null、不含 createdAt）——与现 SQL `EXCLUDED` 语义一致 |
| deleteAiSummaryTask | `.where({id}).where(notIn(['pending','analyzing'])).delete()`，返回非空 → true |
| listAiSummaryTasksPaginated | `and(...)` 单回调组合过滤（status.in / title.ilike('%…%') / updatedAt.gte/lte(Instant)）+ `aggregate((f)=>({count: f.count()}))` + orderBy/limit/offset |
| reconcileStaleAnalysisState | summary 半段 `.where(in(['pending','analyzing'])).updateAll(...)`，count 取 `.length`；sub-task 半段保持旧 SQL（P2d） |
| updateSummaryKnowledgeStatus | `.where({bvid, cid}).update({knowledgeStatus, knowledgeError: error ?? null, updatedAt})`（自 P2b 移交） |

## 实施期发现（P2d/P3 复用）

1. **null vs undefined 语义**：pg 直通行的 nullable 字段运行时是 `null`，P0 测试按此钉住；Prisma 映射层必须**保留 null**（不能 `?? undefined`）——首轮 3 用例因此失败后修正。`toIsoString` 对 null 返回 null（AiPrompt 等非空列用 `?? undefined` 适配可选类型）。
2. **多条件 AND**：`and(...exprs)` 组合器自 `@prisma/orm-postgres/orm-client` 导入；`.where()` 链式亦可但 reassignment 类型难表达，统一用单回调 + and。
3. **aggregate count**：`aggregate((f) => ({ count: f.count() }))`（对象选择器，`f.count()` 单独无效）。
4. **notIn**：表达式方法直接可用，条件删除无需 raw SQL。
5. 大 cid（99999999999）int8→number 断言补入 type-semantics（审计建议）。

## 等价性证据

- ai-summary-task 域 11 用例原样通过（claim 并发恰一次、守卫语义、字段保留含 lastCompletedAt 抹除、条件删除 boolean、过滤含 ILIKE 转义/时间窗、启动对账、合并迁移）。
- type-semantics 域 5 用例通过（含新增大 cid）。
- 全量 9 文件 **49/49**；`pnpm typecheck`、`pnpm build` 通过。
- diff 复核：仅 `database.service.ts`；raw SQL 仅剩 claimAiSummaryTask + analysis_sub_task 半段 + initSchema（P3 前）；消费方零改动。

## 差异记录

- 时间过滤/写入由 ISO 字符串改为 `Temporal.Instant.from(...)`；非法时间串抛错点从 PG 前移到 JS，对外仍为异常。
- claim 后回读经 Prisma 独立连接：raw SQL 已提交写入对 Prisma 可见（并发用例覆盖）。
