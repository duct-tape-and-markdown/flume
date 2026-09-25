# The instant is a necessary test; the run's own sha would be the sufficient one

Shipped: `readCiLaneStatuses` resolves the tip once (`tipAt`, `harness/ci.ts`)
as branch + committer instant (`%cI`), and `behindTheTip` refuses a newest
completed run created before it, before the jobs read is bought.

Two things for the next plan tick.

**The instant is necessary, not sufficient.** A run created *after* the tip's
commit can still be a run about another tree: a manual re-run of an older
commit, or a run for a commit this tip is not a descendant of. The forge
already states the exact fact — `run list --json headSha` carries the sha the
run was created for — so the sufficient refusal is "the run's `headSha` is not
this tip's sha", with the instant comparison falling out as redundant. I did
not widen the entry to it: `spec/harness.md`, *CI lanes as a findings source*
names the instants ("naming both instants") and nothing else, so the sha read
is a spec decision, not build's. If the section wants it, it is a one-field
change to `RunSchema` and a swap inside `behindTheTip`.

**A fixture tripwire.** `tests/harnessCi.test.ts` now pins its seed commit's
instant (`TIP_AT`, `commitAt`), because a tip committed at wall-clock now puts
every run fixture in the file behind the tip and reads every lane unread. Both
git dates go through the environment: `git commit --date` sets only the
author's, and the reader orders against the committer's. Any case added there
with a run fixture of its own has to keep its `createdAt` after `TIP_AT` or it
will assert over an unread lane — and the failure reads as a staleness refusal
rather than as a fixture mistake. Nothing mechanical holds that today; the
shape that would is a fixture helper minting a run's `createdAt` from `TIP_AT`
rather than a literal per fixture, which is worth a shape line if a second
stale-by-accident case ever lands.
