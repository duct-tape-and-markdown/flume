# Does `flume status`'s tip-claim line name the state root the claim holds for?

From a build note (THE-TIP-CLAIM-NAMES-THE-STATE-ROOT-IT-HOLDS-FOR). The claim
file now states a third line — the state root it was taken for — and refuses a
claim that names another root. `flume status` decodes it and throws the root
away: `liveTipClaimPid` (`src/git.ts`) keeps the pid alone.

`spec/cli.md`, *`flume status` owes exactly this* is exhaustive by construction
and its row 4 spells the line out: `tip claimed by pid N`, or `tip claim
present, process dead — stale`. So this is not spec silence to fill — it is a
ruling written before the claim carried a root, and only you can revisit it.

- **Leave it.** Nothing consumes the root today; the refusal reads the whole
  claim off the stake, so the line is not load-bearing. One fewer thing on a
  surface whose whole point is brevity.
- **Name it.** An operator whose tick refuses over a claim held for a *different*
  state root reads `tip claimed by pid N` and has no way to see why — the
  distinguishing fact is on disk and withheld at the surface they look at
  first, which is the argument row 2 and row 3 of that section are already
  built on. Costs a path on the line, or a suffix only when the root differs
  from the one status resolved.

No entry either way: row 4 as written rules out the wider line, so the spec
moves first. If the answer is "name it", say whether the root is printed always
or only on a mismatch.
