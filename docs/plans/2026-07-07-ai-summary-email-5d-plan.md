# AI Summary Email Notification (5d) Plan

> Plan Status: planned
> Last Reviewed: 2026-07-11
> Source: `docs/requirements/2026-07-07-ai-summary-interaction-5d.md`
> Related: `docs/plans/2026-07-07-ai-summary-trigger-5b-plan.md` (dependency)
> Audit: required
> Testing: `docs/testing/2026/07-07-ai-summary-email-5d-testing.md`

## Current Baseline

- `packages/server/src/app.module.ts`: imports `ConfigModule` (global, reads `.env`), `DatabaseModule`, `DownloadModule`, `AnalysisModule` — no notification module
- No email/SMTP integration exists anywhere in the codebase
- No `notification` directory exists in `packages/server/src/`
- `ConfigModule.forRoot()` is already global with `envFilePath: ["packages/server/.env", ".env"]`
- NestJS dependency injection is established pattern throughout the server package
- `packages/server/package.json` dependencies do NOT include `nodemailer` or `@types/nodemailer`
- After 5b plan: `AnalysisTriggerService` (in analysis module) manages analysis lifecycle independently from download pipeline; updates `summary_status`/`summary_output`; `DownloadService.executeTask()` remains unchanged regarding analysis — it only handles download completion, analysis trigger is done via `onTaskFinished` callback to `AnalysisTriggerService.trigger()` as fire-and-forget

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

Status: planned
Targets: `packages/server/src/notification/notification.service.ts`, `packages/server/src/notification/notification.module.ts`, `packages/server/package.json`

- Item Types: Add
- Prereqs: 5b completed

- [ ] Add `nodemailer` and `@types/nodemailer` to `packages/server/package.json` dependencies/devDependencies, run `pnpm install`
- [ ] Create `notification.service.ts`: `@Injectable()` class with `sendSummaryNotification(params: { title, videoUrl, markdownPath, success, errorMessage? })` method
- [ ] Read SMTP config from env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `NOTIFICATION_EMAIL`) in constructor
- [ ] If any required SMTP env var is missing, log warning and skip (do not throw)
- [ ] Create nodemailer transporter with `secure` option from `SMTP_SECURE` env var (boolean)
- [ ] Construct email subject and body per requirement spec
- [ ] For bilibili videos: `videoUrl` from `metadata.videoUrl`; for local videos: use video title only, no link
- [ ] Create `notification.module.ts`: register `NotificationService` as provider, export it

Exit Criteria:

- [ ] `nodemailer` and `@types/nodemailer` installed in `packages/server/package.json` (verified by `cat packages/server/package.json | grep nodemailer`)
- [ ] `NotificationService` exists with `sendSummaryNotification()` method (code review)
- [ ] Missing SMTP config skips notification gracefully (code review — constructor checks env vars, logs warning if missing)
- [ ] `SMTP_SECURE` env var controls `secure` option in transporter config (code review)
- [ ] Success and failure email formats match spec (code review)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

### Phase 2 - Register module and integrate with AnalysisTriggerService

Status: planned
Targets: `packages/server/src/app.module.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`, `packages/server/src/analysis/analysis.module.ts`

- Item Types: Add | Fix
- Prereqs: Phase 1, 5b completed

- [ ] Import `NotificationModule` in `app.module.ts`
- [ ] Import `NotificationModule` in `analysis.module.ts` (or make `NotificationService` globally available)
- [ ] Inject `NotificationService` into `AnalysisTriggerService`
- [ ] After analysis success in `AnalysisTriggerService.trigger()` (step 9: `summary_status = 'completed'`): call `sendSummaryNotification({ title: task.title, videoUrl: metadata.videoUrl, markdownPath: summary_output, success: true })`
- [ ] After analysis failure in `AnalysisTriggerService.trigger()` (step 10: `summary_status = 'failed'`): call `sendSummaryNotification({ title: task.title, videoUrl: metadata.videoUrl, success: false, errorMessage })`
- [ ] Notification data sources: `title` from task record, `videoUrl` from `AnalysisInput.metadata.videoUrl`, `markdownPath` from `task.summary_output`, `errorMessage` from caught error
- [ ] Notification failure does not block or crash the analysis flow (try/catch, log error)

Exit Criteria:

- [ ] `NotificationModule` registered in app module (code review)
- [ ] `AnalysisTriggerService` injects `NotificationService` (code review)
- [ ] Notification called after `summary_status = 'completed'` and `summary_status = 'failed'` (code review — confirms call location is in `AnalysisTriggerService.trigger()`, not in `DownloadService.executeTask()`)
- [ ] Notification failure does not propagate (code review — try/catch with logger.error)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

### Phase 3 - Verification

Status: planned

- Item Types: Proof
- Prereqs: Phase 2

Note: Email content verification requires either real SMTP infrastructure or Ethereal Email test service. The following verification items are marked as requiring human intervention.

- [ ] Create/update `docs/testing/2026/07-07-ai-summary-email-5d-testing.md` with requirement-level testing directions
- [ ] Run `pnpm typecheck` -- zero errors
- [ ] Run `pnpm build` -- zero errors
- [ ] Verify missing SMTP config graceful skip: start server WITHOUT any SMTP env vars, trigger analysis, confirm server logs warning "SMTP config missing, skipping notification" and analysis completes normally — verified by checking server logs
- [ ] Verify notification error does not crash: start server with INVALID SMTP config (e.g., `SMTP_HOST=localhost`, `SMTP_PORT=1`), trigger analysis, confirm analysis completes normally and server logs notification error but does not crash — verified by checking server logs
- [ ] Verify email content via Ethereal Email: configure `SMTP_HOST` etc. with Ethereal test account credentials (obtained via nodemailer `createTestAccount()`), trigger analysis, confirm email is viewable at Ethereal URL with correct subject and body — requires human to open Ethereal URL and check content
- [ ] Verify success email content: title `AI 总结完成：{视频标题}`, body includes video title + B-station link + Markdown file path — verified via Ethereal Email
- [ ] Verify failure email content: title `AI 总结失败：{视频标题}`, body includes video title + B-station link + error message — verified via Ethereal Email (trigger by analyzing a non-existent video file)

Exit Criteria:

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] Missing SMTP config: server logs warning, analysis completes normally (server log check)
- [ ] Invalid SMTP config: server logs notification error, analysis completes normally, server does not crash (server log check)
- [ ] Email content verified via Ethereal Email: success email has correct title/link/markdown path, failure email has correct title/link/error message (human check of Ethereal URL)
- [ ] Testing document covers: success email content, failure email content, SMTP config from env vars, missing config graceful skip, notification error does not block, SMTP_SECURE for SSL/TLS mode

## Plan Audit

- Status: pending
- Reviewer / Agent: TBD (independent subagent or reviewer)
- Evidence: TBD

## Closure Gates

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] 5b plan (`2026-07-07-ai-summary-trigger-5b-plan.md`) is closed — `AnalysisTriggerService` exists and manages analysis lifecycle
- [ ] `nodemailer` and `@types/nodemailer` installed in `packages/server/package.json` (verified by package.json content)
- [ ] `NotificationService` exists with `sendSummaryNotification()` method (code review)
- [ ] `NotificationModule` registered in `app.module.ts` (code review)
- [ ] `AnalysisTriggerService` injects `NotificationService` and calls it after `summary_status` update (code review — confirms integration is in `AnalysisTriggerService`, not `DownloadService`)
- [ ] `SMTP_SECURE` env var controls `secure` option in transporter config (code review)
- [ ] Missing SMTP config: server logs warning, analysis completes normally — verified by server log check
- [ ] Invalid SMTP config: server logs error, analysis completes, server does not crash — verified by server log check
- [ ] Email content verified via Ethereal Email: success and failure emails have correct subject and body — verified by human check of Ethereal URL
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred/follow-up without recorded rationale
- [ ] plan audit passed before implementation
- [ ] text consistency verified: status, phases, gates, testing document, and log all agree
- [ ] closure audit was independent (or cold-replay proxy documented)
- [ ] closure evidence exists in files

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

Status Note: Plan not yet started. Closure requires notification module with nodemailer, SMTP_SECURE support, integration with AnalysisTriggerService (not DownloadService), graceful missing-config handling, and Ethereal Email content verification.

Closure Audit Evidence:

- Reviewer / Agent: TBD
- Evidence: TBD

Follow-up:

- None — this is the final plan in the AI summary interaction chain (5a -> 5b -> 5d)
