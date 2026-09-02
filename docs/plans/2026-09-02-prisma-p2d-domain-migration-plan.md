# Plan：P2d — 域迁移：task / analysis_sub_task（最终域）

> 日期：2026-09-02
> 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
> 需求：`docs/requirements/2026-09-01-prisma-orm-introduction.md`
> 前置：P0、P1、P2a、P2b、P2c 已闭合
> Audit: 已通过独立 subagent 审计并修订，见 `docs/audits/2026-09-02-plan-audit-prisma-p2d-domain-migration-plan.md`

## 1. Goal

把最后两个域 `task`、`analysis_sub_task` 切换为 Prisma 8，完成 P2 阶段。**`claimNextCreatedTask` 的单语句原子抢占保留 raw SQL**（与 claimAiSummaryTask 同理，master plan 既定约束）；`findTasksByBvidsAndCids` 的 tuple IN 改用 `or(and(bvid,cid)…)` 组合表达（P2c 实证 and/or 可用，无需 raw）。`progressBuckets` 进程内日志去重逻辑**原样保留在门面层**（总 plan §3 既定义务，实施证据靠 diff 复核——无 DB 可观察效应，测试无法钉住）。方法签名、返回类型、日志行为零变更。

## 2. 已核实事实

- 消费方清单（live grep）：download.service/controller/scheduler、analysis-video-resolver、analysis-trigger；`findNextCreatedTask` **无任何消费方**（死代码，被 claimNextCreatedTask 取代）——本轮仍切换（一行查询），死代码处置记入 P4 待办。
- 既有等价性测试：`packages/server/tests/database/task.test.ts`（**13 用例**：默认值/动态 SET/FIFO 抢占+并发/状态组分页/JOIN 镜像/元组去重/删除契约/clearTasks）、`packages/server/tests/database/analysis-sub-task.test.ts`（3 用例）、`packages/server/tests/database/type-semantics.test.ts`（5 用例）。
- P2a–P2c API 事实直接复用：**and 组合器经 P2c 实证；or 经类型导出核实、P2d 首次运行时验证**；aggregate count、updateAll 返回行数组、deleteAll 前置 where、null 直通映射、Temporal 输入、`toInstant`/`bigintToNumber`/`toIsoString`。

## 3. Scope

### 3.1 task 域（13 方法）

| 方法 | 处理 |
| --- | --- |
| insertTask | `.create({...})`：createdAt=record.createdAt??now（Instant），updatedAt=now（恒覆盖，忽略传入）；默认值由门面现有 `??` 链保持；保留日志 |
| updateTaskProgress | `.where({id}).update({progress, speed: speed??null, updatedAt})`；**progressBuckets 去重 + "Persisted task progress snapshot" 日志逻辑原样保留** |
| updateTaskStatus | 先 `getTaskById`（现读旧值逻辑不变）→ `.where({id}).update({status, updatedAt: now, completedAt: success/failed?now:undefined…动态字段})`；completedAt 仅 success/failed 写（undefined 时 Prisma 部分更新=不写，等价现动态 SET）；日志 error/log 分支、progressBuckets.delete 原样 |
| getTasks | `.orderBy(createdAt.desc()).all()` + summary 镜像合并 |
| getTaskById | `.where({id}).first()` + 镜像合并 |
| listTasksPaginated | 状态组展开（buildTaskStatusFilter 逻辑保留为 statuses 数组）→ `.where(m.status.in(statuses))`（空=all）+ aggregate count + orderBy/limit/offset + 镜像合并 |
| claimNextCreatedTask | **保留 raw SQL**（原子子查询抢占）；回读走 getTaskById（Prisma）；保留日志 |
| findLatestTaskByBvidAndCid | `.where({bvid, cid}).orderBy(createdAt.desc).first()` + 镜像合并 |
| findCompletedTaskByBvidAndCid | 同上 + status eq 'success' |
| findTasksByBvidsAndCids | **空 pairs 提前返回 `[]`**（现实现行为，保持）；`.where(or(...pairs.map(p => and(m.bvid.eq(p.bvid), m.cid.eq(BigInt(p.cid))))))` + orderBy desc + 门面去重 reduce 原样；返回子集**含 summary 镜像 summaryStatus**（补测试断言钉住） |
| deleteTask | `.where({taskId}).deleteAll()` → `.where({id}).delete()`；保留日志；两步非事务、不清理 summary（现状怪癖，P0 测试钉住） |
| clearTasks | sub `.deleteAll()` → task `.deleteAll()`（顺序保持，FK 依赖） |
| findNextCreatedTask | `.where({status:'created'}).orderBy(createdAt.asc).first()` + 镜像合并（死代码，P4 处置） |

**summary 镜像合并**（taskSelectSql LEFT JOIN 等价）：新增私有 `mergeSummaryMirror(rows)`——收集 (bvid,cid) 非空对（去重）→ `aiSummaryTask.where(or(and(bvid.eq,cid.eq)…)).all()` → 按 (bvid,cid) 建 Map → rows 逐一注入 `summaryStatus`/`summaryOutput`（无镜像行为 null，P0 钉住；`ai_summary_task` 有 UNIQUE(bvid,cid)，Map 合并安全）。单行 getTaskById 复用同一合并。

**task 行映射**（新增 `mapTaskRow`，§3.2 同风格）：id BIGINT→number；cid/fileSize/durationMs BIGINT→number（**null 直通**，P2c 教训）；其余 TEXT/INTEGER/DOUBLE 直通；createdAt/updatedAt/completedAt→ISO（null→null）；`summaryStatus`/`summaryOutput` 由镜像合并注入（初值 null）。写入侧：cid/fileSize/durationMs→BigInt。

### 3.2 analysis_sub_task 域（3 方法 + reconcile 半段）

| 方法 | 处理 |
| --- | --- |
| insertAnalysisSubTask | `.create({...})`（taskId BigInt、quality ?? null、**status ?? "created"**、outputFile/errorMessage/completedAt `?? null`、createdAt 必填 Instant）；保留日志 |
| updateAnalysisSubTaskStatus | 先查旧行（日志 details 需要）→ `.where({id}).update({动态字段})`；日志 error/log 分支原样 |
| getAnalysisSubTasks | `.where({bvid, cid: BigInt}).orderBy(createdAt.asc).all()` + 行映射（id/taskId/**cid** BigInt→number，createdAt/**completedAt**→ISO，quality 直通） |
| reconcileStaleAnalysisState sub 半段 | `.where(m.status.in(['created'])).updateAll({status:'failed', errorMessage, completedAt})`，count 取 `.length`（替换 P2c 遗留的 subRes SQL） |

## 4. Out Of Scope

- claimNextCreatedTask / claimAiSummaryTask raw SQL（P3 恒保留或随迁移工具演进，本轮不动）。
- initSchema DDL / supersede 迁移 / 播种（P3）。
- 消费方文件；findNextCreatedTask 死代码删除（P4 处置）。

## 5. 风险

| 风险 | 对策 |
| --- | --- |
| LEFT JOIN 镜像改两段查询的等价性 | 镜像按 (bvid,cid) 精确匹配；P0 测试钉住 summaryStatus null/有值两态；or/and 组合列表为空时跳过查询 |
| 部分更新语义（Prisma 省略字段=不写） vs 现动态 SET | updateTaskStatus/updateAnalysisSubTaskStatus 仅在字段提供时写入键（与现 add() 逻辑一一对应），completedAt 特殊分支显式处理 |
| updateTaskProgress 高频调用（每秒）性能 | 单行 update 无回归风险；测试覆盖 |
| claimNextCreatedTask raw SQL 写 + Prisma 读 | 同 P2c claim 模式，已实证可见性 |
| deleteAll/updateAll 类型强制前置 where | `.where({taskId})` 等显式过滤；空表 no-op 已实证 |
| progressBuckets 语义漂移 | 门面保留原逻辑；closure diff 复核逐行对照（总 plan §3 移交义务） |

## 6. 验证与闭合判据

1. 全量测试 49+ 用例绿（task **13** + analysis-sub 3 + type-semantics 5 为等价性证据；本轮补 2 断言：findTasksByBvidsAndCids 的 summaryStatus 镜像 + 空 pairs 提前返回）；typecheck、build 通过。
2. diff 复核：**16 方法**（task 13 + analysis_sub_task 3）签名不变、progressBuckets 三处交互（update/updateStatus/delete+clear）原样、**8 处日志点**原样、raw SQL 仅剩两个 claim + initSchema、消费方零改动。
3. `docs/testing/` 追加 P2d 记录、`docs/logs/` 日志、总 plan checklist（P2 全部完成）、`project-context.md` Active plan 行。
4. cold-replay 闭合自检（deleteTask/clearTasks 删除契约测试为安全网，master plan §7 授权）。**已接受的无测试钉住项**（以 §6.2 diff 复核为证，沿 progressBuckets 先例）：updateTaskProgress 的 speed 缺省、updateTaskStatus 的 progress/autoSummary/promptId 字段、updateAnalysisSubTaskStatus 的 failed 分支、findNextCreatedTask（死代码零覆盖）。

## 7. Checklist

- [x] task 域 13 方法切换 + 镜像合并 + claimNextCreatedTask raw SQL 保留
- [x] analysis_sub_task 3 方法 + reconcile sub 半段
- [x] progressBuckets 逻辑逐行保留（diff 复核证据：5 处交互原样）
- [x] 补 2 断言（镜像 summaryStatus、空 pairs）+ 全量回归 + diff 复核（50/50、typecheck、build）
- [x] 文档同步 + cold-replay 闭合（2026-09-02：§3.1/§3.2 逐方法核对 testing 证据；P2 全部完成，总 plan 已勾线）

## 8. Closure 记录

- §6 判据 1–4 全部满足；§6.4 已接受无测试钉住项 4 类（speed 缺省、progress/autoSummary/promptId 字段、sub failed 分支、findNextCreatedTask 死代码）均以 diff 复核为证。
- 死代码清理：5 个无消费方私有 SQL 常量/方法移除；findNextCreatedTask 保留但标注 P4 处置。
- P2 收官：数据访问层已全量走 Prisma（除 2 个守卫型 raw SQL claim），行为测试 50/50 全绿。
