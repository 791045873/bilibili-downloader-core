# Testing Note Guide

## Purpose

Use this guide when creating plan-linked testing direction documents or recording manual/exploratory testing evidence.

## Plan-Linked Testing Directions

When a plan is authored, create or update the corresponding testing document under `docs/testing/` before implementation starts.

For each new requirement or change in the plan, write a testing direction that describes requirement-level observable behavior:

- what should be true for the user or system after the change
- what should not be true after the change
- what evidence will confirm the direction later

Do not write implementation-focused checks here. Avoid references such as function names, internal variables, component methods, SQL details, or unit-test mechanics unless the requirement itself is an API or integration contract.

A testing direction is not proof by itself. It stays `pending` or `not run` until a human or agent actually verifies it.

## Manual Or Exploratory Evidence

Use this guide when recording:

- exploratory test passes/failures
- reproduction steps for flaky or environment-sensitive issues
- manual verification evidence that should not live only in a PR comment

## Output

A plan-linked testing document should include:

- linked plan and source requirement
- environment / configuration notes
- testing directions, each with:
  - requirement or change covered
  - should be observable
  - should not be observable
  - status: `pending | passed | failed | out of scope`
  - evidence after execution

A manual or exploratory note should include:

- what was tested
- how it was tested
- what passed
- what failed
- environment / configuration notes

## Closure Rule

Before plan closure audit can pass, every testing direction in the plan's corresponding testing document must be confirmed as `passed`, or explicitly marked `out of scope` with a recorded reason.

Do not claim verification success for commands, manual checks, or testing directions that were not actually run.
