# 09-29 云端/NAS Phase 2 持久化作业与跨主机触发 Testing

> 需求：`docs/requirements/2026-09-17-cloud-worker-jobs.md`
> 计划：`docs/plans/2026-09-29-cloud-worker-jobs-plan.md`
> 定位：需求级观察态（应呈现/不应呈现），非测试脚本。

## 检查应覆盖的状态

### T1 作业模型与迁移
- `worker_job` / `worker_heartbeat` 经 contract/emit/migration 落地；fresh 库 `db init`、存量库 `db migrate` 成功、纯 additive。

### T2 原子认领
- 并发多次 `claimNextJob` 对同一 `queued` 作业只成功一次；按 `(priority,id)` FIFO；认领即写 `lease_owner`/`lease_expires_at`/`status=leased`。
- 不应出现：同一作业被两个 worker 同时领。

### T3 去重
- 同一逻辑工作的活跃作业唯一（`dedup_key` 部分唯一）；重复投递被拒绝/合并。

### T4 租约 / 心跳 / reaper
- 执行期 `renewLease` 推后 `lease_expires_at`、更新 `heartbeat_at`。
- 模拟崩溃（不续租）→ 租约到期 → `reapExpired` 将 `running/leased` 且过期作业重置 `queued` 且 `attempts++`，可被重领。
- 不应出现：崩溃作业永久卡在 running。

### T5 触发即作业
- 一键总结/retrigger→`analyze`、rebuild→`screenshot_retry`、integrity-check→`integrity_check`、低清→`low_res_download` 均写作业行；`download` 创建仍走 `claimNextCreatedTask`。
- 下载完成后经作业驱动分析，不再依赖进程内 `onTaskFinished→onAnalysisTrigger`/`onLowResFinished` 回调与 `lowResQueue`。

### T6 payload 前移（Q16）
- `resource_type`/`promptId`/创作者 mid 在创建/触发期解析写入 `payload`；执行期直接消费，不再执行期调 B站解析（payload 缺失路径重解析后下发）。

### T7 内存互斥退役
- rebuild 并发由 `screenshot_retry` 的 `dedup_key` 保证（不再 `rebuildingIds`）；完整性检查并发由 `integrity_check` 作业保证（不再进程内 `running`）。
- `GET /summary-tasks/integrity-check/status` 读 DB 作业状态。

### T8 幂等与终态
- 作业至少一次语义：重复执行结果幂等（文件存在跳过、COS 同 key 覆盖、DB upsert）。
- 状态枚举 queued/leased/running/succeeded/failed/canceled；`attempts` 超 `max_attempts`→failed+`last_error`；取消在安全点→canceled。

### T9 无回归
- 下载→（作业驱动）分析→查看总结（Phase 1a 渲染）全链路正常；NAS 离线（本阶段单进程模拟为 worker 未轮询）作业保持 queued。

## 验证命令
- `pnpm --filter @bilibili-downloader/server test`（测试容器，`TEST_DATABASE_URL`）
- `pnpm typecheck`
- `pnpm build`

## 实施结论（2026-09-30）

验证命令全绿：`pnpm --filter @bilibili-downloader/server typecheck` / `build` / `test`（测试容器 pgvector/pg17，`TEST_DATABASE_URL`），vitest 全量 149 passed（新增 worker-job 15 + worker-loop 6）。

- T1 落地 — 通过。`worker_job`/`worker_heartbeat` 经 contract + `prisma:emit` 落地；测试容器 `prisma db init`（fresh）成功建两表；纯 additive。存量库 `db migrate` 本环境未跑 → 裁决：additive 迁移，遵循既有契约工作流，实机迁移人工核对。
- T2 原子认领 — 通过。`worker-job.test`：priority DESC/id ASC FIFO、并发 `claimNextJob` 恰好一次、认领写 lease_owner/lease_expires_at/running。
- T3 去重 — 通过。`enqueueJob` 活跃 dedup_key 命中返回既有不重复插入；analyze/lowres/screenshot_retry/integrity_check 各有 dedup_key。
- T4 租约/心跳/reaper — 通过。`renewLease` fencing、`reapExpiredJobs`（ttl 过期重置 queued + attempts++）、worker-loop reaper 用例；心跳 `upsertWorkerHeartbeat`。
- T5 触发即作业 — 通过（代码核对 + 编译）。一键总结/retrigger→analyze、rebuild→screenshot_retry、integrity-check→integrity_check、低清→low_res_download 均改为 enqueueJob；download 仍走 claimNextCreatedTask；移除 onLowResFinished/lowResQueue、下载完成经 onAnalysisTrigger 入队 analyze。端到端（真实下载→分析）需 B站/LLM，单测不可覆盖 → 人工核对。
- T6 payload 前移 — 通过（代码核对）。promptId/创作者 mid 在 `enqueueAnalyzeForTask` 触发期解析写入 analyze payload；resource_type 由 `parseVideo` 回填并随 low_res_download payload；`executeLowResDownload` 优先用 payload.resourceType，缺失则内部重解析。
- T7 内存互斥退役 — 通过。移除 rebuildingIds / integrity `running`；rebuild 并发由 screenshot_retry dedup、完整性检查由 integrity_check dedup；`integrity-check/status` 改读 DB（`getLatestWorkerJobByKind`）。
- T8 幂等与终态 — 通过。状态枚举 queued/leased/running/succeeded/failed/canceled；failJob 超 max_attempts→failed+last_error、否则退避重回 queued；cancelWorkerJob（queued→canceled，running 置 cancel_requested）；claim 跳过 canceled/cancel_requested。handler 幂等（文件存在跳过、COS 覆盖、DB upsert）为既有语义，靠代码核对。
- T9 无回归 — 通过。全量 149 tests green（含 Phase 1a DB 渲染读路径）。端到端下载→分析→查看总结需人工核对；NAS 离线经 `WORKER_ENABLED=false`/未轮询模拟，作业保持 queued。

### 裁决（out of scope，随后续需求）
- integrity_check 执行判据：handler 当前 gated（仅投递/去重/状态），不运行旧本地 md 判据（Phase 1b 已停写，会误报全缺失）。执行判据由「完整性检查重定义」需求承接。
- download 迁移 worker_job：保留 claimNextCreatedTask，未来评估。
- 终态作业保留期/清理（cos_cleanup 生产者）：Phase 4。
