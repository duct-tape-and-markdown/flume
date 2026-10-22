# One span's merge-stage throw walls the wave, and the walled siblings' passed work is never recovered (operator report, class)

**Kind.** A failure's blast radius is set by where it is caught, not by what
it touched. Any throw in a wave's merge stage is the wave's wall: every
sibling still waiting — agent finished, `afterCommit` gates green — is folded
as `wave-walled` and never offered to cherry-pick (`abandonWaiting`,
`src/waveMerge.ts`; the row's own doc, `MergeOutcome`, `src/tickVerdict.ts`:
"the fold is keyed on the wave being walled and never on the cause"). The
cause may be scoped to one entry — a prior-attempt record the store refused
for *that* entry, a marker write for *that* slug — and the whole wave still
pays.

**Members.**
- Operator report: one entry's failed merge killed the tick; sibling builds
  that passed their gate were thrown away rather than merged.
- Walls listed at the row: a ledger rewrite that refused, a merge marker the
  disk would not take, a prior-attempt record the store refused, a
  `revParse` that failed, and the batch `unwind`'s foreign-tip throw
  (`src/mergeSpan.ts`). Some are trunk-scoped (a queue that will not parse,
  a tip another engine claimed — continuing would be wrong); others are one
  entry's.
- **A recovery promise no actor keeps.** The `wave-walled` row carries
  `baseSha`/`headSha` so "the span is re-cherry-pickable from this row
  alone", and `headSha`'s doc says a passed span "must be re-cherry-pickable
  from the verdict alone, never re-run at full agent price". Nothing reads
  the row to re-pick it: the next start's teardown deletes the branch and
  the entry re-runs its agent. Recovery narrated, not built
  (`engineering.md`, *Narration is the ladder's bottom rung*;
  `posture-sweep.md`, *Dead plumbing*).
- The precedent the merge stage lacks: a gate's throw is that gate's
  failure, "never a reason to lose the tick's facts" (`spec/chain.md`,
  *What a gate returns*). The merge stage has no equivalent rule for a
  throw scoped to one span.

**Owning artifact.** The merge stage's failure scoping (`spec/worktrees.md`,
*Per-entry `afterMerge` revert isolation*, which already promises that one
entry's red keeps its siblings shipped — the promise stops at a red and does
not reach a throw). Target: each wall site states its scope — entry or
trunk — where it raises; an entry-scoped throw ends that span as a failed
merge with its facts and the drain goes on; only a trunk-scoped one walls.
And the recovery the row promises is built or the promise is deleted:
either a later merge stage re-picks walled spans from their rows, or the row
stops claiming it.

**Interacts with** `2026-10-22-trunk-holds-ungated-commits-so-undoing-one-rewrites-history.md`:
several wall causes exist only because trunk holds a picked commit while it
is judged; that record's design removes them, so rule it first.
