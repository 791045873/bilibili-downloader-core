# Bug Fix Note Writing Guide

## Purpose

Use this guide when recording non-obvious regressions and root-cause discoveries.

## When To Use

- a subtle regression was fixed and the root cause should be remembered
- a fix required domain knowledge not obvious from code alone
- the same pattern of bug is likely to reappear

## Output

- what the symptom was
- what the root cause was
- what the fix was
- why the fix is correct
- if automated test coverage was added or why not

## Rule

Every non-trivial bug fix should add or update automated test coverage. If automated coverage is impossible, record the reason and manual proof.