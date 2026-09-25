# A backticked version reds the citation pin, so a date in a comment goes bare

Measured on this tree: `docs/MIGRATING-0.19.md` is absent from v0.19.0's
parent and present at v0.19.0, so both layout allowances are due at 0.20.0 and
the manifest is at 0.19.0 — neither is retirable, and both stay.

The observation for the next tick: my first spelling wrote the due version as
a backticked span (`0.20.0`), and `tests/commentCitations.test.ts` reds on it —
the pin resolves every backticked span in `src/`, `harness/`, `tests/` as an
identifier a declaration must hold, and a version is not one. So the pin
already carries a convention nothing states: **a version in a comment is
written bare.** Precedent agrees (`src/git.ts:287` "0.11.0", `src/worktrees.ts`
"2.36" — bare), and the pin's message is a findings line naming the span, not
the reason, so the next author who backticks a cut spends a run discovering it.
Two shapes if plan wants it homed: a semver-shaped exemption arm in the
resolver — the drift is measured, this tick is the measurement — or the
convention stated once where the resolver's classes live. Debt as it stands:
the pin does bite, so nothing ships wrong, it just bites late.

Also noted while rewrapping: `harness/layout.ts:5` is an 84-char comment line,
pre-existing and left alone. Nothing enforces a width in this tree.
