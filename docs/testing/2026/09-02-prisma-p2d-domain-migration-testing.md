# Testing — P2d 域迁移（task / analysis_sub_task → Prisma，P2 收官）

- 日期：2026-09-02
- Plan：`docs/plans/2026-09-02-prisma-p2d-domain-migration-plan.md`
- 结果：**PASS**（50/50 tests；typecheck、build 通过；仅 `database.service.ts` 一处变更）

## 切换内容

### task 域（13 方法）

- `insertTask`：`.create(...)`，默认值链与"updatedAt 恒 now"保持；BIGINT 写入 BigInt 化（cid/fileSize/durationMs）
- `updateTaskProgress`：`.where({id}).update({progress, speed: speed??null, updatedAt})`；**progressBuckets get/set + snapshot 日志逻辑逐行原样**
- `updateTaskStatus`：先 getTaskById 读旧值 → 条件展开式 update（等价原动态 SET）；completedAt 仅 success/failed 写；日志 error/log 分支、progressBuckets.delete 原样
- `getTasks`/`getTaskById`/`listTasksPaginated`/`findLatestTaskByBvidAndCid`/`findCompletedTaskByBvidAndCid`/`findNextCreatedTask`：`.orderBy/.limit/.offset/.first` + **summary 镜像合并**（`mergeSummaryMirror`：按 (bvid,cid) or/and 组合查 ai_summary_task → Map 注入 summaryStatus/summaryOutput，无镜像为 null，等价原 LEFT JOIN；count 不含镜像，与原 SQL 一致）
- `claimNextCreatedTask`：**保留 raw SQL**（单语句原子抢占守卫）；回读走 getTaskById
- `findTasksByBvidsAndCids`：空 pairs 提前返回 `[]`（新钉住）；tuple IN 改 `or(and(bvid.eq, cid.eq)…)`（or 首次运行时实证）；去重 reduce 原样；返回子集含镜像 summaryStatus（新钉住）
- `deleteTask`：sub `.where({taskId}).deleteAll()` → task `.where({id}).delete()`（两步非事务、不清理 summary——现状怪癖保持）；`clearTasks`：双表 `where(id.isNotNull()).deleteAll()`
- 死代码 `findNextCreatedTask` 一并切换（零消费方），处置记入 P4

### analysis_sub_task 域（3 方法 + reconcile 半段）

- `insertAnalysisSubTask`：`.create`（status ?? "created"、可选字段 ?? null、createdAt Instant）
- `updateAnalysisSubTaskStatus`：先查旧行（日志 details）→ 条件展开式 update；日志 error/log 分支原样
- `getAnalysisSubTasks`：`.where({bvid, cid: BigInt}).orderBy(createdAt.asc).all()` + 行映射
- `reconcileStaleAnalysisState` sub 半段：`.where(in(['created'])).updateAll(...)`，count 取 `.length`（替换 P2c 遗留的最后一段域内 raw SQL）

## 等价性证据

- task 域 13 用例（含新增 2 断言：镜像 summaryStatus 有值/null 两态、空 pairs）、analysis-sub 3 用例、type-semantics 5 用例原样通过
- 全量 8 文件 **50/50**；`pnpm typecheck`、`pnpm build` 通过
- diff 复核：仅 `database.service.ts`；**progressBuckets 5 处交互逐行保留**（update get/set、updateStatus delete、deleteTask delete、clearTasks clear）；**日志点 8 处**（task 6 + sub 2）原样；raw SQL 仅剩 claimAiSummaryTask / claimNextCreatedTask（守卫类，恒保留）+ initSchema（P3）；消费方零改动
- 移除死代码：taskSelectSql / aiSummaryTaskSelectSql / aiPromptSelectSql / buildTaskStatusFilter / buildAiSummaryTaskFilter（均无消费方）

## 差异记录

- LEFT JOIN 改两段查询：task 行 + 按 (bvid,cid) 镜像查询合并；UNIQUE(bvid,cid) 保证 Map 安全；行为等价（镜像缺失 → null）
- findTasksByBvidsAndCids 由 tuple IN 改 or/and 组合（语义等价，且比原实现少一次字符串拼参）
