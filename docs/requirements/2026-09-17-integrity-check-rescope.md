# 需求：完整性检查重定义（内容/截图/视频三类，作业化）

> 来源：拆自 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（Q5 / 遗留问题 8；补全 2026-09-23）
> Owner Doc：`docs/design/app-overview.md`、`docs/architecture/system-baseline.md`
> 前置：Phase 1b（内容入 DB、截图入 COS、停写本地）、Phase 2（`integrity_check` 作业化）
> Supersedes（已确认 2026-09-23，被取代文档头部已加取代指针）：`docs/requirements/2026-09-07-summary-integrity-check.md`（旧版仅校验本地原始内容完整性；本需求以云 DB + COS + NAS 视频为判据取而代之）
> 保护区：无（不删数据 / 不改部署 / 不涉 auth；仅既有 `integrity_*` 列语义变更，无新增列）。需 plan audit（reviewer=none 可 cold-replay）。
> 状态：实现就绪（依赖 Phase 1b / 2）

## Goal

把完整性检查从"只查本地原始内容"改为"以云端为真源的三类校验"——内容（云 DB `summary`/`summary_segment` 完备）、截图（COS 截图可达 / `screenshot_url` 非空）、视频（NAS 本地视频存在）——结果分级 `complete`/`partial`/`missing`，报告结构化。检查作业化（Phase 2 的 `integrity_check` kind），NAS 认领执行，结果写回 DB，云端读接口 / UI 轮询展示。

## In Scope

### 三类判据

- **内容**：对 `completed` 记录，校验 `summary` + `summary_segment` 是否完备（无 `summary` 行或段缺失 → 记入 `contentMissing[]`）。以云 DB 为准，**不读本地 md**。
- **截图**：`summary_segment.screenshot_url` 是否齐全（全非空 = 完整；部分空 → 记入 `screenshotMissing[]`，列出 `seq`）；COS 可达性探测可选（见 Open Questions）。
- **视频**：NAS 本地视频文件是否存在（经媒体路径锚点 join `DOWNLOAD_ROOT`，**仅 NAS 执行**；缺失 → 记入 `videoMissing[]`）。

### 结果写回（复用既有列，无 schema 变更）

- `integrity_status ∈ {complete, partial, missing}`。
- `integrity_detail` = 结构化 JSON（文本列内存 JSON）：`{ contentMissing[], screenshotMissing[], videoMissing[] }`。
- `integrity_checked_at` 更新。

### 严重度分级

- **内容缺失**最重：判 `missing`（或 `partial`，视缺失范围）。
- **截图缺失**：判 `partial`。
- **视频缺失**：**仅告警**——记入 `videoMissing[]`，不单独把状态降为 `missing`（除非同时内容缺失）。

### 作业化（与 Phase 2 一致）

- `POST /api/summary-tasks/integrity-check` 改为投递 `integrity_check` 作业（`queue=nas`）。
- `GET /api/summary-tasks/integrity-check/status` 读 DB 作业 / 结果，不再读进程内 `running` 布尔。
- 云端读接口 / UI 轮询展示三类结果。

## Out Of Scope

- 自动修复（截图缺失 → `screenshot_retry`；视频缺失 → 下载作业；均另有需求）。
- 删除本地副本（Phase 4）。
- 新增列 / schema 变更。

## Business Rules

- **云端为真源**：内容以云 DB 为准，不读本地 md。
- **三类分级**：内容 > 截图 > 视频（视频仅告警）。
- **只读**：检查不改业务数据，仅写 `integrity_*` 三列。
- **幂等**：完整性检查作业可重复执行，结果可覆盖。

## Data / Model Impact

- **无 schema 变更**：复用 `ai_summary_task.integrity_status` / `integrity_detail` / `integrity_checked_at`（`contract.prisma:42-44`）；仅 `integrity_status` 取值扩展、`integrity_detail` 改为结构化 JSON 文本。

## API / Integration Impact

- 触发与 status 作业化（Phase 2 语义：写作业 + 轮询 DB）。
- `integrity_detail` 响应结构由自由文本改为结构化 JSON → 前端展示适配。

## Edge Cases

- `completed` 但无 `summary` 行 → `contentMissing`，状态 `missing`。
- `screenshot_url` 部分为空 → `screenshotMissing[]` 列出 `seq`，状态 `partial`。
- 视频文件缺失但内容/截图完备 → `videoMissing[]` + 告警，状态仍可为 `complete`（视频仅告警）。
- NAS 离线 → 作业保持 `queued`（Phase 2 语义）。
- COS 未配置 → 截图可达性探测跳过或标注，不误判。

## Open Questions

- 截图判定是否做 COS HEAD 可达性探测，还是仅凭 `screenshot_url` 非空判定（实现时定，不影响报告主结构）。

## Acceptance Criteria

- [ ] `integrity_status` 产出 `complete`/`partial`/`missing`；`integrity_detail` 为 `{contentMissing[],screenshotMissing[],videoMissing[]}` 结构化 JSON。
- [ ] 三类判据分别生效；视频缺失仅告警，不误判 `missing`。
- [ ] 触发与 status 走作业 + DB 轮询，不依赖进程内 `running`（与 Phase 2 一致）。
- [ ] 检查只读、不改业务数据；结果可经云端接口 / UI 展示。
- [ ] 内容完整性以云 DB 判定，不读本地 md。
- [ ] `pnpm typecheck`、`pnpm build` 通过；判据纯函数与数据层测试通过；owner doc 更新。
