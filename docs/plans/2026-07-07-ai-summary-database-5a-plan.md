# AI Summary Database (5a) Plan

> Plan Status: planned
> Last Reviewed: 2026-07-07
> Source: `docs/requirements/2026-07-07-ai-summary-interaction-5a.md`
> Related: `docs/plans/2026-07-07-ai-summary-trigger-5b-plan.md` (5b depends on 5a)
> Audit: required
> Testing: `docs/testing/2026/07-07-ai-summary-database-5a-testing.md`

## Current Baseline

- `packages/server/src/database/database.service.ts` manages SQLite via `better-sqlite3`
- `task` table schema in `initSchema()` has columns: `id`, `bvid`, `cid`, `title`, `quality`, `codec`, `outputPath`, `subtitle_lang`, `status`, `progress`, `speed`, `outputFile`, `fileSize`, `errorCode`, `errorMessage`, `durationMs`, `createdAt`, `updatedAt`, `completedAt`
- Existing migration pattern: `ALTER TABLE task ADD COLUMN subtitle_lang TEXT` wrapped in try/catch to ignore "column already exists" error
- `TaskRecord` interface has fields matching the table columns -- no `auto_summary`, `summary_status`, `summary_output`
- No `analysis_sub_task` table exists
- `insertTask()` uses prepared statement with named parameters
- `updateTaskStatus()` dynamically builds SET clauses based on provided fields
- `DatabaseService` is `@Injectable()` and registered in `DatabaseModule`
- Indexes exist on `status`, `createdAt`, `(bvid, cid)`

## Goals

- `task` table has new columns: `auto_summary INTEGER DEFAULT 0`, `summary_status TEXT DEFAULT 'none'`, `summary_output TEXT`
- New `analysis_sub_task` table with columns: `id`, `task_id`, `bvid`, `cid`, `quality`, `status`, `output_file`, `error_message`, `created_at`, `completed_at`
- Migration is idempotent (existing databases upgrade without error)
- `TaskRecord` interface includes new fields
- `AnalysisSubTaskRecord` TypeScript interface defined for type safety
- `DatabaseService` has methods to update all summary-related fields (`auto_summary`, `summary_status`, `summary_output`) and manage `analysis_sub_task` records

## Non-Goals

- Do not implement analysis trigger logic (5b plan)
- Do not implement email notification (5d plan)
- Do not implement frontend interaction
- Do not implement data backfill for existing tasks (new fields have defaults)

## Infrastructure And Config Prereqs

- SQLite database file at `{OUTPUT_DIR}/tasks.db` (already configured)
- No rollback strategy needed -- `ALTER TABLE ADD COLUMN` and `CREATE TABLE IF NOT EXISTS` are additive and idempotent
- If migration fails, existing database remains functional (try/catch per column)

## Execution Plan

### Phase 1 - Add task table columns and analysis_sub_task table

Status: planned
Targets: `packages/server/src/database/database.service.ts`

- Item Types: Add
- Prereqs: none

- [ ] Add `autoSummary`, `summaryStatus`, `summaryOutput` to `TaskRecord` interface
- [ ] Define `AnalysisSubTaskRecord` TypeScript interface for the `analysis_sub_task` table (fields: `id`, `taskId`, `bvid`, `cid`, `quality`, `status`, `outputFile`, `errorMessage`, `createdAt`, `completedAt`)
- [ ] Add three new columns to `CREATE TABLE IF NOT EXISTS task (...)` statement in `initSchema()` (alongside existing columns, for fresh databases)
- [ ] Add three `ALTER TABLE task ADD COLUMN` statements in `initSchema()`, each wrapped in try/catch (following `subtitle_lang` pattern, for existing databases)
- [ ] Add `CREATE TABLE IF NOT EXISTS analysis_sub_task (...)` statement in `initSchema()`
- [ ] Add index on `analysis_sub_task(task_id)` for efficient lookup
- [ ] Update `insertTask()` prepared statement to include new columns (with defaults)
- [ ] Update `updateTaskStatus()` to handle `autoSummary`, `summary_status`, and `summary_output` fields (add conditional SET clauses following existing `outputFile`/`fileSize` pattern)
- [ ] Add `insertAnalysisSubTask()`, `updateAnalysisSubTaskStatus()`, `getAnalysisSubTasksByTaskId()` methods
- [ ] Decision: `auto_summary` as INTEGER (0/1) following SQLite boolean convention. Alternatives: BOOLEAN type (SQLite has no native boolean -- stored as INTEGER anyway). Residual risk: none.
- [ ] Decision: `updateTaskStatus()` handles `autoSummary` rather than a dedicated method. Alternatives: dedicated `updateAutoSummary(id, enabled)` method (rejected — adds API surface for a single boolean; `updateTaskStatus()` already handles optional fields via conditional SET clauses). Residual risk: callers must pass `autoSummary` as part of the fields object.

Exit Criteria:

- [ ] New columns added to `task` table `CREATE TABLE` statement (for fresh databases)
- [ ] `ALTER TABLE` migration statements exist (for existing databases)
- [ ] Existing database migration completes without error
- [ ] `analysis_sub_task` table created with all defined columns
- [ ] `TaskRecord` interface includes new fields (`autoSummary`, `summaryStatus`, `summaryOutput`)
- [ ] `AnalysisSubTaskRecord` interface defined
- [ ] `insertTask()` handles new columns with defaults
- [ ] `updateTaskStatus()` handles `autoSummary`, `summaryStatus`, `summaryOutput` (code review confirms conditional SET clauses for all three)
- [ ] `analysis_sub_task` CRUD methods exist
- [ ] `pnpm typecheck` passes

### Phase 2 - Verification

Status: planned

- Item Types: Proof
- Prereqs: Phase 1

Note: Database-level verification (column existence, defaults, migration safety) requires human intervention — no automated tests exist in this project. `pnpm typecheck` and `pnpm build` prove compilation only, not schema correctness.

- [ ] Create/update `docs/testing/2026/07-07-ai-summary-database-5a-testing.md` with requirement-level testing directions
- [ ] Run `pnpm typecheck` -- zero errors
- [ ] Run `pnpm build` -- zero errors
- [ ] Manually verify: start server with existing `tasks.db`, confirm migration runs without error, confirm new columns and table exist
- [ ] Manually verify anti-states: existing task data unchanged after migration (existing rows still queryable, existing field values preserved); existing tasks have `auto_summary=0` (not 1); existing tasks have `summary_status='none'` (not 'pending' or 'analyzing')

Exit Criteria:

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] Testing document covers: new columns exist with defaults, analysis_sub_task table exists, existing DB migrates without error, auto_summary defaults to 0, summary_status defaults to none, existing task data unchanged after migration (anti-state), existing tasks not in pending/analyzing state (anti-state)

## Plan Audit

- Status: pending
- Reviewer / Agent: TBD (independent subagent or reviewer)
- Evidence: TBD

## Closure Gates

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] New columns exist in `CREATE TABLE` and `ALTER TABLE` migration (code review)
- [ ] `analysis_sub_task` table created with all defined columns (verified by `PRAGMA table_info(analysis_sub_task)` after server start)
- [ ] Existing database migration completes without error (verified by starting server with existing `tasks.db`)
- [ ] `TaskRecord` interface includes `autoSummary`, `summaryStatus`, `summaryOutput` (code review)
- [ ] `AnalysisSubTaskRecord` interface defined (code review)
- [ ] `insertTask()` handles new columns with defaults (code review)
- [ ] `updateTaskStatus()` handles `autoSummary`, `summaryStatus`, `summaryOutput` — all three have conditional SET clauses (code review)
- [ ] `analysis_sub_task` CRUD methods exist (code review)
- [ ] Existing task data unchanged after migration (manual DB check — anti-state)
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred/follow-up without recorded rationale
- [ ] plan audit passed before implementation
- [ ] text consistency verified: status, phases, gates, testing document, and log all agree
- [ ] closure audit was independent (or cold-replay proxy documented)
- [ ] closure evidence exists in files

## Deferred But Adjudicated

### Data backfill for existing tasks

- Classification: watch-only residual
- Why Not Blocking Closure: New columns have defaults (`auto_summary=0`, `summary_status='none'`); existing tasks are treated as "no auto summary" which is correct behavior
- Successor Required: no

## Closure

Status Note: Plan not yet started. Closure requires task table migration, analysis_sub_task table creation, TaskRecord interface update, and CRUD methods all verified.

Closure Audit Evidence:

- Reviewer / Agent: TBD
- Evidence: TBD

Follow-up:

- 5b plan will use these database fields and the analysis_sub_task table for trigger logic
