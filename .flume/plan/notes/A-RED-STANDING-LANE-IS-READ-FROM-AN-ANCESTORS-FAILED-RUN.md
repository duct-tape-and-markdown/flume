# A red-standing lane ships; the 0.20 migration note now understates the read

Landed: `harness/ci.ts` classifies a run's commit against the tip through git
(`runTree`, `ancestryAt`) rather than by strict equality, so a failed run on
an ancestor is the failing kind carrying `standing`, a pass on an ancestor is
unread, and a commit off this history (or one git cannot resolve) is unread
with its own reason. `harness/ciLane.ts` heads that block RED-STANDING and
says what it does not license.

Two things for the next plan tick:

1. `docs/MIGRATING-0.20.md` section 3 ("A CI lane reads only a run made for
   the tip's own commit") is not wrong as history - 0.20.0 is tagged - but a
   consumer upgrading past it now gets a lane that wakes on an ancestor's red.
   No 0.21 migration note exists to carry that, and minting one is a
   release-cut decision rather than this entry's. File it or fold it into the
   cut.

2. The ancestry read is a *sync* `git merge-base --is-ancestor` spawned in
   `harness/ci.ts`, declared and cited at the site against the engine's async
   `isAncestor` (`src/git.ts`) - the divergence `branchAt` already takes for
   `currentRefPath`. Cost is one extra child per lane whose newest run is not
   the tip's own, once per tick (the leg memoizes the status). If a slice
   window's args ever goes async, both spellings collapse into the engine's.

Fixture fact worth keeping: in `tests/harnessCi.test.ts` the non-ancestor
commit is now a real parentless commit written with `commit-tree`, because a
40-hex sha the object store does not hold takes the probe's *unreadable* arm
rather than its negative one. `rev-parse --verify` does not prove existence
for a full-length sha; `cat-file -e` does.
