# 需求：历史 AI 总结知识回填（一次性触发）

> 来源：Phase 2 讨论中的顺序决策（2026-09-01）——向量化需要真实知识数据，89 条历史总结需先经 Phase 1 发布管道入库；用户确认**回填操作独立拆出**，部署镜像后由用户手动触发一次。
> 依赖：Phase 1 发布管道（`docs/requirements/2026-08-24-cos-summary-knowledge-publish.md`）已上线，`POST /api/summary-tasks/:id/publish` 已存在。

## Goal

提供一次手动触发的批量回填操作：把库内所有符合条件的**历史已完成 AI 总结**（当前 89 条，`ai_summary_task`）经既有 Phase 1 发布管道写入云端知识库（`summary` / `summary_segment` + COS 截图），使 Phase 2 向量化上线时已有真实数据。

## 决策（用户确认）

1. 回填为**独立操作**，不并入 Phase 2 向量化实现；实现后由用户在镜像部署后**手动触发一次**。
2. 触发方式为服务端接口（无新前端界面）。

## In Scope

- 新增触发接口：`POST /api/knowledge/backfill`：
  - 立即返回（后台异步执行，避免 89 条串行上传截图超出 HTTP 超时）；
  - 启动后台批量任务：遍历 `ai_summary_task` 中 `status=completed` 且 `raw_response` 非空的记录，逐条调用既有发布管道（等价于逐条 `POST /api/summary-tasks/:id/publish`）。
- 新增进度/结果查询接口：`GET /api/knowledge/backfill`：
  - 返回批量任务状态（running / idle）与统计：总数、已发布（synced）、跳过、失败数；
  - 失败明细：task id + 错误摘要（含"截图文件缺失，可 rebuild"类提示）。
- **幂等与可重复触发**：`knowledge_status=synced` 的任务跳过；批量任务运行期间重复触发返回"已在运行"；批量任务本身可中断后重新触发（重新触发只处理未 synced 的）。
- 失败语义复用 Phase 1：单条失败置该任务 `knowledge_status=failed` + `knowledge_error`，不影响其余任务；整体无全局"失败"状态。
- 有界并发（如同时 2-3 条），避免瞬时打满 COS/DB/带宽。

## Out Of Scope

- 向量化 / embedding（Phase 2，`docs/requirements/2026-09-01-knowledge-vector-search.md`）。
- 前端回填界面（仅接口，用户手动 curl 触发）。
- 对非 completed 或 raw_response 为空的历史任务做任何处理。
- 删除/重总结的级联治理（仍按原 Phase 4 后置）。

## Main User Flow

1. 用户构建并部署新镜像（含回填接口）。
2. 用户手动触发一次 `POST /api/knowledge/backfill`。
3. 后台逐条发布（COS 截图 + summary/segments upsert）；用户可用 `GET /api/knowledge/backfill` 轮询进度。
4. 完成后用户查看失败明细，对截图缺失任务按需 rebuild 后重触发（重触发只处理未 synced 的）。

## Business Rules

- 回填范围恒为：`status=completed` 且 `raw_response` 非空且 `knowledge_status != synced`。
- 单条失败不中断批量；每条独立复用发布管道的幂等语义（事务内删旧插新）。
- 触发接口不做鉴权（与现有 `/api/*` 一致）；属一次性运维操作。

## Edge Cases

- 历史 md/截图文件缺失（容器重建丢失 summaryDir）：该条发布按 Phase 1 既有语义置 failed 并提示 rebuild；不产生半截数据（事务保护）。
- 触发时部分任务正在被单条发布：upsert 幂等，无重复行。
- 库内无符合条件任务：触发返回 0 条可回填。
- 服务重启时批量任务中断：已 synced 的不回退，重新触发继续。

## Open Questions（非阻塞）

1. 并发度具体值（2 vs 3）与失败重试轮次——plan 细化，默认不做自动重试轮次。

## Acceptance Criteria

- [ ] 部署后手动触发一次，后台开始批量发布；轮询接口可见进度（running + 计数）。
- [ ] 全部跑完后：成功任务 `knowledge_status=synced`，云端 `summary`/`summary_segment` 与 COS 截图可查；失败任务 `failed` 且错误明细可查。
- [ ] 重复触发安全：synced 跳过、运行中拒绝重复触发、无重复数据行。
- [ ] `pnpm typecheck`、`pnpm build`、`pnpm docker:build:server` 通过。
