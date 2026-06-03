# 2026-06-03-video-detail-page-improvement 视频解析页面优化计划

> Plan Status: planned
> Last Reviewed: 2026-06-03
> Source: `docs/requirements/2026-06-02-video-detail-page-improvement.md`
> Related: 无
> Audit: required

## 当前基线

本计划涉及两个模块。已与 `docs/design/app-overview.md` 交叉验证，无冲突。

### 前端 — `packages/frontend/src/views/VideoDetail.vue`

- 当前一次性展示所有 section（通过 `v-for` 遍历 `sectionTrees`），不限制可见数量。
- 表格第一列 header 文字为"选"，未准确表达该列用途。
- "解析选中"按钮仅解析用户手动勾选的分 P，且依赖用户先全选。
- "加入下载队列"按钮调用 `addToQueue()` → 创建所有选中分 P 的下载任务 → 入队完成后自动跳转到 `/downloading`。
- 无"已入队"判定逻辑：同一视频可被重复选中并重复创建下载任务。
- 无目录确认弹框：`outputPath` 直接使用未校验的 section 拼接值传入 `createDownload`。

### 后端 — `packages/server/src/`

关键文件/接口：

- `download.controller.ts`：`POST /api/download` 调用 `DownloadScheduler.createDownload(dto)`。当前 `createDownload` 处理校验失败时返回 `{ error: "..." }` 且 HTTP 状态码为 200。
- `download.dto.ts`：`DownloadDto { bvid, cid, title, quality?, codec?, outputPath? }`。
- `download.service.ts`：`createTask(dto)` 将任务写入 SQLite（状态 `created`）。
- `database.service.ts`：`TaskRecord { id, bvid, cid, status, createdAt, ... }`；表 `task` 有 `bvid`、`cid`、`status`、`createdAt` 字段及索引 `idx_task_status`、`idx_task_created`。**当前无 `(bvid, cid)` 组合索引**。
- 当前无按 `bvid + cid` 查询任务状态的后端接口。
- 当前 `createDownload` 不校验 `outputPath` 是否为空。

### 前端 Store — `packages/frontend/src/stores/useDownloadQueueStore.ts`

- 仅存储 `taskIds: number[]`（持久化到 localStorage），不存储 `bvid + cid` 信息。
- 不提供按 `bvid + cid` 查询是否已入队的能力。

## 目标

1. 前端新增 section 选择器，替代一次性展示所有 section。
2. 修正表格 header 文案为"选择"。
3. 替换"解析选中"为"解析当前页所有视频"。
4. 加入下载队列后不跳转到 `/downloading`。
5. 加入下载队列前弹出目录确认/修改弹框，空目录阻止提交。
6. 后端新增 `bvid + cid` 批量查询接口，支撑前端"已入队"去重逻辑和 24h 已完成任务复用。
7. 后端 `createDownload` 拒绝空 `outputPath`。

## 非目标

- 不修改 Core（`packages/core/`）。
- 不修改 CLI。
- 不修改 Docker 部署。
- 不修改认证/login 逻辑。
- 不新增跨页面下载管理能力。
- 不重新设计整个 Web UI。
- 已入队判定仅以 `bvid + cid` 为唯一标识，不考虑不同画质/编码的区分。
- 入队状态完全由后端接口提供，`useDownloadQueueStore` 不做修改（不持久化 `bvid + cid` 映射）。

## Infrastructure And Config Prereqs

- `pnpm install` 已有的依赖。
- 无新增外部服务、环境变量或 CORS 变更。
- 复用现有 SQLite 数据库和 `better-sqlite3`。

## 全局验证策略

三 Phase 属同一特性，计划关闭时写入一聚合日志至 `docs/logs/2026/06-03.md`。

## Execution Plan

### Phase 1 — 后端任务状态查询接口 + 入队去重逻辑

Status: planned
Targets: `packages/server/src/download/`, `packages/server/src/database/`, `packages/frontend/src/api/index.ts`, `packages/frontend/src/views/VideoDetail.vue`

- Item Types: Add | Decision
- Prereqs: 无

- [ ] **Add**：在 `DatabaseService.initSchema()` 中新增 `CREATE INDEX IF NOT EXISTS idx_task_bvid_cid ON task(bvid, cid)`。
- [ ] **Add**：在 `DatabaseService` 中新增 `findTasksByBvidsAndCids` 方法，返回每个 `(bvid, cid)` 的最新一条任务记录（按 `createdAt DESC` 取第一条）。
  - 行为约定：如果某 `(bvid, cid)` 在 task 表中有多条记录（如删除重建或重试），仅返回 `createdAt` 最晚的那条。
- [ ] **Add**：在 `DownloadController` 中新增 `POST /api/tasks/check` 端点，接收 `{ items: { bvid: string; cid: number }[] }`，返回每个 bvid+cid 的任务状态及 createdAt。
- [ ] **Add**：前端新增 `api.checkTasks(items)` 调用 `/api/tasks/check`。
- [ ] **Add**：在 `VideoDetail.vue` 的 `onMounted` 中，页面加载后调用 `api.checkTasks` 获取所有视频的入队状态，标记已入队的视频不可选。
- [ ] **Decision | Add**：实现 24h 已完成任务复用规则。
  - **Decision**: 以 `createdAt` 为时间基准（与需求文档一致）。
  - **24h 判定方向**：`findTasksByBvidsAndCids` 返回每个 `(bvid, cid)` 的最新一条任务。前端按以下规则判定该视频是否可选中：
    - 任务存在 **且** 状态为 `success` **且** `(now - createdAt) > 24h` → **可选中**（允许重新加入）。
    - 否则（任务不存在、或状态非 success、或 success 但距今 ≤ 24h） → **不可选中**（已入队）。
  - **替代方案**：在 SQL 层完成过滤——不采用，因前端需要完整记录供 UI 展示和调试，且判定逻辑简单、容易在 JS 中实现。

Phase 1 Exit Criteria:
- [ ] `POST /api/tasks/check` 端点可用，返回 `{ bvid, cid, status, createdAt }[]`。
- [ ] 前端 `api.checkTasks` 可正常调用并解析响应。
- [ ] 已入队视频在前端不可选中。
- [ ] 已完成超过 24 小时的视频允许重新加入。
- [ ] `idx_task_bvid_cid` 索引已创建。
- [ ] `docs/design/app-overview.md` 中 Integration Points 已更新（新增 `POST /api/tasks/check`）。
- [ ] `docs/logs/` 已更新。
- [ ] `pnpm typecheck` 通过。

### Phase 2 — 前端 Section 选择器 + 交互调整

Status: planned
Targets: `packages/frontend/src/views/VideoDetail.vue`

- Item Types: Add | Fix
- Prereqs: Phase 1（共用 `VideoDetail.vue` 的 `onMounted` 修改）

- [ ] **Add**：新增 section 选择器模块，以胶囊按钮形式一次性展示所有 section，按原有顺序排列。
- [ ] **Add**：默认选中第一个 section，仅渲染该 section 的 TreeTable。
- [ ] **Add**：点击胶囊按钮切换 section 时，重新渲染对应 section 的 TreeTable。
- [ ] **Add**：当 `ugcSeason` 为空时，不显示 section 选择器，直接展示默认合集正文（即当前无合集时的 mock 树逻辑保持不变）。
- [ ] **Fix**：将表格第一列 header 文字从"选"改为"选择"。
- [ ] **Add**：将"解析选中"按钮替换为"解析当前页所有视频"，点击时解析当前选中 section 内所有尚未解析的视频（不依赖用户先全选）。
- [ ] **Fix**：移除 `addToQueue` 中的 `router.push("/downloading")`，加入队列后停留在当前页面。
- [ ] **Fix**：加入队列失败时停留在当前页面并展示错误信息。

Phase 2 Exit Criteria:
- [ ] section 选择器胶囊按钮正常展示、切换和默认选中。
- [ ] 无合集时不显示 section 选择器，直接展示视频内容。
- [ ] 表格第一列 header 文案已修正为"选择"。
- [ ] "解析当前页所有视频"可解析当前选中 section 内所有未解析视频。
- [ ] 入队后不跳转到 `/downloading`。
- [ ] 入队失败不跳转且有错误提示。
- [ ] `docs/design/app-overview.md` 中 Main Surfaces / Core Workflows 已更新（section 选择器、入队不跳转、新增按钮）。
- [ ] `docs/logs/` 已更新。
- [ ] `pnpm typecheck` 通过。

### Phase 3 — 目录确认弹框 + 空目录校验

Status: planned
Targets: `packages/frontend/src/views/VideoDetail.vue`, `packages/server/src/download/download.dto.ts`, `packages/server/src/download/download.controller.ts`, `packages/server/src/download/download.service.ts`

- Item Types: Add | Decision
- Prereqs: Phase 2（前端弹框依赖 section 选择器提供当前 section 信息），后端校验部分可独立于 Phase 2

- [ ] **Add**：前端在 `addToQueue` 中，点击"加入下载队列"时弹出目录确认/修改弹框。
- [ ] **Add**：弹框默认填入当前 section 的默认目录路径；无合集场景（`ugcSeason` 为空）直接填入视频标题作为默认目录。
- [ ] **Add**：弹框中前端校验目录非空，目录为空时阻止提交并有提示。
- [ ] **Decision | Add**：后端 `createDownload` 新增 `outputPath` 空字符串校验，拒绝空目录并返回 HTTP 400。
  - **Decision**: 为统一错误处理行为，`createDownload` 的所有必填字段校验（`bvid`、`cid`、`title`、`outputPath`）均改为抛出 NestJS `BadRequestException`（HTTP 400），替代当前返回 `{ error: "..." }` + HTTP 200 的模式。
  - **替代方案**：仅在 `outputPath` 为空时特殊处理抛 400，其余校验保持原样——不采用，因会导致同一个端点内校验错误处理不一致，增加调用方的复杂性。
  - **实施范围**: 此变更落在 `download.controller.ts` 的 `createDownload` 方法中，不扩展至其他端点。
- [ ] **Proof**：对 `POST /api/download` 使用 curl 验证空 `outputPath` 返回 400 及错误信息。

Phase 3 Exit Criteria:
- [ ] 目录确认弹框正常展示，默认填入 section 默认目录；无合集场景填入视频标题。
- [ ] 弹框可修改目录，修改后加入队列使用修正后的目录。
- [ ] 前端空目录校验：阻止提交并有提示。
- [ ] 后端空目录校验：返回 400 错误。
- [ ] 后端其他校验字段（bvid/cid/title）也统一使用 BadRequestException（HTTP 400）。
- [ ] `docs/design/app-overview.md` 中 Integration Points 已更新（`createDownload` 校验行为变更说明）。
- [ ] `docs/logs/` 已更新。
- [ ] `pnpm typecheck` 通过。

## Plan Audit

- Status: passed
- Reviewer / Agent: independent subagent（Round 1 / Round 2 / Round 3 审查均已执行）
- Evidence: 3 轮审查共发现 8 Must Fix + 8 Should Fix + 5 Nice Fix，全部修复。

### Audit History

| Round | Date | Method | Issues Found | Fixes Applied |
|-------|------|--------|-------------|---------------|
| 1 | 2026-06-03 | independent subagent | 6 MF + 5 SF + 4 NF | 全部修复 |
| 2 | 2026-06-03 | independent subagent | 2 MF + 2 SF + 1 NF | 全部修复 |
| 3 | 2026-06-03 | independent subagent | 1 SF | 已修复 |

## Closure Gates

- [ ] Phase 1 Exit Criteria 全部满足
- [ ] Phase 2 Exit Criteria 全部满足
- [ ] Phase 3 Exit Criteria 全部满足
- [ ] `docs/design/feature-inventory.md` 中"视频解析页面优化"状态已更新（`planned` → `done`）
- [ ] Plan Audit 通过
- [ ] Closure Audit 通过
- [ ] text consistency 验证通过
- [ ] `pnpm typecheck` 通过

## Deferred But Adjudicated

### 跨页面"已入队"状态同步

- Classification: optimization candidate
- Why Not Blocking Closure: 当前仅需在视频解析页面加载时查询一次入队状态；实时跨页面同步（如用户在下载页删除任务后回退到解析页刷新入队状态）可通过页面重新挂载时的 `onMounted` 自然覆盖。
- Successor Required: yes
- Trigger condition: 当用户反馈频繁在下载页删除任务后回退到解析页发现入队状态未刷新时，将此问题提升为 P1 并建立 successor plan。

## Closure

Status Note: 待完成

Closure Audit Evidence:
- Reviewer / Agent: 待定
- Evidence: 待记录

Follow-up:
- 当用户规模增大时，`POST /api/tasks/check` 可能需要分页或增加索引优化（当前已建立 `idx_task_bvid_cid` 索引作为基线保障）。
- 当需要区分"同视频不同画质/编码"的去重时，扩展查询接口入参和返回结构。