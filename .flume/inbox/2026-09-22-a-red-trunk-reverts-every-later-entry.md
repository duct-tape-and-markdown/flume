# A red trunk reverts every later entry, blaming the entry

Measured chain, one wave apart. Wave 1 merged bea025fd (a cite at
`tests/cli.test.ts` naming a posture-sweep lens that is a bold run, not a
heading) and then b689d290 (the section-cite pin), each green in its own
worktree against a base that lacked the other. Trunk was red on the pin
from that merge on. Wave 1's last entry and both of wave 2's
(WAVE-VERDICT-SURVIVES-ANY-LEDGER-COMMIT-REFUSAL,
HARNESS-DECLARATION-CARRIES-WORKTREES-BASE) were gate-reverted by `named
lines` with "the suite is not green", their own lines carried, the one
finding a line neither diff touched. Verified by running the pin at both
reverted shas: identical single finding. 2a685ea8 fixed the cite and
trunk is green again.

The judge runs the suite on the merged tree and reports a red as the
entry's. The record already carries `suspectFlake: true` — an inference
from the touched set, where the fact is a base run: the same failing test
on trunk before the pick (`engine-boundary.md`, *Told, not inferred*).
Reverting cannot green a trunk that was red before the entry arrived; the
entry pays a worktree and an agent for nothing, and the next run retries.

Shape to weigh: on a red suite, run the failing file at the base; red there
too is reported as trunk-red, never as this entry's gate-revert.
