# Rulings without a spec home: spawn-scan reach, the verdict's ledger shas, the ESM comments

Operator rulings from the interactive session that settled plan's eleven open
questions; the other nine landed as spec and rule-page edits in this commit.

## Spawn scan name reach — name the colliding declaration

From `what-pays-for-the-spawn-scans-scopeless-name-reach.md`: option 2. The
scan keeps its name-wide reach (the over-approximation stays the declared
trade), and a finding names the declaration that made the name reach a
spawn or a timer — file and line — beside the name, so a collision is read
rather than re-derived. Cite: `engineering.md`, *A fact the engine holds is
reported, never rediscovered*. The site states the ruling so a fifth note
reads the answer.

## The verdict's ledger shas — not now

From `does-the-verdict-report-whether-a-ships-ledger-commit-landed.md`:
option 3, the log stays the home. No chain reads the fact, and the one
surprising arm — a rewrite finding the shipped entries' files already gone —
has never been measured. Reopens when a chain or verb needs the fact, or
that arm is observed on a real run; the observation is filed as the defect
it is, not as a reporting field.

## Three comments still state the retired ESM claim

`.claude/rules/platform-facts.md` now reads *A plain `import()` is pinned;
`tsImport` re-reads* (measured: `tsImport` re-reads the entry and its
dependency graph every call). Three comments still argue from the old
claim and are now false in substance — their cites were re-homed in this
commit, their sentences were not:

- `src/chainLoad.ts`, `loadChainModule`'s doc: "In-process this returns a
  *pinned* evaluation" as the reason for the process boundary. The
  boundary's reasons now live in `spec/chain.md`, *Chain resolution is
  per-tick, and the tick is a fresh process*.
- `tests/loopSupervisor.test.ts` (~3950): "a rewrite is unreadable in one
  process by construction".
- `tests/cli.test.ts` (~4684): "A module is evaluated once per process
  whatever the engine does with it" — check whether the case's reasoning
  still holds under `tsImport`.
