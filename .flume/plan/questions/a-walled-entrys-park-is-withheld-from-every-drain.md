# A walled entry's park is withheld from every drain — which side gives?

`A-THROWN-PROMPTARGS-IS-A-RENDER-REFUSAL-AT-65` cannot ship and cannot be
retired. Three plan-inbox ticks have now been woken over its park and handed
nothing to file (2f6bedef, 48776814, and the tick filing this). That is the
cost `harness/standingRefusal.ts`'s own header names — "woken into a drain
with nothing to file, every tick, for as long as the record stands" — so it
is a ruling, not a note.

**The deadlock, verified on disk this tick.**

- The park record stands: mode `not-shipped`, `touchedPaths` naming
  `.flume/plan/notes/parked/A-THROWN-...md`, so `declaredPutDown` reads
  `"parked"` and `isContinuation` is false. Its `declaredAs`
  (`...@673d1db864`) still equals the entry's declaration — the entry file is
  unchanged since d80539cb, before the park landed at 2e414dfe (12:27 today).
  So `isStandingRefusal` is **true**: no build wave may pick it.
- The window nonetheless reports the entry claimed, which withholds its park
  from `recordFiles` and its record from `standingRefusals` — so no drain may
  answer it either.
- Yet nothing holds it. No claim file for `a-thrown-promptargs-is-a-render-
  refusal-at-65` under `<git-common-dir>/flume/claims/primary/`, and no
  worktree for it; the only live claim and the only build worktree belong to
  `the-agent-spend-fold-takes-the-file-its-name-is`. The claim the window saw
  was gone minutes later, and no new prior-attempt record replaced the 12:27
  one, so no attempt was made under it.

**The upstream suspect, named rather than papered over.** `spec/pending.md`,
*Claims — an entry in flight is left alone* rules selection to skip a claimed
entry *before* the chain's `refusesEntry` is consulted. So a wall the package
itself holds can never be the reason an entry is claimed — which means the
claim that appeared on this walled entry came from somewhere the spec does not
describe (a slot staking ahead of its attempt, or a stale claim read live).
Deciding the withholding rule without ruling on that would be papering over
it.

**The fork.**

1. **Read the wall inside the withholding.** `standingRefusals` and
   `recordFiles` already share one `claimed` set; withhold a claimed entry's
   record *unless* that record is itself the standing refusal walling the
   entry — no build tick can legitimately hold what no wave may pick, so there
   is no rug to pull. One predicate, one home. Costs: it makes the wall a leg
   of a rule `spec/pending.md` states unconditionally, so the spec sentence
   moves with it.
2. **Fix the claim instead.** Treat the phantom claim as the whole defect,
   pin that a walled entry is never staked, and leave the withholding rule
   exactly as the spec states it. Costs: I could not reproduce the claim on
   disk this tick, so the repro has to be found before the fix — and until it
   is, the park keeps costing a tick per cycle.
3. **Give the drain an override.** Let a park whose entry has been withheld
   across N drains be answered anyway. Costs: N is a policy constant with no
   owner, and it is the kind of threshold `engine-boundary.md` fences.

**Leaning: 1 and 2, in that order.** 1 unblocks the queue with a predicate
the package already owns; 2 is the real defect and wants its own repro. 3
encodes a timeout where a decidable predicate is available.

**What is blocked meanwhile.** The entry sits at `priority: 10`, the top of
the queue, and its park says it is already shipped — `tests/cliRender.test.ts`
holds the `pins[]` line verbatim, landed by
`build(THE-RENDER-REFUSED-CLASS-IS-ENUMERATED-WHOLE)` (88881990). So the
answer to *the entry* is "retire it"; what this question asks is which
mechanism lets a drain say so.
