# Document Naming And Timeliness

## Purpose

This guide distinguishes stable owner docs from time-sensitive process records.

For small and medium projects, this keeps the repo easy to navigate without forcing every file into the same naming style.

## Two Categories

### 1. Stable Owner Docs

These describe the current supported baseline and should usually keep stable names without dates.

Use stable names for:

- `docs/process/`
- `docs/architecture/`
- `docs/design/`
- `docs/references/`
- `docs/skills/`
- long-lived requirement baseline files such as `docs/requirements/product-scope.md` and `docs/requirements/mvp.md`

Examples:

- `docs/design/app-overview.md`
- `docs/architecture/system-baseline.md`
- `docs/process/application-development-workflow.md`

Rule:

- these files should be updated in place
- do not create a new dated version just because the content changed

### 2. Time-Sensitive Records

These capture execution history, investigation context, or dated decisions.

These files should usually include a date in the path or filename.

Use dated naming for:

- `docs/logs/`
- `docs/testing/`
- `docs/discussions/`
- `docs/analysis/`
- `docs/audits/`
- `docs/retrospectives/`
- most one-off requirement synthesis files and implementation plans

## Recommended Path Conventions

### Logs

- `docs/logs/YYYY/MM-DD.md`

### Testing Notes

- `docs/testing/YYYY/MM-DD.md`

### Discussions

- `docs/discussions/YYYY-MM-DD-topic.md`

### Analysis

- `docs/analysis/YYYY-MM-DD-topic.md`

### Audits

- `docs/audits/YYYY-MM-DD-<kind>-<topic>.md`

### Retrospectives

- `docs/retrospectives/YYYY-MM-DD-topic.md`

### Plans

- `docs/plans/YYYY-MM-DD-topic-plan.md`

### One-Off Requirement Synthesis Files

- `docs/requirements/YYYY-MM-DD-feature-name.md`

## Bug Notes

- `docs/bugs/01-short-bug-name.md` or `docs/bugs/YYYY-MM-DD-short-bug-name.md`

## Simple Rule Of Thumb

- if the file answers "what is the current supported baseline?" -> stable name
- if the file answers "what happened in this round / this day / this investigation?" -> dated name