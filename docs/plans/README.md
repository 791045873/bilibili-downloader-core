# Plans Index

Use this directory for non-trivial implementation plans.

- start from `00-plan-authoring-and-execution-guide.md`
- keep each plan focused on one result surface
- archive or supersede plans by status, not by deleting history
- for small and medium projects, prefer `docs/plans/YYYY-MM-DD-topic-plan.md`

Every created plan requires plan audit before implementation and closure audit before completion unless it explicitly qualifies for the micro-plan exception in `00-plan-authoring-and-execution-guide.md`.

Every created plan must also create or update a corresponding testing direction document under `docs/testing/` when the plan is authored. The testing document should describe what requirement states must and must not be observable for each new requirement or change in the plan; it is not unit test code and should not focus on implementation details.

Recommended filenames:

- `YYYY-MM-DD-topic-plan.md`