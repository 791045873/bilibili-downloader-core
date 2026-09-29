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

## 结论
- 状态：待实施后回填每条方向的通过/裁决结论。
