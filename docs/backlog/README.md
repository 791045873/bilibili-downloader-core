# Backlog

## Purpose

Use this file to list candidate work AI may inspect or execute.

The backlog is not a replacement for requirements, owner docs, or plans. It only helps select the next slice.

## Work Items

### 已完成与历史项

| Priority | Item | Requirement | Owner Doc | Plan | Status | AI Autonomy | Blocker | Last Checked |
|----------|------|-------------|-----------|------|--------|-------------|---------|--------------|
| P0 | 本地开发体验优化 | `docs/requirements/2026-06-11-local-dev-experience.md` | `docs/design/app-overview.md` | `docs/plans/2026-06-11-local-dev-experience-plan.md` | `done` | `implement` | `none` | 2026-07-12 |
| P0 | 视频解析页面优化 | `docs/requirements/2026-06-02-video-detail-page-improvement.md` | `docs/design/app-overview.md` | `docs/plans/2026-06-03-video-detail-page-improvement-plan.md` | `done` | `implement` | `none` | 2026-07-12 |
| P1 | 下载目录指定与查看 | `docs/requirements/2026-06-15-download-directory-view.md` | `docs/design/app-overview.md` | `docs/plans/2026-06-15-download-directory-view-plan.md` | `done` | `implement` | `none` | 2026-07-12 |
| — | 字幕下载（按语言选择） | `docs/requirements/2026-06-15-subtitle-download-feature.md` | `docs/design/app-overview.md` | `docs/plans/2026-06-15-subtitle-download-implementation-plan.md` | `done` | `implement` | `none` | 2026-07-12 |
| — | 视频分析总结（v1 调试版） | `docs/requirements/2026-07-06-video-analysis-summary.md` | `docs/design/app-overview.md` | `docs/plans/2026-07-06-video-analysis-summary-plan.md` | `done` | `implement` | `none` | 2026-07-12 |
| P0 | UI 界面优化 | `docs/requirements/2026-06-02-ui-improvement.md`（deprecated） | `docs/design/app-overview.md` | `none` | `blocked` | `blocked` | `需求已废弃：范围涉及交互调整和后端接口修改，需重写需求` | 2026-07-12 |

### 待实现：2026-07-07 视频分析增强系列（9 项，按推荐顺序）

实现顺序由各 plan 头部 `> Related:` 字段的显式依赖声明推导（见下方“推荐实现顺序”）。所有项 plan 已写好且 plan audit 已于 2026-07-12 通过（cold-replay proxy, reviewer availability = none），用户已授权依次实现。

| Seq | Phase | Priority | Item | Requirement | Owner Doc | Plan | Status | AI Autonomy | Blocker | Last Checked |
|-----|-------|----------|------|-------------|-----------|------|--------|-------------|---------|--------------|
| 1 | 1 | P0 | 视频分析-正式分析 API | `docs/requirements/2026-07-07-analysis-formal-api.md` | `docs/design/app-overview.md` | `docs/plans/2026-07-07-analysis-formal-api-plan.md` | `done` | `implement` | `none (plan audit + closure audit passed 2026-07-12)` | 2026-07-12 |
| 2 | 1 | P0 | 视频分析-截图远端化（3a） | `docs/requirements/2026-07-07-screenshot-source-fallback-3a.md` | `docs/design/app-overview.md`（待扩展） | `docs/plans/2026-07-07-screenshot-remote-3a-plan.md` | `done` | `implement` | `none (closed by human review + no-cookie remote verification on 2026-07-14)` | 2026-07-14 |
| 3 | 1 | P0 | 视频分析-多链接解析后端（4a） | `docs/requirements/2026-07-07-multi-link-parsing-4a.md` | `docs/design/app-overview.md`（待扩展） | `docs/plans/2026-07-07-link-parsing-backend-4a-plan.md` | `done` | `plan-first` | `none (closed with independent closure audit on 2026-07-14)` | 2026-07-14 |
| 4 | 1 | P0 | 视频分析-AI 总结数据库（5a） | `docs/requirements/2026-07-07-ai-summary-interaction-5a.md` | `docs/design/app-overview.md`（待扩展） | `docs/plans/2026-07-07-ai-summary-database-5a-plan.md` | `done` | `plan-first` | `none (closed with independent closure audit on 2026-07-14)` | 2026-07-14 |
| 5 | 2 | P1 | 视频分析-文档结构优化 | `docs/requirements/2026-07-07-document-structure-optimization.md` | `docs/design/app-overview.md`（待扩展） | `docs/plans/2026-07-07-document-structure-optimization-plan.md` | `done` | `plan-first` | `none (closed with independent closure audit on 2026-07-14)` | 2026-07-14 |
| 6 | 2 | P1 | 视频分析-截图源回退（3b） | `docs/requirements/2026-07-07-screenshot-source-fallback-3b.md` | `docs/design/app-overview.md`（待扩展） | `docs/plans/2026-07-07-screenshot-fallback-3b-plan.md` | `done` | `plan-first` | `none (closed with independent closure audit on 2026-07-14)` | 2026-07-14 |
| 7 | 2 | P1 | 视频分析-多链接解析前端（4b） | `docs/requirements/2026-07-07-multi-link-parsing-4b.md` | `docs/design/app-overview.md`（待扩展） | `docs/plans/2026-07-07-link-parsing-frontend-4b-plan.md` | `done` | `plan-first` | `none (closed with independent closure audit on 2026-07-14)` | 2026-07-14 |
| 8 | 3 | P1 | 视频分析-AI 总结触发（5b） | `docs/requirements/2026-07-07-ai-summary-interaction-5b.md` | `docs/design/app-overview.md`（待扩展） | `docs/plans/2026-07-07-ai-summary-trigger-5b-plan.md` | `done` | `plan-first` | `none (closed with independent closure audit on 2026-07-14)` | 2026-07-14 |
| 9 | 4 | P2 | 视频分析-AI 总结邮件通知（5d） | `docs/requirements/2026-07-07-ai-summary-interaction-5d.md` | `docs/design/app-overview.md`（待扩展） | `docs/plans/2026-07-07-ai-summary-email-5d-plan.md` | `done` | `plan-first` | `none (closed with independent closure audit on 2026-07-15)` | 2026-07-15 |

## 推荐实现顺序（2026-07-07 视频分析增强系列）

顺序依据：各 plan 文档头部 `> Related:` 字段显式声明的依赖关系（非人为排定）。

### 依赖拓扑

```
Seq 1 formal-api ──► Seq 5 doc-opt ──┐
                                     ├──► Seq 8 5b ──► Seq 9 5d
Seq 2 3a ──► Seq 6 3b ────────────── ┤
                                     │
Seq 4 5a ─────────────────────────── ┤
                                     │
Seq 3 4a ──► Seq 7 4b ────────────── ┘
```

### 分阶段执行

- **Phase 1（无前置，可并行启动）**：Seq 1 formal-api、Seq 2 3a、Seq 3 4a、Seq 4 5a
  - formal-api 最优先：被 doc-opt、3b、5b 共 3 项依赖，是下游基础
  - 四项互相独立，资源允许时并行推进
- **Phase 2（依赖 Phase 1）**：Seq 5 doc-opt（←formal-api）、Seq 6 3b（←3a+formal-api）、Seq 7 4b（←4a）
  - 三项互相独立，可并行
- **Phase 3（汇聚）**：Seq 8 5b（←5a+formal-api+doc-opt+3b+4b）
  - 依赖项最多，必须等 Phase 1+2 全部完成
- **Phase 4（附加）**：Seq 9 5d（←5b）
  - 邮件通知为附加功能，优先级最低

### 前置门控

每个 Seq 实现前必须：
1. 通过独立 plan audit（所有 9 项 plan audit 已于 2026-07-12 通过，cold-replay proxy）
2. 同步扩展 `docs/design/app-overview.md` 与 `docs/design/feature-inventory.md` 以覆盖新接口/新表
3. 确认 `docs/context/project-context.md` 的 active requirement 已指向对应项

### 顺序非强制串行

上述 Seq 编号是拓扑序的一个可行投影。实际执行中：
- 同一 Phase 内的项可并行
- 跨 Phase 不可乱序（依赖未就绪会导致返工）
- 若发现 plan 实际依赖与声明不符，应先修订 plan 的 `> Related:` 字段，再调整本表 Seq

## Readiness Invariants

`ready` means all of these are true:

- requirement path exists and has testable acceptance criteria
- owner doc path exists and is not known stale for this slice
- verification commands in `docs/context/project-context.md` are real
- blocking open questions are absent or explicitly non-blocking
- protected areas are configured in `docs/context/ai-autonomy-policy.md`
- planning triggers were checked

`Plan: none` is valid only when the item clearly qualifies for the no-plan path in `docs/plans/00-plan-authoring-and-execution-guide.md`. If a plan is required, set AI autonomy to `plan-first` until the plan audit passes.

Agents may downgrade stale rows from `ready` to `needs-*` or `blocked` with evidence. Agents must not upgrade rows to `ready`, change autonomy to `implement`, or clear blockers without human confirmation or human-approved owner-doc evidence.

## Status Values

- `idea` - not ready for implementation
- `needs-requirement` - raw input exists but no implementation-ready requirement exists
- `needs-design` - requirement exists but owner doc is missing or stale
- `ready` - AI may proceed according to the autonomy label
- `in-progress` - currently being implemented or planned
- `blocked` - cannot proceed until the blocker is resolved
- `done` - completed and verified

## AI Autonomy Values

Use the values from `docs/context/ai-autonomy-policy.md`:

- `implement`
- `plan-first`
- `ask-first`
- `research-only`
- `blocked`

## Selection Rule

When asked to continue without a named task, choose the highest-priority `ready` item whose `AI Autonomy` is `implement` and whose `Blocker` is `none`.

Before implementation, confirm the linked requirement, owner doc, plan field, autonomy policy, and planning triggers are still valid. Do not infer readiness from chat alone.

If the table is stale, downgrade the row or ask before implementation.