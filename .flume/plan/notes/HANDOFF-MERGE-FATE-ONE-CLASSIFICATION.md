# The agreement pin spans two test files' fixtures

`tests/harnessWindows.test.ts` now builds a `TickResult` of its own to drive
the handoff's refusal leg beside the window's — `tickResult`/`outcome` in
`tests/harnessHandoff.test.ts` are the same fixtures, unexported. Agreement
pins are inherently cross-file, so one of the two will keep growing a copy of
the other's builders. If a third such pin appears, a shared
`tests/fixtures/tickResult.ts` is the cheaper home; one copy is not yet worth
the indirection.

Also observed while reading: `PLAN_RESOLVES_MERGE` is now exported from
`harness/handoff.ts` but is not on `harness/index.ts`. Its only consumer is
`harness/windows.ts`, which imports the module directly — deliberate, not an
omission. A downstream chain wanting to classify a fate for itself has no
route to either table; whether the package should publish them is a product
call nobody has made.
