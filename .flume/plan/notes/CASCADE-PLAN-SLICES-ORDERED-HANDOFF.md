# The ladder shipped in the fast lane; the acceptance's integration half did not

Acceptance said "the integration test ticks the ladder". There is no cascade
integration harness — `tests/examples.integration.test.ts` drives
backlog-groomer only — and CASCADE-SHOULDRUN-FROM-DISK's park re-homed every
`CASCADE-*` line to the fast lane, which is the only lane the `vitest` gate
sees. The ladder is pinned in `tests/examples.test.ts` instead. A real tick-cycle
drive over cascade is its own entry.

Two pins outside the declaration moved with it (`tests/**` is a channel):

- `tests/retired-narration.test.ts` doc-quote reader now resolves the
  identifier the doc *claims* to quote, instead of hardcoding `const plan`.
- Its README phase-name reader now reads names off the loaded chain. The old
  regex over `phases: [...]` + `const <id>: Phase = {` cannot survive a list
  built by `map`, and would have read `[]` — agreeing with any README.

Also: cascade's `build.handoff` no longer names a phase. It routes through
`nextPhase`, with a refusal leg (`noCommit`, `entries[].mergeOutcome`) to
`plan-derive`, or a park re-picks itself into the same wall.
