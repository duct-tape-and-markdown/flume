# Is a lane read refused by the run's own sha, rather than by its instant?

`spec/harness.md`, *CI lanes as a findings source* states the staleness
refusal as an ordering of instants: "a newest run created before the tip's own
commit reads as `UNREAD`, never green or red, naming both instants". That
shipped at 1b150761 and is what `behindTheTip` (`harness/ci.ts:591`) compares.

**The instant is necessary, not sufficient.** A run created *after* the tip's
committer instant can still be a run about a different tree, so the comparison
lets one through in exactly the direction the section says it must not:

- `git commit --amend` at 10:00 rewrites the tip; the forge's newest completed
  run for that branch was created 10:05 for the pre-amend sha. `created >=
  committed` holds, so the lane reads as this tip's — a green closes titles the
  amended tree still fails, and a red files findings against a tree that no
  longer exists.
- A manual re-run of an older run reports that run's own commit, and any run
  for a commit this tip is not a descendant of does the same.

The forge already states the exact fact. `gh run list --json` offers `headSha`
(confirmed on this host against the field list it prints), so the sufficient
refusal is a comparison the reader can simply make.

## The fork

**(A) Refuse on the sha; the instant comparison falls out.** The section reads
"a newest run whose own commit is not this tip's reads as `UNREAD`". One field
on `RunSchema` (`harness/ci.ts:172`), one swap inside `behindTheTip`, and the
`%cI` tip read (`commitInstantAt`) is no longer load-bearing for the refusal.
Exact in both directions: a run is this tip's or it is not, with no ordering to
reason about and no offset-parsing arm to carry (`instant`, `harness/ci.ts:615`).
Cost: strictly more `UNREAD`. In practice little — a run for an ancestor commit
is already refused by the instant rule today, so what changes is the amend and
re-run cases, which is the point. Recommended: it is the statement the
counterparty makes outright (`.claude/rules/engine-boundary.md`, *Told, not
inferred*), where the instant is the engine reconstructing it.

**(B) Keep the instant, add an ancestry check.** Refuse unless the run's
`headSha` is the tip or an ancestor of it, so CI green on the parent still
reads. Looser, but it re-opens the hole the section exists to close: a red for
the parent would be attributed to the child. Also buys a `merge-base` call per
lane against a sha the local tree may not hold.

**(C) Leave it and declare the residual.** Cheapest; the gap is narrow. Costs
the section a sentence naming what the refusal does not cover, since a
necessary-only check that reads as sufficient is the shape *Loud or nothing*
fences.

## What is needed

A ruling on the section's sentence — `spec/` is the human's surface, so plan
cannot scope this into an entry against a section that names the instants and
nothing else. Under (A) or (B) the follow-on is small enough to file as one
entry the same day; under (C) it is a spec sentence alone.

Raised from the build note on `THE-LANE-READ-REFUSES-A-RUN-OLDER-THAN-THE-TIP`,
which shipped the instant comparison as the section states it.
