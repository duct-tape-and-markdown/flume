# Park: the entry's tests[] line is green on base

Verified on disk this tick — drove the real `pendingGate` over a real repo
with a backslash-separated offset (`jobs\alpha\.flume`) and a queue committed
at `jobs/alpha/.flume/plan/pending.json`. It reads the gated commit's queue
and returns ok. `readFileAtRef` (src/git.ts:478) folds every pathspec through
`gitPath` before ls-tree/show (f99009b), so the `join` at
src/builtinGates.ts:367 is harmless on win32 — likewise src/friction.ts:221
and harness/gates.ts:139, the same shape. The named tests[] line passes at the
base, so the judge reverts; not mine to retitle.

The other half is real and shippable: spec/chain.md "What a gate receives"
says `stateRootRel` is reported in git's alphabet, but `computeStateRootRel`
returns `relative()`'s host dialect, so three consumers restate the fold
(harness/gates.ts:264, harness/prompts.ts:379, harness/chain.ts:625 —
engineering.md *A fact the engine holds is reported*). Re-file with `tests[]`
empty: no posix run can turn the fold red, so the pins[] line is the whole
check available.
