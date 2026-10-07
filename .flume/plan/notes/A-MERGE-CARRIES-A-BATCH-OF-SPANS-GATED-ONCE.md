# Batched merges landed; two seams moved to make room

The merge drive is no longer one call per attempt. `src/waveMerge.ts` now has
`offerAttempt` (fold + enqueue, called off the merge queue as each agent
returns) and `drainWaiting` (takes the ship lock, *then* reads the queue, so
"waiting on the ship lock" is an event and not a race). `abandonWaiting`
replaces `foldUncarriedAttempt`. `src/mergeSpan.ts` split its three steps —
`foreignTipRefusal`, `pickSpanRange`, `gateMergedTip` — so `carryMergeBatch`
is the same passage at a width, not a second spelling.

Three judgment calls plan may want to re-route:

1. **A refused unwind walls the wave.** If `reset --keep` back to the tip
   before the batch is refused (bystander collision, or a foreign commit
   landed since the last pick), the batch's commits stay on trunk ungated.
   No `MergeOutcome` describes that, and a serial re-carry cannot run over
   it, so `carryMergeBatch` throws: the markers stay standing, the next start
   refuses, the operator repairs. Loud, but it is the one arm with no
   per-entry report.

2. **A batch's merge timing row carries no `entryTag`.** Its picks, one gate
   run and one ledger commit are not one entry's passage, so the row is
   untagged exactly as the batch gate context withholds `entry`. Serial
   carries still name their entry. `TickVerdictTiming.entryTag` was already
   optional; nothing else changed on the verdict.

3. **`offerAttempt` logs the queue depth** (`N span(s) waiting on the ship
   lock, M per merge`). It is the fact the next merge decides width from, and
   it is what makes the new cases deterministic — they release a planted ship
   lock off that line. One line per entry per wave.

Still serial here: `harness/judgeGate.ts` does not declare `batches: true`,
and no declared gate can yet (no batch spelling in the `FLUME_*` env — see
A-GATE-DECLARES-WHETHER-IT-READS-A-BATCH's note). `mergeBatch` is reachable
only by a hand-rolled gate until those land.
