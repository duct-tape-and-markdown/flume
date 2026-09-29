# Does a refilling wave drop a claim when the attempt ends, or when the wave does?

`spec/pending.md`, *Claims — an entry in flight is left alone* says a build tick
stakes the claim before it provisions the entry's worktree "and removes it when
the attempt ends: with the ship, or with the teardown of an attempt that did not
ship."

`src/waveTick.ts:654` releases every claim the wave staked in one loop at wave
end, after the teardown walk. The comment above it describes the per-outcome
placement the spec states — "with the ship for an entry that shipped, with the
teardown above for one that did not" — and defends the single site on the ground
that no way out of the wave may leave an entry claimed by a tick that has stopped
carrying it. Before slots refilled, wave end and attempt end were the same
moment. With refill they are not, and the single site now produces the exact
state the comment set out to prevent.

## Measured on this tree, 2026-09-29

- Twelve files under `.git/flume/claims/primary/` all name pid 1949728 — one
  `flume tick --phase build`, alive 1h44m — staked between 19:26:55Z and
  20:52:07Z.
- Ten of the twelve name entries that have left the queue. Their claims stand,
  and nothing reads them, which is why this has been invisible.
- The one that bites is `a-thrown-promptargs-is-a-render-refusal-at-65`: claim
  staked 19:26:55Z, attempt ended 19:28:11Z with a `not-shipped` park (commit
  2e414dfe, an ancestor of HEAD), claim still standing at 21:11Z. This tick's
  `<in-flight>` block names the entry as carried right now; nothing is carrying
  it.

While a claim outlives its attempt, the entry is unreachable from both sides: its
park is withheld from the drain (*A claim covers the entry's records*, same
section), the standing `not-shipped` refusal holds it back from the next build
wave (`harness/standingRefusal.ts`), and the drain is told to leave the entry as
the queue states it. It unsticks when the wave ends — so the cost is latency, one
plan tick burned per cycle, bounded by however long a refilling wave runs.

## The fork

1. **Release per attempt.** Move the release into the slot's own end. The hazard
   the single site was avoiding is real: the entry's branch and worktree survive
   to wave end, so a dropped claim lets a later pick collide on
   `flume/primary/<slug>`. That stops being a hazard only if teardown moves
   per-slot too — a larger change than the release itself.
2. **Release per settled outcome.** Drop the claim where the ship or the record
   is written, and keep it for an entry whose worktree could not be torn down.
   Narrower than (1), and it splits the one-site invariant into two.
3. **Amend the spec to name the wave.** State that the claim is removed when the
   wave that staked it puts its work down, which makes the current code correct,
   and let the drain's window carry the quietness — the entry filed this tick
   (`A-CLAIMED-ENTRY-STANDING-REFUSAL-IS-WITHHELD-FROM-THE-DRAIN`) already does
   that half, and it is worth shipping under any of the three answers.

I'd lean (3) plus a bound: the latency only hurts because a wave can run for
hours, and if that is the intended shape then "claimed for the wave" is the
honest statement. But (3) is the answer that accepts a park waiting out a
multi-hour wave, and whether that is acceptable is a loop-economics call rather
than a mechanical one — which is why this is here and not an entry.

## Re-measured 2026-09-29T21:23Z — the bound is hours, and it is still running

The same claim, unchanged: staked 19:26:55.493Z, attempt ended 19:28:11.707Z,
still standing at 21:23:35Z — **1h55m past the end of the attempt it was taken
for**, with wave pid 1949728 alive 1h56m and still refilling. This is the second
consecutive `plan-inbox` tick woken over it (1d3f224c, then this one), each
finding the same record it may not touch and filing nothing against it.

So the latency in the cost line above is not a short tail. "Bounded by however
long a refilling wave runs" is, on this tree, bounded by hours and not yet
closed, and the drain pays a tick per cycle for the whole of it. That is the
number option (3) asks a human to accept.

Two facts that are *not* defects, checked this tick so the next reader does not
re-check them:

- 55 files under `.git/flume/claims/primary/`, 41 naming pid 801933 — a dead
  run's. `readLive` drops a dead pid's claim, and `stake` unlinks the stale file
  on its way to taking the slug (`src/entryClaims.ts`), so the residue is lazy
  cleanup, declared at the site, not a leak that reads as live.
- Liveness is `process.kill(pid, 0)` alone (`livePidClaimAt`, `src/pidClaim.ts`),
  which is the probe `spec/pending.md`, *Claims — an entry in flight is left
  alone* rules for. The claim already carries its instant if a recycled-pid
  disambiguation is ever wanted; nothing here asks for one.
