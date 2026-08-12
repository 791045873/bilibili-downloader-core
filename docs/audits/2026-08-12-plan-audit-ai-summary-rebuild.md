# Plan Audit — AI 总结"重新构建总结"

- 计划：`docs/plans/2026-08-12-ai-summary-rebuild-from-raw-plan.md`
- 需求来源：`docs/requirements/2026-08-12-ai-summary-rebuild-from-raw.md`
- 审计日期：2026-08-12
- 审计方式：独立 subagent 两轮（首轮 `ses_0099a90a0ffe4X0WNtrnqDAy9g`，复审 `ses_00996e17cffe5fpWlWkol7WZ3e`），对照 live 代码与 plan guide

## 首轮结论

`needs revision`

### 阻断问题

- **并发防抖 409 机制矛盾**：若认领发生在 `rebuildSummaryTask` 内部（fire-and-forget），第二次并发请求的 ConflictException 会被 controller 的 `.catch(记日志)` 吞掉，客户端得到 200 而非需求 AC1 要求的 409。
- **Item Type 违规**：Phase 1 使用 `Refactor`，plan guide 仅允许 Fix/Add/Decision/Proof/Follow-up。

### 修订

- 控制器**同步**校验：非法 id/不存在/状态非 completed/rawResponse 空（数据源 `databaseService.getAiSummaryTaskById` 完整记录，service 视图剥离了 rawResponse）/`!tryStartRebuild(id)` → 409；随后 `void runRebuild(id).catch(记日志)`。`runRebuild` 不再重复认领，`finally` 统一释放。
- Phase 1 Item Types 改为 `Add | Fix`；基线补充 `analysis.controller.ts` 第二个 AnalysisEngine 消费方。

## 复审结论

`passed`

- B-1 消解：机制自洽——控制器同步 `tryStartRebuild`（失败即 409），`void runRebuild(id)` 不重复认领、finally 释放；`runRebuild` 重校验抛错被 `.catch` 接住，无异常泄漏；`tryStartRebuild` 同步无 throw，无 claim/执行间隙。AC1 满足。
- B6 消解：全文 Item Types 仅 Fix/Add/Decision/Proof。
- 上轮建议全部落地：执行期重校验、无任务分支抛错、`record.modelName ?? ""` 兜底、rawResponse 数据源明确。
- 非阻断建议（tryStartRebuild 措辞、AnalysisInput 完整字段）已吸收。

## 事实核查确认

- `aiSummaryTaskSelectSql` 含 `raw_response`（database.service.ts:333），service 视图确实剥离 rawResponse（analysis-trigger.service.ts:30-33, 572-582）。
- `new AnalysisEngine(undefined)` 不触发 `getLlmConfig()`（getLlmConfig 在 trigger service 内调用，非构造函数）。
- upsertAiSummaryTask 未提供字段保留既有值（database.service.ts:934-948）。
- 验证命令 `pnpm typecheck`/`pnpm build` 存在于根 package.json。
