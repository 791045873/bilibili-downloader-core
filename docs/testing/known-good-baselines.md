# Known-Good Baselines

## Purpose

Record the latest verified project state so future AI sessions can tell whether a failure is new or pre-existing.

This file is lightweight. Record only meaningful baselines, not every local command run.

## Baselines

| Date       | Source | Git State  | Scope | Commands Passed           | Known Failures                | Evidence                    | Notes                                |
| ---------- | ------ | ---------- | ----- | ------------------------- | ----------------------------- | --------------------------- | ------------------------------------ |
| 2026-06-02 | local  | `212ab9f`  | partial | `pnpm install`, `pnpm typecheck` | `none`（无测试框架，无 lint）    | 见 `docs/logs/2026/06-02.md` | AGE 文档体系改造后首次基线            |

## When To Update

Update this file when:

- full typecheck/build/lint/test verification passes after a meaningful change
- a previously failing command becomes green and should be remembered
- a team intentionally accepts a known failing command and records it as a known failure, not as a passed command

## Rule

Do not mark a command as passed unless it actually ran in the current repository state.

`Commands Passed` must contain only passing commands. Put accepted failures in `Known Failures` with the reason and evidence.

A dirty working-tree baseline must name the changed files in `Notes` or link to a dated log/testing note that does.

`full` means all real verification commands configured in `docs/context/project-context.md`. Commands explicitly marked `none` are excluded and should be noted.