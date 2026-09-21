# 需求审计 — Phase 1b / 2 / 3 / 4 与 auth（2026-09-17）

## 1. 对象与方式

对 5 份新需求各做一次独立子代理审计（只读，未改文件）：

- `docs/requirements/2026-09-17-cloud-inline-publish-local-retire.md`（Phase 1b）
- `docs/requirements/2026-09-17-cloud-worker-jobs.md`（Phase 2）
- `docs/requirements/2026-09-17-cloud-project-split.md`（Phase 3）
- `docs/requirements/2026-09-17-cloud-cleanup.md`（Phase 4）
- `docs/requirements/2026-09-17-user-auth.md`（auth）

## 2. 总体裁决

| 文档 | 裁决 | 主因 |
| --- | --- | --- |
| Phase 1b | `with revisions` | 停写本地 md 会使 integrity/repair 失效或反向重建；保护区误标；前端与连带模块清单缺失；验收不可测 |
| Phase 2 | `with revisions` | claim SQL 缺 `queue`/`SET`；无 fencing；低清↔分析编排缺失；与下载进程内调度冲突；启动对账与租约恢复冲突 |
| Phase 3 | `blocked / 大改` | "不含 ffmpeg 代码"不可达；server-common 依赖违规；拆分范围被低估；部署保护区应 blocked 且缺证据；Phase 2 未落地 |
| Phase 4 | `reject` | 前置全未落地；开放问题改 schema 未标 blocking；清理清单不全（哨兵/镜像列）；COS list/delete 与 worker_job 缺失 |
| auth | 未达就绪 / blocked | 权限矩阵缺口（parse/knowledge/B站 auth/静态挂载）；会话安全项缺失；Phase 3 依赖矛盾；验收不可证 |

## 3. 跨文档共性问题

1. **前置链未落地却自称就绪**：所有文档假设前序 Phase 已落地，但 live repo 中 Phase 1a/1b/2/3 全未实现（无 `cloud-server`/`nas-worker`/`server-common`，无 `worker_job`，`main.ts` 仍挂 `/summary-files`）。多份文档状态与 backlog（`blocked`/`needs-plan`）及 `ai-autonomy-policy.md` 冲突。
2. **保护区门禁**：Phase 3（部署）、Phase 4（数据删除）、auth（auth）在 `reviewer availability=none` 下应保持 **blocked**；文档自称"实现就绪/无阻塞项"不成立。
3. **代码清单系统性缺失**：5 份文档都低估了受影响的既有代码（镜像列、哨兵、通知、COS、Embedding、DownloadService 拆分、前端引用等）。
4. **Q12 未记录**：`enable_thinking` / `response_format` 在新 OpenAI SDK 下的处理仍是遗留，Phase 3 却称无 open question。
5. **验收不可测**：多处 AC 依赖 HTTP 层/E2E，而项目 E2E=`none`；缺少可执行的断言方式（fs spy、镜像内容断言、启动哨兵等）。

## 4. 各文档关键缺陷（摘要）

### Phase 1b
- **R1（高）** 停写本地 md 后 `summary-integrity.service.ts:102-121` / `summary-repair.service.ts:130-147` 立即失效或反向重建本地文件；需求把判据变更列为 out-of-scope，未声明过渡处置。
- **R2（高）** `knowledge_status`/`knowledge_error` 裁剪与「无 schema 变更」冲突，可能误入数据删除保护区。
- **R3/R4** 连带改动清单缺失：`AnalysisOutput.summaryPath`（`analysis-engine.ts:64`）、`notification.markdownPath`、`summary-repair`、`analysis.module`、`knowledge-backfill`；前端 publish/knowledgeStatus 引用（`frontend/src/api/index.ts:271-274`、`AiSummaryTasks.tsx`）。
- **R5** 验收不可验证（"不再写本地"无手段；依赖未落地的 1a）。
- **R6** 无时间戳段被丢弃（`analysis-engine.ts:319-338`），与"内容完整入库"矛盾。
- COS 未配置时当前**提前 return 不写 summary**（`knowledge-publisher.service.ts:70-78`），与目标"内容仍入库"相反，需解耦。

### Phase 2
- **B1** 示例 claim SQL 缺 `AND queue=$1` 与 `SET`（`status='leased'`、`lease_owner`、`lease_expires_at`、`started_at`、`attempts+1`）。
- **B2** 无租约 fencing（终态写入需校验仍持租约）；reaper 不强制 `max_attempts`；缺 `(status, lease_expires_at)` 索引。
- **B3** 低清↔分析编排缺失：移除 `onLowResFinished`（`download-scheduler.ts:253,271`）后无替代，行为回归。
- **B4** "移除 `onTaskFinished`"与保留下载进程内调度矛盾（`download.service.ts:675` 驱动槽位释放与 `tryScheduleNext`）。
- **B5** 启动对账（`download-scheduler.ts:53-65`、`analysis-trigger.service.ts:74-84`）会抢在租约到期前标 failed，使 AC「租约恢复」不成立。
- **B6** job 终态与领域状态事务/顺序未定；`claimAiSummaryTask` 领域守卫（`database.service.ts:1074-1121`）与 job 重放冲突。
- 替换清单遗漏 `runningSet`、`lowResRunningResources`、`taskCache`、`SummaryRepairService.running`；schema 缺默认值/索引/`dedup_key` 派生规则。

### Phase 3
- "cloud 不含 ffmpeg **代码**"不可达：`adapters` 单包根导出 `./ffmpeg`（`packages/adapters/src/index.ts:4-11`），`pnpm deploy` 会复制整个包；`chat.service.ts:7` 根导入会加载。只能做到"二进制/运行时/装配"隔离。
- `server-common → analysis/paths` 依赖违规（`database.service.ts:14-21` 引 `prompt-template`、`path-anchor`、`PathsService`），与"paths 归 nas-worker"冲突。
- `DatabaseService`（约 1783 行）/`DownloadService` 拆分未声明；隐藏共享代码未列（`CosStoreService`、`EmbeddingService`、`NotificationService`、`prompt-template`、Prisma contract/migration、`file-logger`）。
- 模块归属缺口：`cos_cleanup` 消费者（cloud）、reaper、knowledge 三件套拆分、`auth` 指 B站登录 vs 用户系统。
- 部署保护区：缺 owner doc（worker DB 最小权限矩阵）与 Dockerfile 验证证据；应 blocked。compose 版本来源（`compose.mjs:12-17` 读 `packages/server/package.json`）需重写。

### Phase 4
- 前置全未落地；`:5` 与 `:7` 自相矛盾。
- `:59` 开放问题改变 data/model shape 却未标 blocking。
- 清理清单不全：`task.summary_status`/`summary_output` 镜像列 + `mergeSummaryMirror`、`toRelativeSummaryOutputPath`、`SUMMARY_STATIC_PREFIX`、**启动哨兵 `ONE_OFF_MIGRATION_COLUMNS`（`database.service.ts:1694`，DROP 后不启动）**、`baseline/contract.prisma` 同步。
- 级联不闭环：`database.service.ts:1035-1050` 不删 `summary`；`cos-store.service.ts` 无 list/delete；`worker_job` 不存在。
- 备份/回滚/验证/停机窗口不足；删列不可逆但未要求 `pg_dump`。

### auth
- 权限矩阵缺口：parse/video、`/api/knowledge/search`、B站登录端点（`/api/auth/*`，会写全局 B站 cookie！）、`/summary-files` 静态挂载、chat 隔离细则、SPA 静态资源。
- 会话安全缺失：CSRF、cookie 属性（Secure/SameSite/Path/Max-Age）、token 生成与哈希、TTL、会话固定、吊销实现。
- `user_session` 表未出现在讨论稿；`user.disabled_at` 超出已确认字段。
- 回填与 bootstrap 顺序冲突（admin 未创建时如何回填）；bootstrap 无恢复路径（忘记密码）。
- Phase 3 依赖表述矛盾（"前置"vs"建议"）；AC 无 HTTP 层可证手段。

## 5. 建议整改顺序

1. **先修状态与门禁（低风险、全文档）**：把 Phase 3/4/auth 标为 `blocked`（保护区 + reviewer=none）；Phase 1b/2 标 `needs-plan`（未达就绪）；删除"无阻塞项"表述；把 Q12 补入 Phase 3 Open Questions。
2. **逐份深修**（建议顺序）：Phase 1b → Phase 2 → Phase 3 → auth → Phase 4。每份按各自审计的具体建议修订后**重新独立审计**。
3. **Phase 4 最后**：依赖前三者落地；其删列/删文件必须人工批准 + `pg_dump` + 哨兵同步。
4. 所有涉及 schema/跨模块/部署/auth 的项，`reviewer=none` 下不得以 cold-replay 替代。

## 6. 参考

- 各文档审计详情见本次子代理输出；本记录为其摘要。
- 上游：`docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`、`docs/audits/2026-09-17-requirement-reaudit-cloud-nas-and-phase1a.md`
