# A stub Runner cast through `unknown` hid the dropped field

`tests/harnessGates.test.ts:77` builds its stand-in as
`{ ... } as unknown as Runner`, and its `RunResult` literals were already
wrong-shaped before this entry (`passed: []` for a `number`, no `names`,
no `failed`). The cast means `tsc` says nothing when `RunResult` changes,
so dropping `failingFiles` there was a manual sweep, not a compiler hit —
the next field to move will be missed the same way.

The honest stub is the typed literal `tests/harnessDeclaration.test.ts:32`
already uses (`const EMPTY_RUN: RunResult = {...}`); that one did fail the
typecheck and pointed straight at itself. Candidate entry: give the harness
tests one shared typed no-op runner and delete both ad-hoc stand-ins, so a
runner-interface change is a compile error at every consumer of it.
