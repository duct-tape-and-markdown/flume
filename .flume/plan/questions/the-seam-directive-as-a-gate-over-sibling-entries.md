# Does the sibling-seam directive move from the plan prompt to a harness gate?

`harness/prompts/plan-discipline.md`, *`files` is a prediction the scheduler
consumes, not a permission*, carries the directive as a bolded lead: siblings
cut from one section either intersect in `files` or chain with `blockedBy`.
Note SIBLINGS-OF-ONE-SECTION-DECLARE-THE-SEAM-THEY-SHARE observes that a rung
above prose is reachable, and asks for a ruling before anything is filed.

## The candidate rule

> Two entries whose `per.path` and `per.section` agree either intersect in
> `files` or one names the other in `blockedBy`.

Decidable over the queue alone — the shape `pendingGate` already reads, no
tree access. It is harness policy, not engine mechanism (a chain that wants
siblings racing may want them racing), so it would join the harness gate list,
never `src/` (`.claude/rules/engine-boundary.md`, *Capability vs convention*).

Today the directive governs only a slice that happens to read the page; a gate
would refuse the pair at the commit.

## Measured against the live queue this tick

Five sibling groups stand in the queue. Three pass the rule as written:

- `engineering.md` *Derived state is computed* — CLI-PAGE-IS-PINNED is
  `blockedBy` TICK-EXIT-CODE-CAUSE.
- `engineering.md` *Narration is the ladder's bottom rung* —
  A-REFUSAL-NAMES-NO-FUNCTION is `blockedBy` THE-INTERFACE-PAGES-NAME-SURFACE.
- `spec/chain.md` *The agent seam* — THE-ADAPTER-REGISTERS-THE-BUDGET-HOOK is
  `blockedBy` THE-BUDGET-LINE-IS-READ-OFF-THE-TRANSCRIPT.

Two do not, and they are the fork:

- **A clear false positive.** `engineering.md` *A module is one job* holds
  three entries. THE-TWO-REVERT-REFUSED-LEGS-ARE-ONE-FUNCTION and
  THE-WAVE-MERGE-SPLIT-RE-HOMES-ITS-GATE-LOOP-CITE intersect at
  `src/waveMerge.ts` and pass. THE-TWO-GUARD-HANDLES-ARE-ONE-VOCABULARY
  intersects neither and chains to neither — it is `src/pidClaim.ts` and
  `src/waitLock.ts`, a genuinely decoupled cohesion finding that happens to
  cite the same long section. The rule would refuse the plan commit carrying
  it, and the honest repair is padding `files` with a path the work never
  touches — the exact cost `plan-discipline.md` prices at a batch slot.
- **An ambiguous one.** `spec/harness.md` *A tick puts work down* holds
  A-CONTINUATION-ROUTES-BACK-TO-BUILD-NOT-THE-DRAIN
  (`harness/standingRefusal.ts`) and
  THE-NEXT-TICK-ON-AN-ENTRY-IS-HANDED-ITS-CONTINUING-NOTE
  (`harness/prompts.ts`). Disjoint files, no chain — but both turn on what a
  standing continuing note *is*, so this may be a seam neither names rather
  than a false positive. Whether it is a catch or noise is not decidable from
  the queue.

So on today's queue the rule is 3 clean passes, 1 clear false positive, 1
undecidable. **Arity is a second fork**: *A module is one job* is a
three-entry group, and pairwise the rule fails 2 of its 3 pairs — a
"the group is connected" reading would fail it too, on the same entry.

## Options

1. **Leave it at prose.** The directive stays a bolded lead the plan slices
   read. Costs nothing, catches nothing mechanically; the failure it exists to
   prevent (a lost agent span) stays possible.
2. **Ship the gate as stated.** Refuses the pair at the plan commit. Buys the
   catch; pays a false positive on any long section cut into genuinely
   independent findings, and the only repair available to a plan tick is
   padding `files`.
3. **Ship it as a warning, not a refusal** — the gate reports the pair on the
   verdict and lets the commit stand. No false-positive cost, but nothing is
   enforced, so it is prose with a louder voice.
4. **Narrow the subject so the false positive cannot arise** — e.g. bind only
   entries whose `per.section` is cited by two entries *filed in the same plan
   commit*, on the theory that a cut made in one tick is the coupling the
   directive is about, while entries that accrete against one section over
   many ticks are independent findings. This fits both observed cases: the
   waveMerge pair and the three `blockedBy` chains were each cut in one tick;
   GUARD-HANDLES accreted separately. Costs a fact the queue does not carry
   today (which tick filed an entry), so it needs a field or a `git log` read.

## What I would do

Option 4 if the filing-tick fact is cheap to carry, else option 1. The
false positive in option 2 is not hypothetical — it is standing in the queue
right now, and the repair it forces (pad `files`) actively degrades the
prediction the partitioner consumes. Option 3 buys little over the prose.

The deeper question option 4 exposes: *is `per.section` the right key at all?*
The coupling the directive is about is a shared mechanism, and `per.section`
is a proxy for it that a long section breaks. If the answer is "the key is
wrong", that is the architectural flag, not the gate's false-positive rate
(`.claude/rules/collaboration.md`, *Complexity is a signal, not a challenge*).
