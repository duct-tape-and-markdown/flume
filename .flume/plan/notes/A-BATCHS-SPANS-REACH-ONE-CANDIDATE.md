# Batched merges on a candidate: three spec sentences left behind

Shipped as written. The batch carry now shares the single-span carry's
candidate frame, pick, gate loop and fast-forward; `resetKeepTo`,
`ResetKeepRefusedError`, `cherryPickAbort` (and its sequencer probe),
`checkpointBystanderState`, `checkMergedTipUnmoved` and
`TickVerdict.bystanderCheckpointSha` are gone.

**Spec drift, for a human.** No `cherry-pick --abort` runs anywhere now — a
stopped pick leaves with the candidate, whose removal takes the tree, the
index and git's sequencer state together (measured: `worktree remove --force`
over a conflicted pick). Three sentences still name it as current behavior:

- `spec/loop.md`, *Fanout is the engine's declared navigation carve-out*
  bullet: "with `cherry-pick --abort` on conflict".
- `spec/loop.md`, *Tip verify — one writer per branch, absorption at the
  merge*: "a conflicting cherry-pick aborts (`cherry-pick --abort`)".
- `spec/pending.md`, *observedFiles*: the footprint "captured before the
  cherry-pick is aborted".

*Crash equals stop* already states the target ("hosts no cherry-pick, abort,
or reset"), so the defect is in those three, not in `src/`.

**Two calls I made, both stated at the site.**

1. A batch's candidate is provisioned with `worktreeKey = phase.name` — no one
   entry names that tree, the same reason its gate context withholds the
   entry. Note a batched merge previously provisioned *nothing* (it picked onto
   trunk), so a batching consumer's `setupWorktree` now runs once per merge
   where it ran zero times. `docs/CHAIN-AUTHORING.md` updated at both places.
2. A refused fast-forward rows every span `tip-moved` rather than falling back
   to serial: *Batched merges* names red and a conflict as the serial triggers,
   and a refusal is the single-span carry's `tip-moved` at a width.

`entry.files` expected a `MergeOutcome` variant for the unwind in
`src/tickVerdict.ts` — there was none; an unwind rowed nothing.
