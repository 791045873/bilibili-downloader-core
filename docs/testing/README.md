# Testing Notes Index

Use this directory for plan-linked testing direction documents, exploratory/manual testing notes, and issue-focused testing notes that should be preserved outside chat.

Every created plan must have a corresponding testing document here when the plan is authored. That document describes requirement-level testing directions for each new requirement or change in the plan: what state should be observable, and what state should not be observable. It is not unit test code, not a detailed test script, and should not focus on implementation details.

## Suggested Uses

- define plan-linked testing directions before implementation starts
- record exploratory test passes/failures
- capture reproduction steps for flaky or environment-sensitive issues
- preserve manual verification evidence that should not live only in a PR comment
- record meaningful known-good verification states in `known-good-baselines.md`

## Plan-Linked Testing Documents

Use one testing document per created plan. The document must:

- link back to the plan and source requirement
- include one testing direction for each new requirement or change in the plan
- describe requirement-level desired states and forbidden states, not implementation details
- remain `pending` or `not run` until the direction is actually verified
- be fully confirmed as passed, or explicitly adjudicated out of scope with a reason, before plan closure audit can pass

Recommended filenames:

- `docs/testing/YYYY/MM-DD-topic-testing.md`
- `docs/testing/YYYY/MM-DD.md` for general daily exploratory notes