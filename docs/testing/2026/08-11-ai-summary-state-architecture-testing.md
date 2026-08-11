# 2026-08-11 AI 总结状态与资产架构收敛 — 测试方向

关联计划：`docs/plans/2026-08-11-ai-summary-state-architecture-consolidation-plan.md`

本文件描述架构收敛应观察到的需求级状态与反状态，供计划验证与闭核算使用。验证命令：`pnpm typecheck`（零错误）+ 迁移冒烟 + 下述手工回归。

## 1. AnalysisVideoResolver 资产决策统一（Phase 1）

**应成立:**

- LLM 分析视频与截图源决策都经 `AnalysisVideoResolver`：磁盘优先（低清 → 高清），缺失触发重下/降级链。
- 同一资源无论从任务页还是资源级入口触发，资产决策结果一致。
- P0 资源对账行为（校验、重下、降级）不回归。

**不应成立:**

- 资产决策仍散落在 `trigger()` 与 `ScreenshotSourceResolver` 两处、规则不一致。
- 两入口对同一资源产生不同视频/截图源选择。

## 2. AI 总结状态单一来源（Phase 2）

**应成立:**

- `ai_summary_task` 是 AI 总结状态的唯一权威记录；`task` 表不再写入 `summary_status/summary_output`。
- `GET /api/tasks` 返回的 `summaryStatus/summaryOutput` 与 `GET /api/summary-tasks` 一致，均由 `ai_summary_task` 读取。
- 历史数据迁移后，既有任务的总结状态/输出正确保留。

**不应成立:**

- 两处写入导致同一资源状态漂移。
- 迁移后历史任务总结状态丢失或错位。
- 前端展示字段结构变化（应保持兼容）。

## 3. 子任务资源级唯一（Phase 3）

**应成立:**

- `analysis_sub_task` 按 `(bvid, cid, quality)` 唯一；同一资源同画质只存在一条活跃子任务。
- 低清调度去重基于资源键，重复触发不产生重复下载。
- 任务级溯源信息（task_id）仍可查询。

**不应成立:**

- 同资源多任务导致重复低清子任务与并发重下。
- 子任务按 task_id 归属导致"重载任务后子任务错位"。

## 4. summaryDir 稳定化（Phase 3）

**应成立:**

- summary 输出目录基于资源（bvid+cid）稳定命名，标题变化或重触发不同任务不再产生新孤儿目录。
- 文档 front matter 标题仍为真实标题。

**不应成立:**

- 同资源因标题差异产生多个 summary 目录。
- 既有孤儿目录被自动清理（明确不做，避免误删）。

## 5. 迁移安全（跨 Phase）

**应成立:**

- SQLite 迁移幂等（重复执行不报错/不丢数据）；迁移前有备份或可回滚路径。
- 迁移后旧版数据（含 `task.summary_status`）在新读取路径下正确显示。

**不应成立:**

- 迁移破坏既有下载/AI 总结记录；幂等性缺失导致重复执行异常。

## 6. 既有行为不回归

**应成立:**

- 下载、自动/手动 AI 总结、低清下载完成续跑、邮件通知等主链路行为不变。
- 前端所有消费 `summaryStatus/summaryOutput`/任务列表的视图（Downloading.vue、AiSummaryTasks.vue、ParseResultList.vue）表现一致。

**不应成立:**

- 架构收敛引入 API 契约变化或前端展示回归。

## 手工回归清单

- 场景 A：迁移脚本在含历史数据 DB 上执行 → 数据完整、幂等（Phase 2/3）。
- 场景 B：同资源两次任务触发总结 → 状态一致、子任务唯一（Phase 2/3）。
- 场景 C：删除低清/高清 → 决策经 resolver 正确恢复（Phase 1，复用 P0 场景）。
- 场景 D：标题变更后重触发 → summaryDir 不变（Phase 3）。
- 场景 E：`pnpm typecheck` 零错误；`pnpm build` 零错误。

运行级场景（A 的真实 DB 迁移、B/D 的真实触发与展示）需要在含历史数据的真实 DB 与运行中的 server 上执行，无法在静态验证中复现；逻辑级已通过代码检查 + 内存 SQLite 冒烟脚本覆盖（状态迁移、去重、部分唯一索引、资源查询均 PASS），运行级行为留用户手动验证。`pnpm typecheck`、`pnpm build` 已在实施时通过。

范围外：本地视频上传分析、多实例部署（计划 Deferred 节）。
