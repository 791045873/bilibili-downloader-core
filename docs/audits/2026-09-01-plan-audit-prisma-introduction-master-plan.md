# Plan Audit — Prisma ORM 渐进式改造总 plan

- 计划：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
- 需求：`docs/requirements/2026-09-01-prisma-orm-introduction.md`
- 讨论：`docs/discussions/2026-09-01-prisma-orm-introduction.md`
- 审计日期：2026-09-01
- 审计方式：独立 subagent（只读审计，未修改被审文件）。本计划属高风险（DB shape、数据删除路径、后续 deployment），按 `ai-autonomy-policy.md` 不可使用 cold-replay 替代，故采用 subagent 审计；用户于 2026-09-01 会话中直接提出 Prisma 改造需求并逐项决策（见讨论 §7），构成启动规划的人工授权。

## 结论

VERDICT: needs-changes → 修正后 approved。架构（方案 B 分阶段、test-first per domain、P2a→P2d 域序、P3/P4 人工批准门）与需求、讨论、live code 一致；无 Blocker。1 项治理缺陷、4 项完整性缺口、2 项顺序风险、2 项 Minor 均已并入总 plan。

## 发现与吸收

- **Major-1（审计证据缺失）**：原 plan 头部声称"经独立 subagent 审计"但无留档记录。已补本记录并修正引用。
- **Major-2（data deletion ask-first 未留痕）**：`ai-autonomy-policy.md` 将数据删除列为 ask-first；用户 2026-09-01 决策（讨论 §7：方案 B + test-first per domain 覆盖删除路径契约）构成人工授权，已在总 plan §7 显式留痕。
- **完整性缺口（已并入）**：
  1. `reconcileStaleAnalysisState()` 启动路径（database.service.ts:1182，analysis-trigger 启动调用）纳入 P0 行为测试与 P2c/P2d 等价验证。
  2. `progressBuckets` 进程内状态与日志去重语义（updateTaskProgress/updateTaskStatus/deleteTask/clearTasks）保留在门面，P2d + P0 测试钉住。
  3. P1 必须决策连接策略（复用现有 `pg` pool 的 driver adapter vs 独立连接）并记录全局 `pgTypes.setTypeParser` 的相互影响；映射层须精确复刻 `toIsoTimestamp` 归一化。
  4. `scripts/migrate-sqlite-to-postgres.mjs` 依赖 `pg`/`better-sqlite3`：P3 决定其归宿，P4 依赖移除时一并处理（含 devDeps）。
- **顺序风险（已并入）**：
  1. P2b 的 `knowledge-publisher` 会经 `updateSummaryKnowledgeStatus` 写 `ai_summary_task`（P2c 才迁移）：P2b 保持该写路径走旧栈，测试覆盖混合栈。
  2. P0 的 Prisma 工具在 P1 安装依赖之前使用：P0 用 `pnpm dlx prisma@8` 独立供给，基线 schema 产物移交 P1。
- **Minor（已并入）**：
  1. `project-context.md` 验证命令表回填作为 P0 闭合项；Active Work 指针同步。
  2. P4 子 plan 触发清单补 Dockerfile `--ignore-scripts`（postinstall 的 prisma generate 不会运行，需显式 COPY 生成产物与 schema/config）。
  3. 明确约束：knowledge-backfill 与 Prisma 切换不得并行修改 `database.service.ts`。
  4. P2b 子 plan 须携带 `upsertSummaryKnowledge` 显式事务等价验证；P3 须携带 partial unique index `idx_analysis_sub_task_active` 的 migrate 输出核对；P1 须保留 `connectWithRetry` 语义或显式替代。
  5. P0 删除路径契约测试按现状钉住既有怪癖（如 `clearTasks` 的非结构化日志、`deleteTask` 非事务两步删除且不清理 `summary`/`summary_segment`）。

## 核查要点

- 阶段覆盖：需求 In Scope 全部映射到 P0–P4；对外 JSON 零变更为全局闭合判据。
- 域序合理性：task 域的 `taskSelectSql` LEFT JOIN ai_summary_task，故 P2d 最后、且读侧 JOIN 镜像在 P2c 后有既定来源。
- 治理：各子 plan 启动前独立审计；P3 演练结果与 P4（deployment ask-first）需用户批准。
