# Three judgment calls the Flow row made, and one duplication it left

**"Failed merge" = the `cherry-pick-conflict` outcome alone.** The engine
already splits the stages: `TickVerdict.mergeFailures` is merge-stage,
`gateFailures` is a revert over a merge that landed. So `afterMerge-reverted`,
`afterCommit-reverted`, `tip-moved` and `wave-walled` are *not* counted. Plain
English would read some of those in: if the operator wants rework-per-ship
rather than merge-stage-per-ship, that is a different fold and line 10 needs
the word.

**"Ready" is the gate switch over `work` entries, with no fork governor.**
`gateReadyEntries` (`src/selection.ts`) is now shared with the wave's own
selection, but status passes no `isForkResolved`: the governor is a chain
*module* export and `loadChainForObservation` only hands back `Chain`. An entry
gated on an unresolved fork therefore reads as ready and inflates the wait.
Widening that load is a real option; I declined it because calling chain code
inside an observational verb adds a throw path to a verb specced never to fail
on an observation. Quarantine and claims are deliberately not subtracted
(quarantine is a supervisor's memory; a claim is a window inside the wait, not
its end).

**No populations on the row.** Line 10 asks for three figures, so the row
prints three: a median over one ship and over 200 render alike. The counts are
cheap to add — the fold holds them.

**Debt:** `formatSpan` (`src/queueFlow.ts`) and `formatElapsed`
(`src/budgetLine.ts`) are two spellings of one job, split by range (the budget
line tops out at hours, a queue span is days). Each is cited at the other. One
home would want the days arm on the budget line too, which changes a surface
agents read — worth a decision, not a silent widening.

**Cost:** `status` now spawns one `git log` and reads the verdict log every
run, shell prompts included. Over this repo's history: 200 verdicts, 365 filed
tags, median 54m, 0.02 failed merges per ship.
