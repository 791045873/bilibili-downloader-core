# Document Structure Optimization Plan

> Plan Status: planned
> Last Reviewed: 2026-07-12
> Source: `docs/requirements/2026-07-07-document-structure-optimization.md`
> Related: `docs/plans/2026-07-07-analysis-formal-api-plan.md` (AnalysisInput 权威定义, completed)
> Audit: required
> Testing: `docs/testing/2026/07-07-document-structure-optimization-testing.md`

## Current Baseline

- `packages/server/src/analysis/document-generator.ts` exports `DocumentInput` with fields `videoTitle`, `summary`, `segments` (each segment has `topic`, `subtitleText`, `selectedImages` with `relativePath` + `reason`), and `emptySummary` boolean
- `generateMarkdown()` produces: H1 title -> `## 内容总结` -> `## 重点内容` -> per-segment H3 with images and subtitle text quotes
- Empty content outputs `# {title}\n\n[该视频无重点内容可总结]\n`
- No front matter in generated documents
- `packages/server/src/analysis/analysis-engine.ts` defines `AnalysisInput` with `videoPath`, `subtitlePath?` (optional, formal-api landed), `summaryDir`, `videoTitle`, `metadata: { type: "bilibili" | "local"; videoUrl?; bvid?; cid? }`, `screenshotVideoPath?` -- formal-api plan (completed) already added `metadata` and `screenshotVideoPath?`
- `SubtitleAnalysis` interface has `summary: Array<{ title, content, timestamp }>` -- no `frameDescription`
- `buildAnalysisSystemPrompt()` instructs LLM to return `{title, content, timestamp}` -- no `frameDescription`
- Segment construction maps `item.title` -> `topic`, `item.content` -> `subtitleText`, `item.title` -> `reason` for images
- `AnalysisEngine` constructor receives `llmConfig: LlmConfig` but does not retain it for model name injection (only stores `QwenClient`)
- `LlmConfig` (in `packages/adapters/src/llm/qwen-client.ts`) includes `modelName: string` and `visionModelName?: string` -- both available for front matter `model` field
- `analysis.controller.ts` exposes `POST /api/analysis/run` (formal API, formal-api plan completed) with `AnalysisRequest` body, input validation, `metadata` construction -- debug endpoint removed; controller does not reference `DocumentInput` or `generateMarkdown()`

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
- Do not change the formal API endpoint or request/response contract (formal-api plan completed)
- No frontend interaction changes

## Infrastructure And Config Prereqs

- No infra prereqs beyond existing baseline
- `QWEN_API_KEY`, `QWEN_API_BASE`, `QWEN_MODEL` env vars already used by formal API controller's `getLlmConfig()`
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
- [ ] `AnalysisInput` is defined by formal-api plan (completed); `metadata` already exists. This plan references `metadata.type` and `metadata.videoUrl` for front matter `video_url` derivation only — no `AnalysisInput` changes needed.

Exit Criteria:

- [ ] `AnalysisEngine.analyze()` produces documents with front matter containing `title`, `video_url`, `model`, `created_at`
- [ ] Segments use new field names matching LLM return structure
- [ ] `frameDescription` appears as image caption in generated Markdown
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

### Phase 3 - Verification

Status: planned

- Item Types: `Proof`
- Prereqs: Phase 2

- [ ] Confirm `docs/testing/2026/07-07-document-structure-optimization-testing.md` covers all requirement-level testing directions (created during plan audit)
- [ ] Run `pnpm typecheck` -- zero errors
- [ ] Run `pnpm build` -- zero errors
- [ ] Manually verify generated Markdown structure matches target format

Exit Criteria:

- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm build` zero errors
- [ ] Testing document covers: front matter fields present, body is flat segments, empty content has front matter + H1 only

## Plan Audit

- Status: passed (cold-replay proxy, reviewer availability = none)
- Reviewer / Agent: 独立 subagent cold-replay
- Evidence:
  - Baseline 验证: 逐条核对 live 代码。`document-generator.ts:7-25` 确认 DocumentInput 字段（videoTitle/summary/segments/emptySummary），无 front matter（line 30-33 直接 `# title`）。`analysis-engine.ts:32-54` 确认 AnalysisInput 已含 `metadata`/`screenshotVideoPath?`/`subtitlePath?`（formal-api 已 done）。`analysis-engine.ts:68-74` 确认 SubtitleAnalysis 无 frameDescription。`analysis-engine.ts:93-99` 确认构造函数不保留 llmConfig。`qwen-client.ts:8-14` 确认 LlmConfig 含 modelName/visionModelName。`analysis.controller.ts:1-103` 确认 formal API 已落地，无 debug 端点。
  - 发现并修订的问题:
    1. [blocker] Baseline line 16 声称 AnalysisInput 无 metadata/screenshotVideoPath 且 subtitlePath 必填 — 与 live 代码矛盾（formal-api 已 done）。已修订为准确描述。
    2. [blocker] Baseline line 21 声称 controller 有 debug 端点 — 与 live 代码矛盾。已修订为 formal API 描述。
    3. [blocker] Testing 文档不存在（R6 违规）。已创建 `docs/testing/2026/07-07-document-structure-optimization-testing.md`，含 7 个需求级测试方向（should/should-not）。
    4. [major] Phase 3 整体关于更新 debug API — debug API 已不存在，controller 不引用 DocumentInput，无需改动。已删除 Phase 3，原 Phase 4 重编号为 Phase 3，prereqs 改为 Phase 2。
    5. [major] Non-Goals line 37 引用 "debug API trigger method (formal API is a separate plan)" — formal-api 已 done。已修订。
    6. [major] Infrastructure line 43 引用 "debug controller" — 已修订为 formal API controller。
    7. [major] Phase 2 line 81 声称 "Coordinate with formal API plan" — formal-api 已 done，metadata 已存在。已修订。
    8. [major] Deferred But Adjudicated "AnalysisInput metadata full definition" 声称 successor required: yes (formal API plan) — formal-api 已 done。已修订。
    9. [minor] Follow-up line 引用 "Coordinate with formal API plan" — 已修订。
  - AC 覆盖: 需求 8 条 AC 全部被 plan exit criteria 覆盖（AC1→Phase 2 exit line 86; AC2→Phase 1 line 57; AC3→Phase 1 line 57; AC4→Phase 2 lines 75-76, exit line 88; AC5→Phase 1 line 56; AC6→Phase 1 line 58; AC7→Phase 2 line 79; AC8→Phase 1/2/3 exit criteria）。
  - Anti-Slacking: 未发现 optional/if time permits/consider/maybe/nice to have/as needed 禁用词。
  - doc-opt 非 protected area（auth/data-deletion/payment/deployment 均不触及），符合 cold-replay 适用条件。

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

- Classification: resolved (was out-of-scope improvement)
- Why Not Blocking Closure: The authoritative `AnalysisInput` with `metadata` was owned by `2026-07-07-analysis-formal-api-plan.md` (completed). `metadata` already exists in `AnalysisInput` with `type`/`videoUrl?`/`bvid?`/`cid?`. This plan references `metadata.type` and `metadata.videoUrl` for front matter `video_url` derivation — no `AnalysisInput` changes needed.
- Successor Required: no (formal API plan completed)

## Closure

Status Note: Plan not yet started. Closure will require front matter generation, flat segment structure, field name alignment, and model name injection all verified.

Closure Audit Evidence:

- Reviewer / Agent: TBD
- Evidence: TBD

Follow-up:

- None. formal-api plan (completed) already defines `AnalysisInput` with `metadata`; no cross-plan coordination needed.
