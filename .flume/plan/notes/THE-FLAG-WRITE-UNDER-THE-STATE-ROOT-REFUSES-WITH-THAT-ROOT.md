# No help surface documents the state-root write refusal

Shipped as written: `writeFileUnderStateRoot` (`src/stateRootWrite.ts`) is the
mkdir's file-write sibling, and both flag writes go through it. Both named
tests were red on the base (exit 1 on a stack, not 74). Full suite green.

Observed, out of scope, pre-existing from the mkdir entry: **no surface states
this refusal in its `74` row.** `SHARED_ROOT_CAUSES` (`src/cliHelp.ts`) covers
a root that will not stat, a bay below git's root, and a root that stats clean
and is not a directory — none of them a root that stats as a *directory* and
still admits no write. So `flume wake --help`, `flume stop --help`, and
`docs/CLI.md`'s per-verb copies all state a narrower range than their own
process returns, which is exactly what that module's header says no page does
(`spec/loop.md`, *Exit codes — the run never lies to CI*). The mkdir arm
already had this gap; this entry adds two more instances of the same class, not
a new one, so extending the clause was not this entry's to do — it edits
documented surface a seam pins against `docs/CLI.md` (`SHARED_ROOT_PHRASES`),
and both sides move together. Worth an entry of its own.

Second, smaller: `Baton.dir` is now a getter over a held `stateRoot` rather
than a second stored copy of `awakeDir(flumeDir)`, because the refusal needs
the root and storing both is the shape *Derived state is computed, never
restated beside its source* refuses. Nothing spreads a `Baton`, so the
property read is unchanged for every consumer; `tests/Baton.test.ts` and
`tests/cli.test.ts` read `baton.dir` and stay green.

The root's **async** writers (the dispatcher's, the verdict log's) still write
raw and are their own family, as the entry scoped them out.
