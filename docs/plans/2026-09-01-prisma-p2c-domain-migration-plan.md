# Plan：P2c — 域迁移：ai_summary_task

> 日期：2026-09-01
> 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
> 需求：`docs/requirements/2026-09-01-prisma-orm-introduction.md`
> 前置：P0、P1、P2a、P2b 已闭合
> Audit: 已通过独立 subagent 审计并修订，见 `docs/audits/2026-09-01-plan-audit-prisma-p2c-domain-migration-plan.md`

## 1. Goal

把 `ai_summary_task` 域的数据访问切换为 Prisma 8。域内共 8 个方法：**7 个切换**（含 `reconcileStaleAnalysisState` 的 ai_summary_task 半段、自 P2b 移交的 `updateSummaryKnowledgeStatus`），**1 个保留 raw SQL**——`claimAiSummaryTask` 的原子认领守卫（`INSERT ... ON CONFLICT ... DO UPDATE ... WHERE status NOT IN ('pending','analyzing')`，master plan 既定约束，Prisma `upsert` 无条件守卫不可等价改写）。`reconcileStaleAnalysisState` 的 analysis_sub_task 半段保持旧栈至 P2d。方法签名、返回类型、日志行为零变更。

## 2. 已核实事实（P2c 探查实证，接续 P2a/P2b findings）

- **count**：`.aggregate((f) => ({ count: f.count() }))`（`f.count()` 单独不行，需对象选择器；where 链后可用）。
- **notIn**：表达式方法 `.notIn([...])` 可用 → `deleteAiSummaryTask` 的 `status NOT IN ('pending','analyzing')` 可类型安全表达，**无需 raw SQL**。
- **where 链式调用 = AND**：`.where({...}).where((m) => ...)` 组合过滤。
- **orderBy/limit/offset** 与 P2b 事务语义已实证。
- **updateAll 返回受影响行数组**（length 即 rowCount）。
- **JSON.stringify 含 BigInt 会抛**——P2c 起映射层兜底输出类型转换（本域全部 BigInt 字段经 `bigintToNumber`）。

## 3. Scope

### 3.1 逐方法切换（7 个，其中 1 个保留 raw SQL）

| 方法 | 处理 |
| --- | --- |
| claimAiSummaryTask | **保留 raw SQL**（守卫语义不可改写）；仅把回读 `getAiSummaryTaskByResource` 走 Prisma |
| getAiSummaryTaskByResource | `.where({bvid, cid: BigInt}).first()` |
| getAiSummaryTaskById | `.where({id: BigInt}).first()` |
| upsertAiSummaryTask | 既有"读旧值→字段保留计算"逻辑保留，写路径换 `.upsert({create, update, conflictOn: {bvid, cid}})`；保留"Persisted AI summary task"日志 |
| deleteAiSummaryTask | `.where({id}).where((m) => m.status.notIn(['pending','analyzing'])).delete()` → 返回内容非空即 true（兼容 Row/null 与空数组两种形态）；保留日志 |
| listAiSummaryTasksPaginated | 条件经 `and(...)`（自 `@prisma/orm-postgres/orm-client` 导入）单次 `.where` 组合：status `.in`、search `m.title.ilike('%' + escapeLikePattern(search) + '%')`（**含 % 包裹**）、updatedFrom/To `.gte/.lte(Instant)` + `aggregate count` + `orderBy(updatedAt desc).limit.offset`；空 keys 提前返回保持 |
| reconcileStaleAnalysisState | 仅 summary 半段：`.where((m) => m.status.in(['pending','analyzing'])).updateAll({status:'failed', errorMessage, updatedAt, lastCompletedAt})`，count 取 `.length`；sub-task 半段原 SQL 不动 |
| updateSummaryKnowledgeStatus | `.where({bvid, cid: BigInt}).update({knowledgeStatus, knowledgeError: error ?? null（显式 null，钉住"清空错误"语义）, updatedAt})`（自 P2b 移交本域） |

- 行映射（`aiSummaryTaskSelectSql` 等价）：id/cid/sourceTaskId BIGINT→number、promptId INTEGER 直通、4 个 timestamptz（created_at/updated_at/last_triggered_at/last_completed_at）→ISO 字符串（`toIsoString`）、其余 TEXT 直通。
- 输入转换：cid→BigInt；时间字符串→`Temporal.Instant.from(...)`（新增映射层辅助 `toInstant`，接受 ISO 字符串/Instant）；无效时间字符串在 `Instant.from` 抛错——与现状 PG 拒绝非法输入一致，差异记录 testing 文档。
- **upsertAiSummaryTask 冲突分支语义钉住**（Prisma 部分更新会保留旧值，与现 SQL `EXCLUDED` 全量覆盖不同）：update 载荷必须显式包含全部覆盖字段——`title/sourceTaskId/status/summaryOutput/errorMessage` 为 `?? null`，`lastTriggeredAt/lastCompletedAt` 未提供时**显式置 null**（测试钉住"抹除"语义）；`promptId/executionTiming/rawResponse/modelName` 用保留计算值；**update 分支不含 createdAt**（现 SQL 冲突时不改 created_at）。
- 时间戳过滤语义：updatedFrom/To 边界为 `>=`/`<=`，与现 SQL 一致；比较输入用 `Temporal.Instant.from(filterString)`。
- search：`m.title.ilike(escapeLikePattern(filter.search))`——PG LIKE 默认转义符即反斜杠，与现 `ESCAPE '\\'` 等价；NULL title 两种实现均不命中，等价。
- ilike 探查已通过（本域 trait 'ilike' 为 PG 专属，见 P2c 探查）。

### 3.2 复用

- P2a 映射层 + P2b 事务语义（本域无多步事务需求）。
- 既有测试 `tests/database/ai-summary-task.test.ts`（9 用例：claim 守卫/并发、字段保留、条件删除、过滤、对账、合并迁移）即等价性证据。

## 4. Out Of Scope

- task / analysis_sub_task（P2d）；`reconcileStaleAnalysisState` 的 sub-task 半段。
- `initSchema` 合并迁移 SQL（P3 前保持，测试继续覆盖）。
- 消费方文件（analysis-trigger.service、analysis controllers、knowledge-publisher.service 零改动；其中 knowledge-publisher 是 `updateSummaryKnowledgeStatus` 的消费方，签名不变故无需改动）。

## 5. 风险

| 风险 | 对策 |
| --- | --- |
| raw SQL 写 + Prisma 读混合（claim 后回读） | 写后已提交、Prisma 独立连接可见；claim 并发用例覆盖 |
| ilike 的转义语义与 `ESCAPE '\\'` 有差异 | 测试 search 用例（含 `_` 转义）覆盖；失败则该过滤保留 raw SQL 并记录 |
| `Instant.from` 对非法字符串抛错点前移（PG 拒绝→JS 抛） | 对外仍为异常；testing 文档记录 |
| `m.title.ilike` 对 nullable 列的类型/运行时行为 | typecheck + 测试实证 |
| updateAll 的 updatedAt/lastCompletedAt 同 Instant 双写 | 与现 SQL `$2` 双列同值一致 |

## 6. 验证与闭合判据

1. 既有 ai-summary-task 域 11 用例原样通过；全量 48+ 用例绿；typecheck、build 通过。
2. diff 复核：方法签名不变、raw SQL 仅剩 claimAiSummaryTask（+analysis_sub_task 半段）、日志点原样、消费方零改动。
3. `docs/testing/` 追加 P2c 记录、`docs/logs/` 日志、总 plan checklist、`project-context.md` Active plan 行。
4. cold-replay 闭合自检：deleteAiSummaryTask 属数据删除路径，其契约测试（pending/analyzing 拒绝返回 false）已于 P0 建立并作为本阶段安全网；master plan §7 授权覆盖。

## 7. Checklist

- [x] 7 方法切换（含 reconcile 半段、updateSummaryKnowledgeStatus 移交）+ claimAiSummaryTask raw SQL 保留
- [x] 映射层 `toInstant` 辅助 + upsert 冲突分支显式 null 语义
- [x] 全量回归 + diff 复核（49/49、typecheck、build；仅 database.service.ts 一处）
- [x] 文档同步 + cold-replay 闭合（2026-09-02：§3.1 逐方法核对；实施期修正 null 保留语义与 and 组合器方案，均记录于 testing 文档）

## 8. Closure 记录

- §6 判据 1–4 全部满足；删除路径安全网（deleteAiSummaryTask 契约测试）原样通过。
- 实施期偏差（等价性不变，已记录 testing 文档）：null 直通映射（替代 ?? undefined）；and 组合器经 orm-client 导入；aggregate 对象选择器；大 cid 断言补入 type-semantics。
