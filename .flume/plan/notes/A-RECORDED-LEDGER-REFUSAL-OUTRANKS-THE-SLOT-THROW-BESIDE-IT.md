# The losing wall's cause now reaches no surface at all

Shipped as one selection: `waveMergeError` and `waveSlotThrow` are gone,
replaced by `waveWallThrow` + `waveWall` (`src/waveMerge.ts`), and
`runFanout`'s two tail `if`s collapse to `if (waveThrows()) throw await
waveWallThrow(merge, { mergeError, slotError })`. Re-homed the 14 comment
cites that named the retired pair (`src/waveMerge.ts`, `src/waveTick.ts`,
`src/Dispatcher.ts`, `src/tickVerdict.ts`).

Observed, not filed: a wave can hold two walls and the carry states one
cause. The ranking picks the refusal, so the slot leg's own throw — the
teardown, the agent that exploded — reaches no surface: not the summary, not
`TickResult`, not the verdict. Before this entry the same hole faced the
other way. An operator repairing the queue then re-runs into the second wall
with nothing to have warned them. If that is worth reporting, the shape is a
fact beside the class (a second wall named on the verdict), not a second
class — `engineering.md`, *A fact the engine holds is reported*.

Test lever worth knowing: a slot leg's throw does **not** stop a sibling's
merge — only `mergeError` gates `mergeAttempt` — so a two-wall wave needs no
ordering at all. The new case pairs the `waveTornDownByASlotLeg` arming (an
agent wrecking its worktree's `.git` file) with the corrupt-entry-file
arming, and both walls stand whichever was hit first.

Vacuity for "the slot leg threw" rests on a signature, not a reported fact:
the entry is in `verdict.tags` and its agent ran, yet it has no `invocations`
row and no `mergeOutcomes` row, because a leg that throws never reaches the
fold. That reads as coverage of the fold's shape rather than of the throw. A
reported slot-wall fact (above) would let the pin assert it directly.
