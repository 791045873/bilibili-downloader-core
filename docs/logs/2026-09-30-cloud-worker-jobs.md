# 2026-09-30 云端/NAS Phase 2 — 持久化作业与跨主机触发（worker_job）实施

计划：`docs/plans/2026-09-29-cloud-worker-jobs-plan.md`
测试：`docs/testing/2026/09-29-cloud-worker-jobs-testing.md`

## 分步与提交

- P2-1 作业模型与仓储（312f77d）：contract 新增 `WorkerJob`/`WorkerHeartbeat`（emit 落地）；`database.service.ts` 增原子守卫 raw SQL 仓储（enqueue/claim/renew/complete/fail/reap/cancel-request/getById，fencing + dedup 活跃唯一）；数据层测试。
- P2-2a worker 轮询执行器（a303c39）：新增 `WorkerService`（认领→按 kind 分发 handler→续租→终态；reaper；心跳 `upsertWorkerHeartbeat`），`WorkerModule` 全局注入 AppModule；env 可调，`WORKER_ENABLED=false` 关闭定时器；loop 测试。
- P2-2b(1/2) 低清/分析改走作业（08001be）：低清由 `scheduleLowResDownload` 改 `enqueueJob('low_res_download')`；analyze/low_res_download handler 注册；onAnalysisTrigger 改入队 analyze（promptId 前移）；continuation 绕过认领；移除 scheduler 低清队列/onLowResFinished；`executeLowResDownload` 增可选 resourceType，`ParseResultItem.resourceType` 回填。
- P2-2b(2/2) 控制器触发改走作业（6ec9849）：一键总结/retrigger→analyze、rebuild→screenshot_retry。
- P2-3 移除进程内互斥 + 状态/取消 API（f6152dd）：移除 rebuildingIds / integrity `running`；新增 `worker.controller.ts`（list/get/cancel）与 `cancelWorkerJob`/`listWorkerJobs`/`getLatestWorkerJobByKind`；integrity-check 改入队 + status 读 DB；integrity_check handler gated。
- P2-4 测试与 testing 回填（d96d03c）：cancel/list/latest 用例；testing T1–T9 结论。

## 验证

- `pnpm --filter @bilibili-downloader/server typecheck` / `build` 通过。
- `pnpm --filter @bilibili-downloader/server test`：全量 149 passed（20 files）。测试容器 pgvector/pg17，`TEST_DATABASE_URL`。

## 决策与裁决

- `download` 保留 `claimNextCreatedTask`，不迁 worker_job（需求明确）。
- `resource_type` 由触发期 `parseVideo` 回填并随 low_res_download payload 前移；执行期优先消费，缺失重解析。
- `integrity_check` handler **gated**：执行判据（云 DB+COS+NAS）由「完整性检查重定义」需求承接，避免旧本地 md 判据（Phase 1b 已停写）误报。
- 终态作业保留期/清理与 `cos_cleanup` 生产者留待 Phase 4。

## 已知限制

- 端到端（真实下载→分析→查看总结）依赖 B站/LLM，单测不可覆盖，靠代码核对 + 人工验证。
- worker 轮询与业务 handler 注册的启动次序：`setInterval` 首触发延迟 `pollMs`(~4s)，handler 于 boot 内注册；无 handler 的作业经 failJob 退避重试，自愈。
