# Server Observability Logging Plan

> Plan Status: planned
> Last Reviewed: 2026-08-01
> Source: 2026-08-01 direct user request + `docs/design/app-overview.md` + `docs/context/codebase-map.md`
> Related: `docs/plans/2026-08-01-adapter-error-boundary-and-diagnostic-logging-plan.md`
> Audit: required
> Testing: `docs/testing/2026/08-01-server-observability-logging-testing.md`

## Current Baseline

- `packages/server/src/main.ts` still relies on `console.log` and `console.error` for startup and fatal-boot messages.
- `packages/server/src/app.module.ts` currently imports `DatabaseModule`, `DownloadModule`, `AnalysisModule`, `ParseModule`, and `NotificationModule`, but does not register a global request-logging interceptor in source.
- `packages/server/dist/app.module.js` and `packages/server/dist/logging/` show a historical logging implementation (`RequestLoggingInterceptor` plus request-safe formatting utilities), but `packages/server/src/logging/` is currently empty. Source and build output are therefore drifted.
- Current controller surface spans 23 HTTP endpoints across `packages/server/src/download/download.controller.ts`, `packages/server/src/analysis/analysis.controller.ts`, `packages/server/src/parse/parse.controller.ts`, `packages/server/src/auth/auth.controller.ts`, and `packages/server/src/video/video.controller.ts`.
- `packages/server/src/auth/auth.controller.ts` belongs to the current protected `auth/permissions` area policy. Under `docs/context/ai-autonomy-policy.md`, implementation work in that slice cannot proceed under reviewer availability `none` without the required protected-area review path. This plan must therefore keep auth routes inventoried but out of implementation scope.
- Existing logs are scattered and incomplete. `packages/server/src/download/download.service.ts`, `packages/server/src/download/download-scheduler.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`, `packages/server/src/database/database.service.ts`, and `packages/server/src/notification/notification.service.ts` use `Logger` selectively, while `packages/server/src/analysis/analysis-engine.ts` still uses `console.error` for LLM and screenshot failures.
- The most failure-prone orchestration paths are download scheduling and execution (`packages/server/src/download/download-scheduler.ts`, `packages/server/src/download/download.service.ts`), analysis triggering and fallback (`packages/server/src/analysis/analysis-trigger.service.ts`, `packages/server/src/analysis/screenshot-source-resolver.ts`), and analysis execution (`packages/server/src/analysis/analysis-engine.ts`).
- No request ID or cross-layer trace propagation exists today. The most reliable correlation keys already present in the domain are `taskId`, `analysisSubTaskId`, `bvid`, `cid`, `status`, and quality-related fields.
- No automated server test suite exists. Verification must rely on typecheck/build plus a route-coverage matrix and manual flow replay.
- Durable proof for route coverage will live in `docs/testing/2026/08-01-server-observability-route-matrix.md`; that matrix inventories all 23 endpoints and marks the auth slice as protected and blocked outside this plan's executable scope.

## Goals

- Restore a source-controlled server logging foundation for safe, structured request and orchestration logs.
- Ensure every non-protected server endpoint has at least request-start, request-success, and request-failure coverage in this plan, while still inventorying the auth endpoints as blocked protected work.
- Ensure complex download and analysis orchestration paths log key branch decisions, external-call boundaries, state transitions, and failure reasons.
- Remove remaining `console`-based server diagnostics in favor of a consistent Logger-based approach.
- Keep the adapter/server boundary intact: server owns high-semantic logs; adapters only contribute exceptions or limited hidden-failure diagnostics.

## Non-Goals

- Do not introduce a third-party logging stack such as pino or winston.
- Do not add file sinks in the first version; standard output is sufficient.
- Do not add request ID or `AsyncLocalStorage` propagation in the first version.
- Do not build a new automated integration test harness.
- Do not move high-level orchestration logs down into `packages/adapters/`.
- Do not implement auth-controller logging changes inside this plan while the protected-area policy remains blocked under reviewer availability `none`.

## Infrastructure And Config Prereqs

- No new infrastructure prereqs beyond the existing server baseline.
- Manual verification for analysis-related routes still depends on the current environment variables for Bilibili access and Qwen analysis flows when those routes are replayed.
- The server logging helper must remain compatible with current NestJS startup and build commands.

## Execution Plan

### Phase 1 - Logging Foundation And Coverage Matrix

Status: planned
Targets: `packages/server/src/logging/`, `packages/server/src/app.module.ts`, `packages/server/src/main.ts`, `docs/context/codebase-map.md`, `docs/testing/2026/08-01-server-observability-route-matrix.md`

- Item Types: `Add | Fix | Decision | Proof`
- Prereqs: none

- [ ] Recreate source-controlled logging utilities under `packages/server/src/logging/`, using the historical dist behavior only as a reference and not as an executable source of truth.
- [ ] Register a global request-logging interceptor in `packages/server/src/app.module.ts` so every HTTP route gains consistent start, success, and failure logging.
- [ ] Replace remaining startup and fatal `console` usage in `packages/server/src/main.ts` with Logger-based equivalents.
- [ ] Decision: keep first-version output on standard output only, use Nest Logger plus server-local formatting helpers, and keep correlation based on existing domain identifiers instead of request IDs.
- [ ] Create and maintain `docs/testing/2026/08-01-server-observability-route-matrix.md` as the durable 23-route coverage matrix, with each endpoint assigned a controller owner, verification status, and evidence slot; auth endpoints must be explicitly marked protected and blocked outside this plan's executable scope.
- [ ] Proof: ensure the linked testing document exists before implementation and includes route-level and orchestration-level observable states.

Exit Criteria:

- [ ] source-controlled logging foundation exists and is wired globally in server source
- [ ] route coverage matrix exists and enumerates all in-scope endpoints
- [ ] `docs/context/codebase-map.md` updated if the new logging entry point becomes part of normal server routing work
- [ ] `docs/logs/` updated

### Phase 2 - Download, Task, And Database Observability

Status: planned
Targets: `packages/server/src/download/download.controller.ts`, `packages/server/src/download/download-scheduler.ts`, `packages/server/src/download/download.service.ts`, `packages/server/src/database/database.service.ts`

- Item Types: `Fix | Proof`
- Prereqs: Phase 1

- [ ] Add controller-level branch logs only where global request logging is insufficient, such as invalid task identifiers, task-not-found branches, or bulk-check edge cases.
- [ ] Instrument scheduling, queue entry, queue skip, concurrency-slot usage, low-res queue handling, and task-completion callbacks in `download-scheduler.ts`.
- [ ] Instrument download task creation, guard failures, stream resolution, output-path decisions, execution start and finish, and final status write-back in `download.service.ts`.
- [ ] Instrument task and analysis-sub-task state transitions in `database.service.ts` with sampling or summarized logging so high-frequency progress persistence does not flood output.
- [ ] Proof: verify the testing document covers create, stop, resume, delete, clear, check, normal execute, low-res execute, and failure paths.

Exit Criteria:

- [ ] download and task flows expose enough logs to locate the failing stage without opening lower layers
- [ ] progress-related logging remains sampled or summarized instead of per-write noisy output
- [ ] No owner-doc update required beyond Phase 1 unless the route matrix changes scope materially
- [ ] `docs/logs/` updated

### Phase 3 - Analysis And Fallback Observability

Status: planned
Targets: `packages/server/src/analysis/analysis.controller.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`, `packages/server/src/analysis/analysis-engine.ts`, `packages/server/src/analysis/screenshot-source-resolver.ts`, `packages/server/src/notification/notification.service.ts`

- Item Types: `Fix | Proof`
- Prereqs: Phase 1

- [ ] Instrument analysis trigger entry, skip conditions, summary-status transitions, low-res scheduling decisions, reuse-versus-download decisions, and temporary-file cleanup results.
- [ ] Replace `console.error` usage inside `analysis-engine.ts` with structured Logger output while preserving current behavior for empty-summary and per-segment fallback handling.
- [ ] Log screenshot-source resolution decisions at the server orchestration layer, including remote attempt, DB fallback, re-download fallback, and timeout or terminal failure reason.
- [ ] Add success/failure notification logs that preserve safe context but do not leak SMTP secrets or full payload bodies.
- [ ] Proof: verify the testing document covers auto-summary guard branches, low-res wait and fail branches, remote-to-local fallback, LLM failure handling, and notification failure handling.

Exit Criteria:

- [ ] analysis flows expose skip reasons, fallback decisions, and failure stages with enough context to diagnose orchestration issues
- [ ] no remaining `console` diagnostics stay in the in-scope analysis files
- [ ] No owner-doc update required beyond Phase 1 unless architecture docs need a new stable cross-cutting rule
- [ ] `docs/logs/` updated

### Phase 4 - Parse, Video, And Remaining Route Coverage

Status: planned
Targets: `packages/server/src/parse/parse.controller.ts`, `packages/server/src/parse/parse.service.ts`, `packages/server/src/video/video.controller.ts`, `docs/testing/2026/08-01-server-observability-route-matrix.md`

- Item Types: `Fix | Proof`
- Prereqs: Phase 1

- [ ] Ensure parse and video endpoints inherit the global request logs and add only the missing branch-specific diagnostics for pagination validation, upstream-error mapping, proxy failures, and single versus bulk parse behavior.
- [ ] Keep controller logging minimal where the global interceptor already covers the happy path, reserving local logs for branch decisions or response-shaping that would otherwise be invisible.
- [ ] Verify every non-protected route in these controllers is checked off in the coverage matrix.
- [ ] Record the auth-controller routes in the coverage matrix as protected and blocked under current policy, with successor ownership required before they can be implemented.
- [ ] Proof: align the testing document with both successful and invalid-input paths for these lighter endpoints.

Exit Criteria:

- [ ] all remaining lightweight routes are explicitly covered in the route matrix and emit at least minimal request-level observability
- [ ] local branch logs exist only where they add diagnostic value beyond the interceptor
- [ ] `docs/logs/` updated

### Phase 5 - Verification And Closure Evidence

Status: planned
Targets: `packages/server/`, `docs/testing/2026/08-01-server-observability-logging-testing.md`, `docs/logs/`

- Item Types: `Proof`
- Prereqs: Phase 2, Phase 3, Phase 4

- [ ] Run `pnpm --filter @bilibili-downloader/server typecheck`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm build`.
- [ ] Replay all 20 non-protected HTTP endpoints through the route-coverage matrix, covering at least success and invalid-input paths for every route and branch-specific paths for the complex orchestration routes.
- [ ] Confirm the remaining 3 auth endpoints stay explicitly marked `blocked under protected-area policy` in the route matrix and are not silently treated as complete.
- [ ] Update the testing document with real evidence for request coverage, download observability, analysis observability, sensitive-data review, and console-drift removal.

Exit Criteria:

- [ ] verification commands pass or any failure is explicitly adjudicated in files
- [ ] all route-matrix entries are checked with evidence or explicit scope adjudication
- [ ] testing document directions are updated with real evidence
- [ ] closure evidence exists in files

## Plan Audit

- Status: passed
- Reviewer / Agent: cold-replay proxy
- Evidence: current revision resolves the prior blockers. Auth-controller implementation has been removed from executable scope and remains explicitly blocked in the route matrix, the 23-route matrix now provides durable file-backed coverage evidence, the linked testing document covers request-level and orchestration-level observable states, and the verification and closure strategy is explicit and file-backed.

## Closure Gates

- [ ] in-scope behavior is complete
- [ ] relevant docs are aligned
- [ ] verification has run (`pnpm --filter @bilibili-downloader/server typecheck`, `pnpm typecheck`, `pnpm build`)
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred or follow-up
- [ ] plan audit passed before implementation
- [ ] text consistency verified: status, phases, gates, testing document, and log all agree
- [ ] closure audit was independent or cold-replay proxy documented
- [ ] closure evidence exists in files

## Deferred But Adjudicated

### RequestId And Cross-Layer Trace Context

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: the first logging slice can correlate server work using `taskId`, `analysisSubTaskId`, `bvid`, and `cid`; adding request context propagation would enlarge scope and change runtime design.
- Successor Required: `no`

### Auth-Controller Logging Slice

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: auth routes are inventoried in the route matrix but cannot be implemented inside this plan under the current protected-area policy and reviewer limitation.
- Successor Required: `yes`

### File Sink Or Third-Party Logging Stack

- Classification: `optimization candidate`
- Why Not Blocking Closure: standard output is sufficient for the current development-debugging problem; transport expansion can be revisited after the structured logs land.
- Successor Required: `no`

## Closure

Status Note: pending implementation

Closure Audit Evidence:

- Reviewer / Agent: pending
- Evidence: to be recorded at closure

Follow-up:

- Revisit request-scoped correlation or transport expansion only after first-version server observability proves insufficient.