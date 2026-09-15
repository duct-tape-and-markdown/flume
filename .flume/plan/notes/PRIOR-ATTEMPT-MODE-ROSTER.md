# The roster's second tie lives in the renderer, on purpose

`PRIOR_ATTEMPT_MODES` (src/Prompt.ts) is tied to the union in both
directions, and the two halves sit apart:

- roster ⊆ union — `as const satisfies readonly PriorAttempt["mode"][]` on
  the declaration itself;
- union ⊆ roster — a bare `prior.mode satisfies PriorAttemptMode;` statement
  at the top of `modeLines`, the renderer's exhaustive switch.

The second half needs a *value* of the discriminant's type, and `modeLines`
is the only place one exists; a standalone `type _Assert = …` would be
`noUnusedLocals` residue or an export with no consumer. So it reads as a
no-op statement. A sweep lens for dead plumbing could take it for one —
deleting it drops the acceptance "a seventh union member cannot land without
the roster growing" (verified: adding a seventh variant errors there, TS1360).

Adjacent, not filed: `harness/windows.ts:249` and `harness/handoff.ts:115`
key their classification tables off `PriorAttempt["mode"]` / `NoCommitMode`
rather than the roster type. Already exhaustive by tsc, so this is naming
coherence only.
