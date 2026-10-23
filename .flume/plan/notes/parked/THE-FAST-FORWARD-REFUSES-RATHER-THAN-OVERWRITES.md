# The two refusals: the absorption landed, one named line cannot be met

Landed on trunk in this commit, green:

- `git.FastForwardRefusedError.tipSha` - the tip git stood at when it refused,
  read at the refusal. That sha is the discriminant for the two refusals; the
  message is still never parsed.
- `carryAbsorbingMovedTip` (`src/mergeSpan.ts`): a carry whose fast-forward
  trunk declined *over a moved tip* is made again, once, onto the tip the
  writer left - candidate re-cut, span re-picked, gates re-run. A second mover
  is reported `tip-moved` and the entry retries next tick. A collision with
  uncommitted work is never re-carried: trunk did not move, so the same wall
  is all a retry would meet.
- It sits in the shared carry, not the wave leg plan predicted: the batch carry
  and the singleton leg meet the identical refusal, and branching one caller
  through shared code is the shallow pitch (`engineering.md`, *The fix lands at
  the mechanism*). The legs gained only wording.
- Cases: the absorption (tests[] line 1, red on the pre-fix tree), the
  bystander pin, the batch's own absorption, the bound's terminal refusal, and
  three `fastForwardTo` cases in `tests/git.test.ts`.

Why parked, not shipped: tests[] line 2 - "an uncommitted change on a path the
span touched refuses the fast-forward with both writers' work in place" - is
**measured green on the pre-fix tree** (ran it there; also probed git directly,
staged and unstaged refuse alike). It came free with `merge --ff-only` in the
blocker's carry, so no commit on this entry can introduce it. The judge rules
that line `green-on-base`, which reverts the whole commit - the park is the
only way the work above reaches trunk. Move the line to `pins[]`: its case is
in the suite with that title verbatim, so a re-filed entry is met with no new
work. The acceptance's second clause already holds.

Priced: one absorption runs the `afterMerge` gates and consults `shipped` a
second time, inside the ship lock.
