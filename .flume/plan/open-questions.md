# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Type-level tests are not gate-enforced — tsconfig excludes `tests/`

**Status: PARKED**

Observed during TRUNK-PURGE: v0.5 §7 asks for a type-level assertion
(`trunkBranch` absent from `DispatcherOptions`). It's written
(`tests/Dispatcher.test.ts`, `TrunkBranchPurged`), but `tsconfig.json`
includes only `src/**`, `examples/**`, `.flume/chain.ts` — so the tscGate
never typechecks `tests/`, and vitest transpiles without checking. The
assertion binds under LSP while editing, but no gate would catch a
regression. This affects every type-level test §7 plans, not just §2.

Options: (a) add `tests/**/*` to tsconfig include — strict flags may
surface existing errors in ~3k lines of tests; (b) a separate
`tsconfig.tests.json` + second tscGate invocation; (c) accept LSP-only
enforcement. Leaning (a) or (b); either is a small standalone entry.
