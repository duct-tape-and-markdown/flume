# The hold marker landed; three things it reaches that the entry did not name

**`.flume/.gitignore` still needs `held/`.** `RUNTIME_IGNORES`
(`src/runtimeIgnores.ts`) now names it. The repo root's `.gitignore` is pinned by
`tests/harnessIgnores.test.ts` and landed here; the state root's own copy is
outside build's writable paths, so the next `flume loop` appends the line and
dirties a tracked file. It wants a `chore(flume):` commit, the way `0451ffaa`
handled `invocations/`.

**A held standing flag made the supervisor's "started no child" throw
reachable.** `superviseLoop`'s ending chain had an `else` arm documented as
unreachable while `maxTicks >= 1`; a declared flag the fill now skips is exactly
that state, so `flume loop` would have thrown over an operator's hold. Closed
with a run-end reason of its own (`"all-held"`, `src/runEnd.ts`) and
`SuperviseResult.heldPhases`, read after the orphan arm so a held *orphan* still
reports as the misconfiguration it is. Exit code unchanged — a hold is a clean
stop, so `loopExitCode` leaves it to the run totals.

**`Baton.release` is deliberately not here.** Nothing in this entry removes a
hold (a handoff never does), so shipping a remover would have been an export
with no consumer (`engineering.md`, *An export earns its consumer*). The sibling
verb entry owns `flume hold` / `flume wake`-lifts-the-hold and ships it then.
Same reason `docs/CLI.md` is untouched and `flume status` says nothing about
holds: with no verb, the only way to reach a hold today is writing the marker by
hand, and documenting a state an operator cannot reach reads as a shipped
surface. If the verb entry slips, that doc gap is real.

**Smaller:** the bare-tick orphaned-awake arm now names only the *undeclared*
flags rather than every awake flag. Equal whenever it used to fire; a refinement
a held flag beside an orphan made necessary.
