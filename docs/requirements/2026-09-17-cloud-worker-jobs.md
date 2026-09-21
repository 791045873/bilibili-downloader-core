# 需求：持久化作业与跨主机触发（Phase 2）

> 来源：拆自 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（Phase 2）
> Owner Doc：`docs/architecture/system-baseline.md`、`docs/design/app-overview.md`
> 前置：Phase 1a / 1b（读取与内联发布）
> 保护区：数据模型变更（additive 表 / 列）。部署改动在 Phase 3；本切片不改部署。
> 状态：实现就绪（字段与语义见讨论 Q3；1 项实现时细节见 Open Questions）

## Goal

引入 DB 持久化作业队列（`worker_job`）与 worker 租约 / 心跳机制，把当前**进程内**的调度、回调与互斥改为**基于 DB 的触发与认领**，使触发与执行解耦、可跨进程、可崩溃恢复。这是 Phase 3（把执行迁到 NAS）的前置。

本切片**不改变部署形态**：执行仍发生在当前 server 进程内，但通过"轮询 DB 作业"驱动，从而可在 Phase 3 无改动地迁到 NAS worker。

## In Scope

### 作业模型（Prisma contract + migration，additive）

- 新增 `worker_job` 表，字段（见讨论 Q3）：`id`、`kind`、`queue`、`ref_type`、`ref_id`、`dedup_key`、`status`、`priority`、`attempts`、`max_attempts`、`available_at`、`lease_owner`、`lease_expires_at`、`heartbeat_at`、`payload`、`result`、`last_error`、`cancel_requested`、`created_at`/`updated_at`/`started_at`/`finished_at`。
- 新增 `worker_heartbeat` 表：`worker_id`、`role`、`last_seen_at`、`meta`。
- 索引 / 约束：`(status, available_at, priority)`；`dedup_key` 部分唯一索引（`WHERE status IN ('queued','leased','running')`）；`(queue, status)`。

### 作业种类（kind）

- `low_res_download`、`analyze`、`retrigger`、`screenshot_retry`、`integrity_check`、`cos_cleanup`。
- `download`：**本切片暂沿用 `claimNextCreatedTask`**（讨论 Q3 分阶段），稳定后迁移；迁移后 kind 生效。

### 认领 / 租约 / 心跳 / 恢复

- 原子认领：单语句 `UPDATE ... WHERE id = (SELECT ... WHERE status='queued' AND available_at<=now() ORDER BY priority,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`。
- 租约：认领写 `lease_owner` / `lease_expires_at=now()+TTL`；执行期由**独立定时器**续 `heartbeat_at` 与 `lease_expires_at`（TTL≈3×心跳间隔，如 60s/20s）。
- reaper：重置 `status=running/leased` 且 `lease_expires_at<now()` 的作业为 `queued`（`attempts++`）。
- 幂等：handler 必须幂等（下载"文件存在即跳过"、COS 同 key 覆盖、DB upsert）。
- 取消：`cancel_requested`，worker 在安全点检查。

### 替换进程内机制

- 移除 `download-scheduler` 的进程内回调（`onTaskFinished → onAnalysisTrigger`、`onLowResFinished`）与低清内存队列（`lowResQueue` / `lowResRunningSet`），改为作业生产 / 认领。
- 移除 `analysis-trigger` 的 `rebuildingIds` 内存互斥、`summary-integrity` 的 `running` 布尔，改为 DB 作业状态。
- `resource_type` 与 `promptId` 等由云端解析后放入 `payload`（讨论 Q16 / Q3）。

### 触发接口

- 既有触发入口（下载、一键总结、retrigger、rebuild→screenshot_retry、integrity-check、repair 下线后）改为**写作业行**。
- 新增作业状态查询接口供前端轮询（列表 / 单条 / 取消）。

## Out Of Scope

- 部署拆分、`server-common` 抽离、两镜像（Phase 3）。
- 用户系统（auth 独立需求）。
- 完整性检查判据 / 报告结构变更（单独需求）。
- 下载迁移到 `worker_job`（本切片保留 `claimNextCreatedTask`）。
- 删除既有本地文件（Phase 4）。

## Main User Flows

1. 云端触发（下载/分析/重试截图/完整性）→ 写 `worker_job`（`queued`）。
2. worker 轮询认领 → 执行 → 更新 job 状态与领域表。
3. 前端轮询作业状态；NAS 离线时作业保持 `queued`，UI 显示等待。

## Business Rules

- **至少一次**：作业可能重复执行，handler 必须幂等。
- **租约优先于进程**：崩溃后由租约过期 + reaper 恢复，不依赖进程内存。
- **去重**：同一逻辑工作的活跃作业唯一（`dedup_key`）。
- **触发与执行分离**：API 只写作业；执行与磁盘校验在 worker。
- **不改变部署**：本切片仍在单进程内轮询执行。

## Roles / Permissions

- 沿用现状。

## Data / Model Impact

- 新增 `worker_job`、`worker_heartbeat` 两表（additive，无存量）。
- 迁移与回滚遵循讨论 `Migration & Rollback`：先 schema 后代码；回滚保留 additive 表。

## API / Integration Impact

- 触发类端点语义改为"写作业"（请求/响应结构尽量保持）。
- 新增作业查询 / 取消接口（状态枚举：queued/leased/running/succeeded/failed/canceled）。
- 移除进程内状态接口（如 `integrity-check/status` 的进程内 `running` 改为读 DB）。

## Edge Cases

- 崩溃 / 租约超时：reaper 重置并重领。
- 重复投递：`dedup_key` 拒绝。
- 取消：运行中在安全点停止，终态 `canceled`。
- 重试：`attempts` 超 `max_attempts` → `failed` + `last_error`。
- 终态保留：`succeeded/failed/canceled` 保留期（如 30 天）后清理。

## Open Questions

- **终态作业保留期与清理方式**（如 30 天，定时清理）：实现时定，不影响契约。

## Acceptance Criteria

- [ ] `worker_job` / `worker_heartbeat` 经 contract/emit/migration 落地；fresh 库 `db init`、存量库 `db migrate` 成功。
- [ ] 触发类动作均以写作业行完成，不再依赖进程内回调 / 内存队列 / 内存互斥。
- [ ] worker 重启后，`running` 作业可经租约超时被重新认领；`queued` 作业不丢。
- [ ] 重复投递被 `dedup_key` 去重；作业重复执行对结果幂等。
- [ ] 作业状态可经 API 轮询；`integrity-check/status` 不再读进程内布尔。
- [ ] `resource_type` / `promptId` 经 `payload` 下发（NAS 不再为此调 B站）。
- [ ] `pnpm typecheck`、`pnpm build` 通过；作业认领 / 租约 / 幂等的数据层测试通过；owner doc 更新。
