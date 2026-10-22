# The shipped vitest runner decides the consumer's test scope, then asks the consumer to restate it (downstream consumer report, ownership)

**Kind.** An ownership miss across the package/consumer boundary. What the
suite is — which tests a run covers — is the consumer's, and passes the
second-implementation test outright: every consumer would choose its own
(`engine-boundary.md`, *Surface, not prescription*). The shipped runner
instead fixes it and makes the consumer restate it:

- `run` spawns a bare `vitest run` (`resolveVitest`,
  `harness/vitestRunner.ts`). The one place a consumer can put its scope is
  `invoke`, documented as *how to reach vitest* — location, not scope — so
  the field that carries scope does not read as carrying it.
- `Lane.excludes` (`harness/runner.ts`) asks the consumer to restate, as
  globs, what its own config or script already says; it reaches plan's
  hints only and is checked against nothing the run does
  (`engineering.md`, *Derived state is computed, never restated beside its
  source*).

**Field instance.** A consumer's `pnpm test` drops the `db` and `toolchain`
vitest projects on the command line; the judge's merged-tree run executed
both on every merge — one merge 16 min, a toolchain case peaking ~11 GB.

**Contract.** `spec/harness.md`, *The runner interface*, as amended in the
commit that files this record: the consumer's runner declaration states the
scope once, in the tool's vocabulary; the runner adds only what reading a
run needs; the running lane's coverage is the tool's own answer for that
scope, and its complement is plan's hint.

**Target shape.**
- The vitest runner takes the consumer's scope as a declared field in
  vitest's own argument vocabulary (e.g. `--project unit`), named for what it
  is; locating vitest stays the runner's and stops being the only door.
- The runner appends only `--reporter=json` + `--outputFile`
  (`structured-output-located-by-inference.md`) and, at the base, the
  judge's files — nothing that widens or narrows.
- `Lane.excludes` goes. Coverage is asked of the tool for the declared
  scope; plan's hint is what that scope leaves out. **Measure first:**
  whether `vitest list --filesOnly --json` (or the version's equivalent)
  answers coverage for a multi-project config under the declared scope. If
  no form answers, the runner reports no coverage and the hint says so —
  never a restated list.
- Lanes keep their names and `runs`; `laneTests[]` keys on the name.

**Not filed, with why:** a separate regression command (a further home for
the same scope), and per-entry related-test selection (import-graph
selection misses tests that read the whole tree — a false green; `spec/chain.md`,
*What a gate returns*, on a span redding a file it never touched).
