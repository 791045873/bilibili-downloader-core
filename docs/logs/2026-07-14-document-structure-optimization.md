# 2026-07-14 Document Structure Optimization (Seq 5)

## Summary

Completed Seq 5 document structure optimization for analysis markdown generation.

## Implemented

- Reworked `DocumentInput` in `packages/server/src/analysis/document-generator.ts`:
  - removed legacy fields: `summary`, `emptySummary`, `topic`, `subtitleText`, `selectedImages`, `reason`
  - added front matter fields: `videoUrl`, `modelName`, `createdAt`
  - aligned segment fields with LLM structure: `title`, `content`, `timestamp`, `frameDescription`, `images`
- Rewrote `generateMarkdown()` output structure:
  - adds YAML front matter: `title`, `video_url`, `model`, `created_at`
  - keeps H1 title
  - flattens body into H2 segments
  - each segment renders content, images, and quote-style frame description
  - empty segments produce front matter + H1 only (no placeholder text)
- Updated `packages/server/src/analysis/analysis-engine.ts`:
  - `SubtitleAnalysis.summary` now requires `frameDescription`
  - `buildAnalysisSystemPrompt()` now requests `frameDescription`
  - constructor now stores `llmConfig` for model injection
  - segment mapping updated to new field names
  - markdown generation now passes `videoUrl`, `modelName`, and `createdAt`
  - empty-summary path updated to same front matter behavior
  - summary item normalization now validates non-empty `frameDescription`

## Verification

- `pnpm typecheck` passed
- `pnpm build` passed
- Manual output checks passed:
  - non-empty sample includes front matter + H1 + flat H2 segment + image + quote description
  - empty sample includes front matter + H1 only

## Audit

- Independent closure audit via subagent `Explore` on 2026-07-14: PASS
- No blocking findings; minor note only on markdown image alt text choice.
