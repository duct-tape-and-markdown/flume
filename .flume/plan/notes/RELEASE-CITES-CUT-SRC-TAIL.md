# Release cites cut; the pin landed early, scoped

Shipped as declared: no `RELEASE-v0.N §M` / `v0.N §M` cite remains under
`src/` outside `Dispatcher.ts`.

**Bare `§N` refs rode along.** Many cites had a sibling `(§3)`, `(§12/§14)`,
`(§5b-3)` in the same block, anchored only by the cite the entry names —
cutting the anchor alone leaves a dangling pointer, so those went too. Kept,
because they still resolve: quoted live test titles (`"revert note to the
friction channel (§5)"`, PendingSchema.ts:80, Prompt.ts), `docs/MIGRATING-
0.10.md § 5`, `spec/*.md`. Also re-pointed Prompt.ts's `Measured (spec §1)`
at `.claude/rules/platform-facts.md`, "MSYS2 corrupts non-ASCII in argv".

**RELEASE-CITES-PINNED shrank.** `tests/retired-narration.test.ts` now
carries the needle with a `Dispatcher.ts` exclusion, plus vacuity and
sensitivity pins. That entry's remaining work is `examples/` and deleting
the exclusion once RELEASE-CITES-CUT-DISPATCHER lands; the needle is written
and driven. Its `tests[]` line names no test yet.

`tests/` carries ~40 of the same dead cites (describe titles, headers). Out
of every current entry's scope — a candidate, not a finding.
