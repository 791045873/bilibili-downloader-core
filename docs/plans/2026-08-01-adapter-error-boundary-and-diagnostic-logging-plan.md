# Adapter Error Boundary And Diagnostic Logging Plan

> Plan Status: completed
> Last Reviewed: 2026-08-02
> Source: `docs/requirements/2026-08-02-adapter-error-boundary-and-diagnostic-logging.md` + `docs/architecture/module-boundaries.md` + `docs/architecture/system-baseline.md`
> Related: `docs/plans/2026-08-01-server-observability-logging-plan.md`
> Audit: required
> Testing: `docs/testing/2026/08-01-adapter-error-boundary-and-diagnostic-logging-testing.md`

## Current Baseline

- `docs/architecture/module-boundaries.md` defines `packages/adapters/` as the concrete implementation layer for Core ports and forbids dependencies on `packages/server/` or NestJS runtime components.
- Propagation-oriented adapters already prefer contextual throws over direct logging: `packages/adapters/src/bilibili/resource-parser.ts` throws `ResourceParseError`; `packages/adapters/src/downloader/http-downloader.ts` retries and throws `DownloadError`; `packages/adapters/src/ffmpeg/ffmpeg-merger.ts` throws `MergeError`; `packages/adapters/src/llm/qwen-client.ts` throws HTTP-context errors.
- Several adapters currently hide failures or degrade silently. Confirmed live examples include `packages/adapters/src/bilibili/subtitle-provider.ts` returning `[]` when PlayerV2 or per-subtitle fetch fails; `packages/adapters/src/bilibili/web-client.ts` swallowing buvid initialization failure and continuing; `packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts` returning `false` or partial output instead of throwing for some screenshot failures; `packages/adapters/src/bilibili-auth/auth-provider.ts` returning `null` when `getUserInfo()` cannot confirm login state; `packages/adapters/src/downloader/aria2-downloader.ts` swallowing cancellation cleanup failure while continuing to surface the main cancellation; `packages/adapters/src/parser/subtitle-srt-parser.ts` skipping malformed subtitle blocks instead of failing the whole parse; `packages/adapters/src/fs/node-file-store.ts` swallowing cleanup or existence-check failures in local file operations; and `packages/adapters/src/cos/tencent-cos-temp-image-store.ts` swallowing cleanup failure for already-uploaded temporary objects when an upload batch aborts.
- `packages/adapters/src/task-store.ts` is the clearest existing example of adapter-local diagnostics. It uses `packages/adapters/src/logger.ts` to log a swallowed load failure and then returns an empty task list.
- `packages/server/src/parse/parse.service.ts`, `packages/server/src/analysis/screenshot-source-resolver.ts`, `packages/server/src/analysis/analysis-trigger.service.ts`, and `packages/server/src/download/download-scheduler.ts` already act as upper-layer decision points that can translate adapter failures into HTTP errors, task-state changes, or business-level warnings.
- No stable repo rule currently states when adapter failures should only be thrown upward versus when adapter-local debug or warn diagnostics are justified. This plan therefore needs to inventory both propagation-oriented families and hidden-failure families before implementation, not just the files already used by server today.
- Automated tests are still absent. Proof must come from package typecheck, repo typecheck/build, and targeted manual verification through existing server flows.

## Goals

- Establish a stable adapter/server boundary for error propagation and diagnostics.
- Keep propagation-oriented adapters free of duplicate error logging while ensuring thrown errors carry safe, actionable context.
- Add only selective low-frequency diagnostics to swallowed or degraded adapter paths that upper layers cannot otherwise observe.
- Prevent adapter errors or diagnostics from leaking cookies, authorization material, raw callback URLs, full response bodies, full subtitle text, or other sensitive payloads.

## Non-Goals

- Do not introduce Nest Logger into `packages/adapters/`.
- Do not create full request-scoped tracing or correlation IDs across packages.
- Do not move server orchestration logs into adapters.
- Do not rewrite every adapter into a custom error-class hierarchy if existing typed errors already satisfy the boundary.
- Do not change public download, parse, or analysis behavior except where diagnostics need to become observable.

## Infrastructure And Config Prereqs

- No new infrastructure prereqs beyond the existing baseline.
- Integration verification for Bilibili adapters still depends on a valid `COOKIE_FILE` when a manual flow touches authenticated endpoints.
- Screenshot-related verification still depends on `ffmpeg` and `ffprobe` being available in `PATH`.

## Execution Plan

### Phase 1 - Boundary Rules And Owner-Doc Alignment

Status: completed
Targets: `docs/architecture/module-boundaries.md`, `docs/architecture/system-baseline.md`

- Item Types: `Decision | Fix | Proof`
- Prereqs: none

- [x] Record the stable rule that adapters default to throwing contextual errors upward and that server remains the owner of high-semantic request, orchestration, and task-state logs.
- [x] Record the exception rule that adapter-local diagnostics are allowed only for swallowed errors, silent degradation, or fallback paths that upper layers cannot otherwise observe.
- [x] Record an adapter-sensitive-data guardrail covering cookies, auth headers, callback URLs, raw upstream response bodies, full subtitle text, and other non-essential payloads.
- [x] Proof: ensure the linked testing document exists before implementation and covers both propagation paths and swallowed-degradation paths at requirement level.

Exit Criteria:

- [x] owner docs explicitly describe the adapter/server logging boundary and sensitive-data rules
- [x] corresponding testing document exists and covers each in-scope behavior change
- [x] `docs/logs/` updated

### Phase 2 - Propagation-Oriented Adapter Normalization

Status: completed
Targets: `packages/adapters/src/bilibili/resource-parser.ts`, `packages/adapters/src/bilibili/stream-provider.ts`, `packages/adapters/src/bilibili/space-provider.ts`, `packages/adapters/src/bilibili/favorites-provider.ts`, `packages/adapters/src/downloader/http-downloader.ts`, `packages/adapters/src/ffmpeg/ffmpeg-merger.ts`, `packages/adapters/src/llm/qwen-client.ts`

- Item Types: `Fix | Decision | Proof`
- Prereqs: Phase 1

- [x] Review propagation-oriented adapters and keep them free of new direct `error` logs when the failure is still meant to bubble to server.
- [x] Normalize thrown errors so they retain safe contextual clues such as operation name, retry exhaustion, summarized target URL, or summarized output path without exposing secrets.
- [x] Preserve existing typed errors where upper layers already rely on them, and only widen or reword errors when it improves upper-layer diagnosis without changing contract intent.
- [x] Decision: adjudicate any propagation adapter that appears to need local diagnostics and record why upper-layer logs are or are not sufficient.
- [x] Proof: run adapter and repo typecheck after the slice, then confirm the testing document still maps cleanly to the updated behavior.

Exit Criteria:

- [x] propagation-oriented adapters surface failures through exceptions with safe context and without duplicate error logging
- [x] No owner-doc update required beyond Phase 1
- [x] `docs/logs/` updated

### Phase 3 - Swallowed-Error And Degradation Diagnostics

Status: completed
Targets: `packages/adapters/src/bilibili/subtitle-provider.ts`, `packages/adapters/src/bilibili/web-client.ts`, `packages/adapters/src/bilibili-auth/auth-provider.ts`, `packages/adapters/src/downloader/aria2-downloader.ts`, `packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts`, `packages/adapters/src/parser/subtitle-srt-parser.ts`, `packages/adapters/src/cos/tencent-cos-temp-image-store.ts`, `packages/adapters/src/task-store.ts`, `packages/adapters/src/fs/node-file-store.ts`

- Item Types: `Fix | Decision | Proof`
- Prereqs: Phase 1

- [x] Inventory every in-scope adapter path that swallows an upstream failure, converts failure into an empty result, or falls back without telling upper layers, including bilibili, bilibili-auth, downloader, ffmpeg, parser, cos, fs, and task-store families.
- [x] Add or normalize only low-frequency `debug` or `warn` diagnostics for those hidden-failure paths where upper layers otherwise cannot distinguish healthy-empty from degraded-empty behavior.
- [x] Keep existing fallback behavior unchanged unless the current contract is too ambiguous to support diagnosis, and record any boundary decision explicitly.
- [x] Decision: adjudicate whether `packages/adapters/src/fs/node-file-store.ts` cleanup failures remain silent or gain a low-level diagnostic, with rationale.
- [x] Proof: verify at least one swallowed-error path, one degradation path, and one secret-safety review against the testing document.

Exit Criteria:

- [x] hidden-failure adapter paths emit at most one low-frequency diagnostic when they suppress a failure signal from upper layers
- [x] healthy paths do not gain noisy warning or error output
- [x] `docs/logs/` updated

### Phase 4 - Verification And Closure Evidence

Status: completed
Targets: `packages/adapters/`, `docs/testing/2026/08-01-adapter-error-boundary-and-diagnostic-logging-testing.md`, `docs/logs/`

- Item Types: `Proof`
- Prereqs: Phase 2, Phase 3

- [x] Run `pnpm --filter @bilibili-downloader/adapters typecheck`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.
- [x] Execute targeted manual verification from the testing document for one propagation error path and one swallowed-degradation path, and explicitly record the user-directed proof waiver for the remaining qwen-client sensitive-data probe.
- [x] Update the linked testing document from `pending` with evidence or explicit scope adjudication for every direction.

Exit Criteria:

- [x] verification commands pass or any failure is explicitly adjudicated in files
- [x] testing document directions are updated with real evidence or scope adjudication
- [x] closure evidence exists in files

## Plan Audit

- Status: passed
- Reviewer / Agent: cold-replay proxy
- Evidence: current revision satisfies full-plan audit requirements. The baseline is anchored to live repo behavior, the scope now covers both propagation-oriented adapters and hidden-failure or degradation paths including the COS family, the corresponding testing document exists at requirement-state level, and no protected-area implementation or unresolved source-of-truth conflict remains in scope.

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run (`pnpm --filter @bilibili-downloader/adapters typecheck`, `pnpm typecheck`, `pnpm build`)
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred or follow-up
- [x] plan audit passed before implementation
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent or cold-replay proxy documented
- [x] closure evidence exists in files

## Deferred But Adjudicated

### Shared Cross-Package Logging Stack

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: this plan only sets adapter error-boundary rules and limited diagnostics; a monorepo-wide logging stack would widen scope across runtime layers.
- Successor Required: `no`

### Broad Custom Error-Class Refactor

- Classification: `optimization candidate`
- Why Not Blocking Closure: current typed errors already exist for several critical ports; full hierarchy cleanup is not required to land the boundary rule.
- Successor Required: `no`

## Closure

Status Note: closure ready and landed. All phase exit criteria and verification gates are satisfied with durable evidence in testing and development log files; testing direction #4 is adjudicated as an out-of-scope proof waiver per explicit user instruction, with rationale recorded.

Closure Audit Evidence:

- Reviewer / Agent: cold-replay proxy
- Evidence: cold-replay against the plan guide and audit guide confirms closure gates satisfied; evidence anchored in `docs/testing/2026/08-01-adapter-error-boundary-and-diagnostic-logging-testing.md`, `docs/logs/2026/08-02.md`, `docs/requirements/2026-08-02-adapter-error-boundary-and-diagnostic-logging.md`, `docs/architecture/module-boundaries.md`, and `docs/architecture/system-baseline.md`.

Follow-up:

- Revisit a shared low-level adapter diagnostic helper only if repeated hidden-failure sites make the current lightweight pattern inconsistent.