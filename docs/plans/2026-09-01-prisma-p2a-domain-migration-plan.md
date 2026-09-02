# Plan：P2a — 域迁移：ai_prompt / ai_prompt_creator / app_settings

> 日期：2026-09-01
> 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
> 需求：`docs/requirements/2026-09-01-prisma-orm-introduction.md`
> 前置：P0、P1 已闭合
> Audit: 已通过独立 subagent 审计并修订，见 `docs/audits/2026-09-01-plan-audit-prisma-p2a-domain-migration-plan.md`

## 1. Goal

把三个最小域（`ai_prompt`、`ai_prompt_creator`、`app_settings`）的数据访问从 `DatabaseService` 内手写 SQL 切换为 Prisma 8 查询。**`DatabaseService` 公共方法签名、返回类型、日志行为零变更**，消费方（prompt.service、analysis controllers 等）零改动。

## 2. 已核实事实（P1/P2a 探查实证）

- Prisma 8 查询 API（runtime 实测）：`create(列对象)`（无 `data` 包装）、`upsert({匹配键, update, create})`、`where(...).update(...)`/`where(...).delete()`（返回受影响行）、`updateAll(...)`（无 where 时全表）、读取链 `where(...).orderBy(...).all()/.first()`。
- 运行时类型（P1 钉住）：BIGINT→`BigInt`、timestamptz→`Temporal.Instant`；现有 API 暴露 `number`/ISO 字符串。
- 现有行为测试已钉住三个域的大部分对外语义（`tests/database/ai-prompt.test.ts`、`settings.test.ts`），切换后复用同一套测试即等价性证据；**未被测试钉住、靠 §6.2 diff 复核保证的项**：4 处日志点内容、`updateAiPrompt`/`setAiPromptDefault` 刷新 `updatedAt`、对不存在 id 的 no-op 语义（本轮补测试钉住）。

## 3. Scope

### 3.1 门面装配

- `DatabaseService` 注入 `PrismaService`（可选参数）：生产路径由 `DatabaseModule` imports `PrismaModule` 后 DI 注入共享单例；**直接构造路径（测试）**未注入时经 `prisma.service.ts` 导出的 `createPrismaClient()` 工厂自建 client，并在自身 `onApplicationShutdown` 中一并关闭（owns 标记），保证 8 个既有测试文件零改动、无连接泄漏。**`prisma.service.ts` 为本轮修改文件**（抽出 `createPrismaClient()` 工厂，`PrismaService` 构造函数复用之）。
- `PrismaModule` 增加 exports（已导出）；`DatabaseModule` 增加 `imports: [PrismaModule]`。
- P1 的 `PrismaService` 自此成为被消费方（首个消费者）。

### 3.2 映射层（DatabaseService 私有转换器，P2b–P2d 复用）

- `bigint → number`：id/promptId/mid（BIGINT 列）。
- `Temporal.Instant → ISO 字符串`：统一走 `new Date(instant.epochMilliseconds).toISOString()`，保证输出与现有 `Date.toISOString()`/`toIsoTimestamp` 完全一致（3 位毫秒、UTC 'Z'）；**不用** `Instant.toString()`（秒级精度时会省略小数节）。
- 输入侧：方法入参 `number` → `BigInt(n)` 传给 Prisma。
- `is_system`/`is_default` 为 INTEGER 列，Prisma 直接给 number，无需转换；`app_settings.value` 为可空 TEXT，Prisma 类型为 `string | null`，但现有写入端从不写 null，返回 `Record<string, string>` 契约不变（转换时保持不放大 null 语义）。

### 3.3 逐方法切换（13 个）

| 方法 | 现实现 | Prisma 实现 |
| --- | --- | --- |
| listAiPrompts | 手写 SELECT + ORDER BY is_system DESC, created_at ASC | `.orderBy([{isSystem:'desc'},{createdAt:'asc'}]).all()` |
| getAiPromptById | SELECT WHERE id | `.where({id: BigInt}).first()` |
| insertAiPrompt | INSERT RETURNING + 回读 | `.create({...})`；保留"Persisted AI summary prompt"日志 |
| updateAiPrompt | 动态 SET | `.where({id}).update({仅提供的字段, updatedAt})` |
| deleteAiPrompt | DELETE | `.where({id}).delete()`；保留日志 |
| clearAiPromptDefault | UPDATE 全表 | `.updateAll({isDefault: 0})` |
| setAiPromptDefault | UPDATE WHERE id | `.where({id}).update({isDefault: 1, updatedAt})` |
| getDefaultAiPromptId | SELECT WHERE is_default=1 LIMIT 1 | `.where({isDefault: 1}).first()`（无 orderBy，与现 SQL 同为"任取一行"语义） |
| getCreatorBindingByMid | SELECT WHERE mid | `.where({mid: BigInt}).first()` |
| upsertCreatorBinding | INSERT ON CONFLICT | `.upsert({mid, update:{promptId}, create:{...}})`；保留日志 |
| deleteCreatorBinding | DELETE WHERE mid | `.where({mid}).delete()`；保留日志 |
| getSettings | SELECT WHERE key IN (...)；**空 keys 提前返回 `{}` 不发查询** | 保留提前返回；`.where({key: {in: keys}}).all()`（IN 语法实施时以 typecheck 实证） |
| setSettings | 逐键 upsert / 空串 delete | 逐键 `.upsert({...})` / `.where({key}).delete()`（保持现有循环结构） |

时间戳输入（insertAiPrompt/updateAiPrompt/setAiPromptDefault 的 `now`）按 Prisma 输入类型适配（Date 或 Instant，以 typecheck 为准），输出经 §3.2 转换器归一。

## 4. Out Of Scope

- task / analysis_sub_task / ai_summary_task / summary 域（P2b–P2d）。
- `initSchema()`、一次性迁移、播种逻辑（P3）。
- 消费方文件、API 路由、前端。

## 5. 风险

| 风险 | 对策 |
| --- | --- |
| `key IN` 过滤语法与 typecheck 预期不符 | 以 typecheck 实证；必要时改用多次 `.where().first()` 或 raw（最后手段，须记录） |
| `orderBy` 对 NULL 的处理与 PG 手写 SQL 有差异（is_system 可空） | 现网数据恒非空；ai-prompt 测试钉住排序，若失败则显式处理 NULL 语义并记录 |
| `.first()` 与 `LIMIT 1`（无 ORDER BY）行选择不稳定 | getDefaultAiPromptId 测试已用 `toContain` 宽松断言（非互斥 default 怪癖），天然兼容 |
| Temporal 输入类型不接受 ISO 字符串 | 按 typecheck 实测适配（Date / Temporal.Instant） |
| DatabaseService 自建 client 与生产 DI 双路径行为不一致 | 工厂函数唯一来源；测试覆盖自建路径，DI 路径由 build/启动冒烟覆盖 |
| 不存在 id 的 `updateAiPrompt`/`setAiPromptDefault`/`deleteAiPrompt` 现为静默 no-op（UPDATE/DELETE 影响 0 行不抛错）；Prisma `.update()`/`.delete()` 对缺失行可能抛错 | 实施时实测并保留 no-op 语义（必要时 catch）；补测试钉住 |

## 6. 验证与闭合判据

1. 既有 40 用例（含 ai-prompt/settings 域全部行为测试）全绿 —— 即等价性证据；`pnpm typecheck`、`pnpm build` 通过。
2. diff 复核：13 个方法签名与返回类型未变；4 处日志点原样；消费方文件零改动。
3. `docs/testing/` 追加 P2a 验证记录；`docs/logs/` 日志；总 plan checklist 更新；`project-context.md` Active plan 行更新。
4. cold-replay 闭合自检（P2a 属非保护区数据路径切换，已有测试兜底；可 cold-replay）。

## 7. Checklist

- [x] 门面装配（PrismaService 注入 + `prisma.service.ts` 抽工厂 + 自建回退 + DatabaseModule imports）
- [x] 映射层转换器（bigintToNumber / toIsoString / Temporal.Instant 输入）
- [x] 13 方法切换
- [x] no-op 语义补测试（不存在 id 的 update/setDefault/delete）
- [x] 全量回归 + diff 复核（46/46、typecheck、build；仅 3 个 database 层文件变更，日志点原样）
- [x] 文档同步 + cold-replay 闭合（2026-09-01：对照 §3.3 逐方法核对本 checklist 与 testing 证据；查询 API 实测偏差——conflictOn/回调式 orderBy/IN 回调/Temporal 输入/updateAll 前置 where——均已回写 plan §3.3 对应实现并记录于 testing 文档供 P2b–P2d 复用）

## 8. Closure 记录

- §3.3 表中"Prisma 实现"列与最终实现的偏差（conflictOn、回调式 orderBy、IN 回调、Temporal 输入、updateAll 前置 where）属实施期 API 实测修正，语义与计划等价性目标一致，全部记录于 testing 文档。
- §6 判据 1–4 全部满足；本域不含保护区删除路径（deleteTask/clearTasks/deleteAiSummaryTask 属 P2c/P2d），cold-replay 闭合合规。
