# Testing — P3 Schema 所有权切换

- 日期：2026-09-02
- Plan：`docs/plans/2026-09-02-prisma-p3-schema-ownership-plan.md`
- 演练证据：`docs/testing/2026/09-02-prisma-p3-schema-ownership-drill.md`（6 步全过，用户已确认实施）
- 结果：**PASS**（48/48 tests；typecheck、build、dist 冒烟、seed 脚本验证通过）

## 变更内容

1. **`initSchema()` 删除**（约 215 行 DDL/迁移/播种移出启动流程）。
2. **启动哨兵** `verifySchemaOrThrow`（导出函数 `verifySchemaTables`）：
   - 8 张预期表存在性（information_schema.tables）
   - `ai_summary_task.knowledge_status/knowledge_error` 列校验（防旧版建表库穿透，演练步骤 4 依据）
   - 缺失即 fail-loud，错误信息含 `db init`/`db sign`/`db update` 处置指引
3. **播种抽出**：`seedBuiltinPromptIfEmpty()`（Prisma 实现，幂等），仍由 onModuleInit 自动调用 + `prisma:seed` script 双通道。
4. **一次性迁移归档**：`scripts/one-off-migrations/{001-summary-status-merge,002-analysis-sub-task-supersede}.sql` + README（作用/适用库/勿重复执行/测试去向）；`migrate-sqlite-to-postgres.mjs` 保留并注记（P4 评估依赖）。
5. **测试基座**：`tests/global-setup.ts`（每次测试运行 `prisma db init` 幂等初始化测试库——演练步骤 3 证明）+ helpers 移除 initSchema + 8 处 initSchema 调用点处置（2 迁移用例删除、4 播种改 seed、2 并入 seed 幂等用例）。

## 验证证据

| 项 | 结果 |
| --- | --- |
| 全量测试 | 8 文件 **48/48**（减 2 归档迁移用例） |
| typecheck / build | 通过 |
| `git grep initSchema`（src+tests+dist） | 0 残留 |
| `pool.query` 存量 | 仅 3 处：哨兵 + claimAiSummaryTask + claimNextCreatedTask（守卫类） |
| 日志点 | 20 处 createLogMessage 全部保留（含播种） |
| dist 冒烟 | 空库启动 fail-loud："Database schema is missing tables: …" + 指引 |
| `prisma:seed` 脚本 | 空表播种 + 幂等（count=1 不重复）实测 |
| globalSetup `db init` | 已签名库上 0 操作幂等（演练步骤 3 一致） |

## 升级路径（部署视角，P4 接线）

- 已部署实例升级新镜像：表已存在 → 哨兵通过 → 正常启动（若 P4 未接线也不破坏）；推荐随后 `db sign` 采纳。
- 全新部署：需先 `db init`（P4 接线进容器启动流程）。
- 云端 RDS 版本 ≥15 核实：P4 前人工动作（未完成，遗留）。
