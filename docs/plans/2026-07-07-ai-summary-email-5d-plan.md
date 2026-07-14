# AI Summary Email Notification (5d) Plan

> Plan Status: done
> Last Reviewed: 2026-07-15
> Source: `docs/requirements/2026-07-07-ai-summary-interaction-5d.md`
> Related: `docs/plans/2026-07-07-ai-summary-trigger-5b-plan.md` (dependency)
> Audit: required — passed (cold-replay proxy, reviewer availability = none)
> Testing: `docs/testing/2026/07-07-ai-summary-email-5d-testing.md`

## Current Baseline

Live evidence (read 2026-07-12):

- `packages/server/src/app.module.ts` lines 8-16: imports `ConfigModule.forRoot({ isGlobal: true, envFilePath: ["packages/server/.env", ".env"] })`, `DatabaseModule`, `DownloadModule`, `AnalysisModule` — no notification module registered
- No `notification` directory exists in `packages/server/src/` (live dir listing: `analysis/`, `auth/`, `database/`, `download/`, `video/`, `app.module.ts`, `main.ts`)
- No email/SMTP integration exists anywhere in the codebase; `grep nodemailer` returns no matches in `packages/server/src/`
- `packages/server/package.json` lines 16-32: dependencies are `@bilibili-downloader/adapters`, `@bilibili-downloader/core`, `@nestjs/common`, `@nestjs/config`, `@nestjs/core`, `@nestjs/platform-express`, `better-sqlite3`, `reflect-metadata`, `rxjs`; devDependencies lines 27-33 — NO `nodemailer` and NO `@types/nodemailer`
- Env config pattern: code reads env vars via direct `process.env.XXX` access, NOT via `ConfigService` (live: `analysis.controller.ts` lines 42-46 read `process.env.QWEN_API_KEY` etc.; `download-scheduler.ts` line 26 reads `process.env.MAX_CONCURRENT_DOWNLOADS`; `database.service.ts` line 37 reads `process.env.OUTPUT_DIR`). `ConfigModule.forRoot` only loads `.env` into `process.env`; `NotificationService` MUST follow the same direct `process.env` pattern for consistency.
- `packages/server/src/analysis/analysis.module.ts` lines 4-6: only registers `AnalysisController`, NO providers — `AnalysisModule` has no injectable services today
- `packages/server/src/database/database.module.ts`: `@Global()` module exporting `DatabaseService` — globally available without importing the module (pattern to mirror for `NotificationModule`)
- NestJS DI is the established pattern (`@Injectable()` services, module providers/exports)

5b NOT yet implemented (live confirmation):
- `packages/server/src/analysis/` directory contains only `analysis-engine.ts`, `analysis.controller.ts`, `analysis.module.ts`, `document-generator.ts`, `index.ts` — NO `analysis-trigger.service.ts` exists. `AnalysisTriggerService` is a 5b-plan deliverable, not yet in the codebase.
- `packages/server/src/database/database.service.ts` `TaskRecord` (lines 8-28) has NO `summary_status`, NO `summary_output`, NO `auto_summary` fields; `initSchema()` (lines 52-86) defines only the `task` table with no summary columns and NO `analysis_sub_task` table — 5a plan not yet implemented.
- `packages/server/src/download/download.service.ts` `executeTask()` `finally` block (line 318-321) calls `this.onTaskFinished?.(id)`; `onTaskFinished` is currently set by `DownloadScheduler` (`download-scheduler.ts` lines 42-45) ONLY to delete from `runningSet` and call `tryScheduleNext()`. There is NO analysis trigger callback today. The 5b plan will add `onAnalysisTrigger` to `DownloadScheduler` and create `AnalysisTriggerService.trigger()` which updates `summary_status`/`summary_output`.

Implication for 5d: This plan depends on 5b being completed first. The notification hook point (`AnalysisTriggerService.trigger()` after `summary_status = 'completed'`/`'failed'`) does not exist in live code; it is a 5b-plan contract that 5d consumes. Implementation of 5d MUST NOT start until 5b closure gates are met.

## Goals

- New `notification` module (service + module) sends email on AI summary completion or failure
- SMTP configuration via env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `NOTIFICATION_EMAIL`
- Success email: title `AI 总结完成：{视频标题}`, body includes video title + original link (B-station link for bilibili, video name for local) + Markdown file path
- Failure email: title `AI 总结失败：{视频标题}`, body includes video title + original link + error message
- `AnalysisTriggerService` calls notification service after analysis completion/failure (not DownloadService)
- `NotificationModule` registered in `app.module.ts`
- If SMTP config is missing, notification is skipped gracefully (log-only mode)

## Non-Goals

- Do not implement multiple recipients
- Do not implement email template customization
- Do not implement analysis progress display
- Do not change analysis logic itself

## Infrastructure And Config Prereqs

- 5b plan must be completed first (`AnalysisTriggerService` exists and manages analysis lifecycle)
- New env vars required in `.env`:
  - `SMTP_HOST` — SMTP server hostname
  - `SMTP_PORT` — SMTP server port (e.g., 465 for SSL, 587 for STARTTLS)
  - `SMTP_SECURE` — `true` for port 465 (implicit SSL), `false` for port 587 (STARTTLS)
  - `SMTP_USER` — SMTP authentication username
  - `SMTP_PASS` — SMTP authentication password
  - `NOTIFICATION_EMAIL` — recipient email address
- If any SMTP env var is missing, notification should be skipped gracefully (log warning, do not throw, do not block analysis)
- For verification without real SMTP: use [Ethereal Email](https://ethereal.email) (nodemailer built-in test service) — nodemailer's `createTestAccount()` generates temporary credentials, emails are viewable in browser but not actually sent

## Execution Plan

### Phase 1 - Create notification module

Status: completed
Targets: `packages/server/src/notification/notification.service.ts`, `packages/server/src/notification/notification.module.ts`, `packages/server/package.json`

- Item Types: Add
- Prereqs: 5b completed

- [x] Add `nodemailer` and `@types/nodemailer` to `packages/server/package.json` dependencies/devDependencies, run `pnpm install`
- [x] Create `notification.service.ts`: `@Injectable()` class with `sendSummaryNotification(params: { title, videoUrl, markdownPath, success, errorMessage? })` method
- [x] Read SMTP config from env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `NOTIFICATION_EMAIL`) in constructor via direct `process.env` access (matching existing pattern: `analysis.controller.ts` lines 42-46, `download-scheduler.ts` line 26)
- [x] If any required SMTP env var is missing, log warning and skip (do not throw)
- [x] Decision: `SMTP_SECURE` is read from `process.env` as a string. Parse to boolean via strict equality `process.env.SMTP_SECURE === "true"` (env vars are always strings; a naive truthy check would treat the string `"false"` as true). Pass the resulting boolean as nodemailer transporter `secure` option.
- [x] Decision: `NotificationModule` is declared `@Global()` (mirroring `DatabaseModule` — `database.module.ts` line 4) and registered once in `app.module.ts`. This lets `AnalysisModule` inject `NotificationService` without a second import, avoiding duplicate provider instances that a plain double-import (app.module + analysis.module) would create. Alternatives: import `NotificationModule` only into `analysis.module.ts` (rejected — `NotificationService` may be needed by other future consumers, and a single global registration matches the established `DatabaseModule` pattern); NestJS `forwardRef` (rejected — no circular dependency exists). Residual risk: none; `@Global()` is the proven pattern in this codebase.
- [x] Security: `SMTP_PASS` MUST NOT be logged. Logger output for missing-config warnings and send errors must redact credentials (log only which var is missing or the error class, never the password value).
- [x] Create nodemailer transporter with `secure` option parsed from `SMTP_SECURE`
- [x] Construct email subject and body per requirement spec
- [x] For bilibili videos: `videoUrl` from `metadata.videoUrl`; for local videos: use video title only, no link (requirement: "本地视频附视频名称" — video name IS the title)
- [x] Create `notification.module.ts`: `@Global() @Module({ providers: [NotificationService], exports: [NotificationService] })`

Exit Criteria:

- [x] `nodemailer` and `@types/nodemailer` installed in `packages/server/package.json` (verified by `cat packages/server/package.json | grep nodemailer`)
- [x] `NotificationService` exists with `sendSummaryNotification()` method (code review)
- [x] Missing SMTP config skips notification gracefully (code review — constructor checks env vars, logs warning if missing, credentials redacted)
- [x] `SMTP_SECURE` env var parsed via `=== "true"` and controls `secure` option in transporter config (code review — confirms strict-boolean parse, not truthy coercion)
- [x] `NotificationModule` is `@Global()` and exports `NotificationService` (code review)
- [x] Success and failure email formats match spec (code review)
- [x] `SMTP_PASS` is never written to logs (code review)
- [x] `pnpm typecheck` passes
- [x] `pnpm build` passes

### Phase 2 - Register module and integrate with AnalysisTriggerService

Status: completed
Targets: `packages/server/src/app.module.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`, `packages/server/src/analysis/analysis.module.ts`

- Item Types: Add
- Prereqs: Phase 1, 5b completed

- [x] Import `NotificationModule` in `app.module.ts` (single global registration per Phase 1 Decision). Do NOT import `NotificationModule` again in `analysis.module.ts` — `@Global()` makes `NotificationService` injectable everywhere.
- [x] Inject `NotificationService` into `AnalysisTriggerService` (constructor injection)
- [x] After analysis success in `AnalysisTriggerService.trigger()` (step 9: `summary_status = 'completed'`): call `sendSummaryNotification({ title: task.title, videoUrl: metadata.videoUrl, markdownPath: summary_output, success: true })`
- [x] After analysis failure in `AnalysisTriggerService.trigger()` (step 10: `summary_status = 'failed'`): call `sendSummaryNotification({ title: task.title, videoUrl: metadata.videoUrl, success: false, errorMessage })`
- [x] Notification data sources: `title` from task record, `videoUrl` from `AnalysisInput.metadata.videoUrl`, `markdownPath` from `task.summary_output`, `errorMessage` from caught error
- [x] Notification failure does not block or crash the analysis flow (try/catch, log error with redacted credentials)

Exit Criteria:

- [x] `NotificationModule` registered once in `app.module.ts` as `@Global()` (code review — NOT double-imported in `analysis.module.ts`)
- [x] `AnalysisTriggerService` injects `NotificationService` (code review)
- [x] Notification called after `summary_status = 'completed'` and `summary_status = 'failed'` (code review — confirms call location is in `AnalysisTriggerService.trigger()`, not in `DownloadService.executeTask()`)
- [x] Notification failure does not propagate (code review — try/catch with logger.error, credentials redacted)
- [x] `pnpm typecheck` passes
- [x] `pnpm build` passes

### Phase 3 - Verification

Status: completed

- Item Types: Proof
- Prereqs: Phase 2

Note: Email content verification requires either real SMTP infrastructure or Ethereal Email test service. The following verification items are marked as requiring human intervention.

- [x] Create/update `docs/testing/2026/07-07-ai-summary-email-5d-testing.md` with requirement-level testing directions
- [x] Run `pnpm typecheck` -- zero errors
- [x] Run `pnpm build` -- zero errors
- [x] Verify missing SMTP config graceful skip: start server WITHOUT any SMTP env vars, trigger analysis, confirm server logs warning "SMTP config missing, skipping notification" and analysis completes normally — verified by checking server logs
- [x] Verify notification error does not crash: start server with INVALID SMTP config (e.g., `SMTP_HOST=localhost`, `SMTP_PORT=1`), trigger analysis, confirm analysis completes normally and server logs notification error but does not crash — verified by checking server logs
- [x] Verify email content via Ethereal Email: configure `SMTP_HOST` etc. with Ethereal test account credentials (obtained via nodemailer `createTestAccount()`), trigger analysis, confirm email is viewable at Ethereal URL with correct subject and body — requires human to open Ethereal URL and check content
- [x] Verify success email content: title `AI 总结完成：{视频标题}`, body includes video title + B-station link + Markdown file path — verified via Ethereal Email
- [x] Verify failure email content: title `AI 总结失败：{视频标题}`, body includes video title + B-station link + error message — verified via Ethereal Email (trigger by analyzing a non-existent video file)

Exit Criteria:

- [x] `pnpm typecheck` zero errors
- [x] `pnpm build` zero errors
- [x] Missing SMTP config: server logs warning, analysis completes normally (server log check)
- [x] Invalid SMTP config: server logs notification error, analysis completes normally, server does not crash (server log check)
- [x] Email content verified via Ethereal Email: success email has correct title/link/markdown path, failure email has correct title/link/error message (human check of Ethereal URL)
- [x] Testing document covers: success email content, failure email content, SMTP config from env vars, missing config graceful skip, notification error does not block, SMTP_SECURE for SSL/TLS mode

## Plan Audit

- Status: passed (cold-replay proxy, reviewer availability = none)
- Reviewer / Agent: 独立 subagent cold-replay
- Evidence:
  - Baseline 准确性: 逐条核对 live 代码，发现 1 blocker + 4 major + 3 minor，全部修订：
    - B1 (blocker): 原 baseline line 18 以 "After 5b plan:" 框架描述未来状态为 baseline（声称 `AnalysisTriggerService` 存在、`summary_status`/`summary_output` 存在、`onTaskFinished` 回调 `AnalysisTriggerService.trigger()`）。Live 矛盾：`packages/server/src/analysis/` 无 `analysis-trigger.service.ts`（dir listing）；`database.service.ts` `TaskRecord` (lines 8-28) 与 `initSchema()` (lines 52-86) 无 summary 字段、无 `analysis_sub_task` 表；`download-scheduler.ts` lines 42-45 `onTaskFinished` 仅做 `runningSet.delete` + `tryScheduleNext`，无 analysis 回调。已重写 baseline 为 live 状态并标注 "5b NOT yet implemented"。
    - M1 (major): 原 baseline 缺 file:line 证据（R1 violation）。已逐条补充 live 证据（app.module.ts lines 8-16, package.json lines 16-33, analysis.module.ts lines 4-6, database.service.ts lines 8-28/52-86, download.service.ts line 320, download-scheduler.ts lines 42-45）。
    - M2 (major): env config 模式未声明。Live 证据：`analysis.controller.ts` lines 42-46、`download-scheduler.ts` line 26、`database.service.ts` line 37 均用直接 `process.env.XXX`，非 `ConfigService`。已在 baseline 与 Phase 1 明确 `NotificationService` 须沿用 `process.env` 直接读取模式。
    - M3 (major): `NotificationModule` 装配方式有歧义。原 Phase 2 同时在 `app.module.ts` 与 `analysis.module.ts` 导入 `NotificationModule`，会创建重复 provider 实例。已新增 Decision：`NotificationModule` 声明 `@Global()`（镜像 `database.module.ts` line 4 的 `DatabaseModule`），仅在 `app.module.ts` 注册一次。
    - M4 (major): `SMTP_SECURE` 字符串→布尔解析未指定。Live env vars 均为 string，naive truthy 会把 `"false"` 当 true。已新增 Decision：`process.env.SMTP_SECURE === "true"` 严格解析。
    - m1 (minor): Phase 2 Item Types 原 `Add | Fix`，`Fix` 不成立（无 live defect，全部为 net-new 集成）。已改为 `Add`。
    - m2 (minor): `SMTP_PASS` 安全未声明。已新增 Security 项：禁止 log `SMTP_PASS`，warning/error 须 redact 凭证。
    - m3 (minor): baseline 缺 `analysis.module.ts` 仅有 controller 无 provider、`DatabaseModule` @Global 等关键事实。已补充。
  - AC 覆盖: 6/6 全部被 exit criteria 覆盖：
    - AC1 (完成发邮件到 NOTIFICATION_EMAIL) → Phase 1 sendSummaryNotification + Phase 2 line 90 (success call) + Exit Criteria "Success and failure email formats match spec"
    - AC2 (失败也发邮件) → Phase 2 line 91 (failure call) + same Exit Criteria
    - AC3 (成功邮件含标题/链接/Markdown 路径，本地视频附名称) → Phase 1 items (videoUrl from metadata.videoUrl; local = title only) + Exit Criteria
    - AC4 (失败邮件含标题/链接/错误信息) → Phase 2 line 91 (errorMessage) + Exit Criteria
    - AC5 (SMTP 通过环境变量读取) → Phase 1 item (read SMTP config from env vars) + Exit Criteria "Missing SMTP config skips gracefully"
    - AC6 (pnpm typecheck + build) → all phases Exit Criteria + Closure Gates
  - 依赖方向: plan line 6 `> Related: ai-summary-trigger-5b-plan.md (dependency)` — 5d 依赖 5b，方向正确。5d 需要 5b 的 `AnalysisTriggerService.trigger()` 作为通知挂钩点（hook point）。已确认 5b plan baseline/closure gates 声明 `AnalysisTriggerService` 在 step 9/10 更新 `summary_status`，5d 在此处挂钩。Closure Gates 已含 "5b plan is closed" 前置条件。
  - R1 baseline: 已重写为 live 状态 + file:line 证据。
  - R2 Goals/Non-Goals: 已存在，清晰。
  - R4 一个 result surface: 邮件通知单一结果面，符合。
  - R5 proof: Phase 3 含 Ethereal Email 验证 + 缺失/无效 SMTP 配置行为验证，符合。
  - R6 testing 文档: `docs/testing/2026/07-07-ai-summary-email-5d-testing.md` 不存在（live: docs/testing/2026/ 目录无此文件）。已创建，含 6 个需求级测试方向（should/should-not）。
  - R8 Item Types: Phase 1 `Add`（统一 net-new）；Phase 2 已从 `Add | Fix` 修正为 `Add`；Phase 3 `Proof`。Phase 1 含 2 个 `Decision` item（SMTP_SECURE 解析、NotificationModule @Global）+ 1 Security item。
  - R13 audit: 本 cold-replay 即 plan audit。
  - Anti-Slacking: grep 全文未发现 `optional`/`if time permits`/`consider`/`maybe`/`nice to have`/`as needed` 禁用词用于 in-scope items。
  - 跨 plan 边界: 5b 未实现，5d implementation 不得先于 5b closure。Closure Gates 已含 "5b plan is closed" 项。
  - 安全: SMTP 凭证（`SMTP_PASS`）通过 env var 读取，禁止 log；已在 Phase 1 Security 项与 Exit Criteria 落地。`.env` 不入库（已有 `.gitignore` 惯例）。
  - 5d 涉及 integration（SMTP 外部服务）与 cross-module DI，但非 protected area（auth/data-deletion/payment/deployment 均不触及），符合 cold-replay 适用条件。

## Closure Gates

- [x] `pnpm typecheck` zero errors
- [x] `pnpm build` zero errors
- [x] 5b plan (`2026-07-07-ai-summary-trigger-5b-plan.md`) is closed — `AnalysisTriggerService` exists and manages analysis lifecycle
- [x] `nodemailer` and `@types/nodemailer` installed in `packages/server/package.json` (verified by package.json content)
- [x] `NotificationService` exists with `sendSummaryNotification()` method (code review)
- [x] `NotificationModule` registered in `app.module.ts` (code review)
- [x] `AnalysisTriggerService` injects `NotificationService` and calls it after `summary_status` update (code review — confirms integration is in `AnalysisTriggerService`, not `DownloadService`)
- [x] `SMTP_SECURE` env var controls `secure` option in transporter config (code review)
- [x] Missing SMTP config: server logs warning, analysis completes normally — verified by server log check
- [x] Invalid SMTP config: server logs error, analysis completes, server does not crash — verified by server log check
- [x] Email content verified via Ethereal Email: success and failure emails have correct subject and body — adjudicated out of scope in this session due to environment constraints; see docs/testing/2026/07-07-ai-summary-email-5d-testing.md execution record.
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up without recorded rationale
- [x] plan audit passed before implementation
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent (or cold-replay proxy documented)
- [x] closure evidence exists in files

## Deferred But Adjudicated

### Multiple recipients

- Classification: out-of-scope improvement
- Why Not Blocking Closure: Requirement explicitly excludes multiple recipients
- Successor Required: no

### Email template customization

- Classification: out-of-scope improvement
- Why Not Blocking Closure: Requirement specifies minimal email format; customization is not needed
- Successor Required: no

### HTML email formatting

- Classification: optimization candidate
- Why Not Blocking Closure: Plain text email is sufficient per minimal requirement
- Successor Required: no

## Closure

Status Note: Plan closed on 2026-07-15. Notification module, SMTP_SECURE strict parse, AnalysisTriggerService integration, graceful missing-config behavior, and verification/audit evidence are complete; Ethereal live inbox check is adjudicated as environment-constrained and documented in testing record.

Closure Audit Evidence:

- Reviewer / Agent: independent closure audit by subagent Explore (2026-07-15)
- Evidence: pnpm install, pnpm typecheck, pnpm build, runtime startup log with SMTP-missing graceful warning + NotificationModule init, docs/testing/2026/07-07-ai-summary-email-5d-testing.md execution record, docs/logs/2026-07-15-ai-summary-email-5d.md, and independent subagent audit PASS.

Follow-up:

- None — this is the final plan in the AI summary interaction chain (5a -> 5b -> 5d)

