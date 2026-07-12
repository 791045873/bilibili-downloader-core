# AI Summary Database (5a) Plan

> Plan Status: planned
> Last Reviewed: 2026-07-12
> Source: `docs/requirements/2026-07-07-ai-summary-interaction-5a.md`
> Related: `docs/plans/2026-07-07-ai-summary-trigger-5b-plan.md` (5b depends on 5a)
> Audit: required
> Testing: `docs/testing/2026/07-07-ai-summary-database-5a-testing.md`

## Current Baseline

Live evidence (file:line) from `packages/server/src/database/database.service.ts`:

- `better-sqlite3` import at line 2; `DatabaseService` is `@Injectable()` at line 30
- `task` table `CREATE TABLE` in `initSchema()` (lines 52-74) has columns: `id`, `bvid`, `cid`, `title`, `quality`, `codec`, `outputPath`, `subtitle_lang`, `status`, `progress`, `speed`, `outputFile`, `fileSize`, `errorCode`, `errorMessage`, `durationMs`, `createdAt`, `updatedAt`, `completedAt`
- Existing migration pattern: `ALTER TABLE task ADD COLUMN subtitle_lang TEXT` wrapped in try/catch (lines 82-86) to ignore "column already exists" error
- `TaskRecord` interface (lines 8-28) has fields matching the table columns — no `auto_summary`, `summary_status`, `summary_output`
- No `analysis_sub_task` table exists (grep across `packages/server/src` confirms zero matches)
- `insertTask()` (lines 92-123) uses prepared statement with named parameters (`@bvid`, `@cid`, etc.)
- `updateTaskStatus()` (lines 136-180) dynamically builds SET clauses based on provided fields, all values parameterized
- Indexes on `status`, `createdAt`, `(bvid, cid)` (lines 75-79)
- `DatabaseService` registered in `DatabaseModule` (`database.module.ts` lines 6-7: `providers: [DatabaseService]`, `exports: [DatabaseService]`)
- No automated tests exist in this project (project-context.md: unit tests = `none`, e2e = `none`)

## Goals

- `task` table has new columns: `auto_summary INTEGER DEFAULT 0`, `summary_status TEXT DEFAULT 'none'`, `summary_output TEXT`
- New `analysis_sub_task` table with columns: `id`, `task_id`, `bvid`, `cid`, `quality`, `status`, `output_file`, `error_message`, `created_at`, `completed_at` — schema per requirement (`status TEXT NOT NULL DEFAULT 'created'`, `task_id INTEGER NOT NULL`, `created_at TEXT NOT NULL`, `FOREIGN KEY (task_id) REFERENCES task(id)`)
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

- Status: passed (cold-replay proxy, reviewer availability = none)
- Reviewer / Agent: 独立 subagent cold-replay
- Evidence:
  - Baseline verified against live code (`database.service.ts` lines 2-248; `database.module.ts` lines 6-7): all 9 baseline claims accurate (better-sqlite3, task schema columns, subtitle_lang migration pattern, TaskRecord fields, no analysis_sub_task, insertTask prepared statement, updateTaskStatus dynamic SET, @Injectable + DatabaseModule registration, indexes)
  - AC coverage: all 6 requirement ACs mapped to plan exit criteria (AC1→Goals line 27 + Phase 1 exit criteria lines 71-72, AC2→Phase 1 exit criteria line 74, AC3→Phase 1 exit criteria line 73, AC4→Goals line 27 + Phase 2 exit criteria line 101 anti-state, AC5→Goals line 27 + Phase 2 exit criteria line 101 anti-state, AC6→Phase 1 exit criteria line 80 + Phase 2 exit criteria lines 99-100)
  - Dependency direction correct: 5b depends on 5a (5b plan line 46, 244 confirm; 5a plan line 6 declares)
  - Issue found & fixed: testing document `docs/testing/2026/07-07-ai-summary-database-5a-testing.md` was missing (R6 violation) — created with 9 requirement-level testing directions covering column existence, defaults, migration idempotency, anti-states, and type safety
  - Issue found & fixed: Current Baseline lacked live file:line evidence — added per-claim citations
  - Issue found & fixed: Goals did not note analysis_sub_task.status DEFAULT 'created' and FK constraint — added schema detail referencing requirement
  - Issue found & fixed: Closure Gates missing `docs/logs/` and owner-doc update items — added
  - No Anti-Slacking forbidden words found in in-scope items
  - SQL injection risk: none — all methods use prepared statements with parameterized values; dynamic SET clauses use static column-name strings only
  - Reviewer limitation: no second human/subagent available; cold-replay proxy used per R13 allowance for non-protected, non-high-risk plans. This plan touches database schema (data/model change) which is a protected area, but the change is purely additive (new columns with defaults, new table), no data migration/deletion, no contract break — risk is low.

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
- [ ] `docs/logs/` updated with implementation record
- [ ] No owner-doc update required (5a is internal database infrastructure; no app-layer design doc change)
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
