# Document Structure Optimization Plan

> Plan Status: planned
> Last Reviewed: 2026-07-07
> Source: `docs/requirements/2026-07-07-document-structure-optimization.md`
> Related: `docs/plans/2026-07-07-analysis-formal-api-plan.md` (AnalysisInput 权威定义)
> Audit: required
> Testing: `docs/testing/2026/07-07-document-structure-optimization-testing.md`

## Current Baseline

- `packages/server/src/analysis/document-generator.ts` exports `DocumentInput` with fields `videoTitle`, `summary`, `segments` (each segment has `topic`, `subtitleText`, `selectedImages` with `relativePath` + `reason`), and `emptySummary` boolean
- `generateMarkdown()` produces: H1 title -> `## 内容总结` -> `## 重点内容` -> per-segment H3 with images and subtitle text quotes
- Empty content outputs `# {title}\n\n[该视频无重点内容可总结]\n`
- No front matter in generated documents
- `packages/server/src/analysis/analysis-engine.ts` defines `AnalysisInput` with `videoPath`, `subtitlePath` (required string), `summaryDir`, `videoTitle` -- no `metadata`, no `screenshotVideoPath`, no `videoUrl`
- `SubtitleAnalysis` interface has `summary: Array<{ title, content, timestamp }>` -- no `frameDescription`
- `buildAnalysisSystemPrompt()` instructs LLM to return `{title, content, timestamp}` -- no `frameDescription`
- Segment construction maps `item.title` -> `topic`, `item.content` -> `subtitleText`, `item.title` -> `reason` for images
- `AnalysisEngine` constructor receives `llmConfig: LlmConfig` but does not retain it for model name injection
- `analysis.controller.ts` has debug-only `POST /api/analysis/debug` with hardcoded `test_assets/video1.mp4` and `test_assets/video1.srt`

## Goals

- Generated Markdown documents contain YAML front matter with `title`, `video_url`, `model`, `created_at`
- Document body is flat segments (H2 each), no `## 内容总结` / `## 重点内容` sections
- Each segment shows: H2 title -> content text -> screenshots -> frame description
- `DocumentInput.segments` uses `title`, `content`, `timestamp`, `frameDescription`, `images` field names matching LLM return structure
- Empty content documents retain front matter + H1, body is empty
- `AnalysisEngine` injects model name from `llmConfig.visionModelName ?? llmConfig.modelName` into front matter

## Non-Goals

- Do not change the analysis orchestration main flow (subtitle parse -> LLM call -> screenshot -> generate doc)
- Do not change the Python thin proxy
- Do not change screenshot logic
- Do not change the debug API trigger method (formal API is a separate plan)
- No frontend interaction changes

## Infrastructure And Config Prereqs

- No infra prereqs beyond existing baseline
- `QWEN_API_KEY`, `QWEN_API_BASE`, `QWEN_MODEL` env vars already used by debug controller
- `QWEN_VISION_MODEL` env var already read in `analysis.controller.ts` for `LlmConfig.visionModelName`

## Execution Plan

### Phase 1 - Rewrite DocumentInput and generateMarkdown()

Status: planned
Targets: `packages/server/src/analysis/document-generator.ts`

- Item Types: `Add | Fix`
- Prereqs: none

- [ ] Rewrite `DocumentInput` interface: replace `summary`, `segments` with new structure containing `videoUrl`, `modelName`, `createdAt`, and `segments: Array<{ title, content, timestamp, frameDescription, images: Array<{ relativePath }> }>`
- [ ] Rewrite `generateMarkdown()`: emit YAML front matter block, H1 title, flat H2 segments with content + images + frame description quotes
- [ ] Empty content path: front matter + H1 only, no `[该视频无重点内容可总结]`
- [ ] Remove `emptySummary` field from `DocumentInput` (empty = segments array is empty)

Exit Criteria:

- [ ] `generateMarkdown()` with non-empty segments produces front matter + H1 + flat H2 segments
- [ ] `generateMarkdown()` with empty segments produces front matter + H1 only
- [ ] `pnpm typecheck` passes (will fail until Phase 2 updates analysis-engine.ts)

### Phase 2 - Update SubtitleAnalysis, buildAnalysisSystemPrompt, and segment construction

Status: planned
Targets: `packages/server/src/analysis/analysis-engine.ts`

- Item Types: `Add | Fix`
- Prereqs: Phase 1

- [ ] Add `frameDescription: string` to `SubtitleAnalysis.summary` item type
- [ ] Update `buildAnalysisSystemPrompt()` to instruct LLM to also return `frameDescription` for each timestamp
- [ ] Retain `llmConfig` reference in `AnalysisEngine` constructor for model name access
- [ ] Update segment construction: map `item.title` -> `title`, `item.content` -> `content`, `item.timestamp` -> `timestamp`, `item.frameDescription` -> `frameDescription`, screenshots -> `images: [{ relativePath }]`
- [ ] Pass `videoUrl` (from `metadata.type === "bilibili" ? metadata.videoUrl : ""`) and `modelName` (`this.llmConfig.visionModelName ?? this.llmConfig.modelName`) and `createdAt` (`new Date().toString()`) into `generateMarkdown()`
- [ ] Update `writeEmptySummary()` to pass front matter fields
- [ ] `AnalysisInput` type change is owned by `2026-07-07-analysis-formal-api-plan.md`; this plan adds `metadata` field reference only for front matter `video_url` derivation. Coordinate with formal API plan for the authoritative `AnalysisInput` definition.

Exit Criteria:

- [ ] `AnalysisEngine.analyze()` produces documents with front matter containing `title`, `video_url`, `model`, `created_at`
- [ ] Segments use new field names matching LLM return structure
- [ ] `frameDescription` appears as image caption in generated Markdown
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

### Phase 3 - Update analysis.controller.ts for type alignment

Status: planned
Targets: `packages/server/src/analysis/analysis.controller.ts`

- Item Types: `Fix`
- Prereqs: Phase 2

- [ ] Update debug API `AnalysisInput` construction to align with new `AnalysisInput` shape (add `metadata: { type: "local" }` placeholder if formal API plan has not landed yet, or follow formal API plan definition)
- [ ] Debug API does not pass `videoUrl`, so front matter `video_url` will be empty string

Exit Criteria:

- [ ] Debug API still works with updated types
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

### Phase 4 - Verification

Status: planned

- Item Types: `Proof`
- Prereqs: Phase 3

- [ ] Create/update `docs/testing/2026/07-07-document-structure-optimization-testing.md` with requirement-level testing directions
- [ ] Run `pnpm typecheck` -- zero errors
- [ ] Run `pnpm build` -- zero errors
- [ ] Manually verify generated Markdown structure matches target format

Exit Criteria:

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] Testing document covers: front matter fields present, body is flat segments, empty content has front matter + H1 only

## Plan Audit

- Status: pending
- Reviewer / Agent: TBD (independent subagent or reviewer)
- Evidence: TBD

## Closure Gates

- [ ] in-scope behavior is complete
- [ ] relevant docs are aligned
- [ ] verification has run (`pnpm typecheck` and `pnpm build`)
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred/follow-up
- [ ] plan audit passed before implementation
- [ ] text consistency verified: status, phases, gates, testing document, and log all agree
- [ ] closure audit was independent (or cold-replay proxy documented)
- [ ] closure evidence exists in files

## Deferred But Adjudicated

### AnalysisInput metadata full definition

- Classification: out-of-scope improvement
- Why Not Blocking Closure: The authoritative `AnalysisInput` with `metadata` is owned by `2026-07-07-analysis-formal-api-plan.md`. This plan only needs `metadata.type` and `metadata.videoUrl` for front matter derivation.
- Successor Required: yes (formal API plan)

## Closure

Status Note: Plan not yet started. Closure will require front matter generation, flat segment structure, field name alignment, and model name injection all verified.

Closure Audit Evidence:

- Reviewer / Agent: TBD
- Evidence: TBD

Follow-up:

- Coordinate with formal API plan to ensure `AnalysisInput` definition is consistent across both plans
