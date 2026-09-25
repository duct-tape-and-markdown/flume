# What lifetime does a quarantine hold have?

`spec/loop.md`, *Repeated identical failures — quarantine, then abort*, gained
the gate-stage lift this line ratified (`63a365f8`). Two things the sentence
does not say had to be decided at the site to ship it, and both are declared in
the code with a cite rather than settled.

## Fork 1 — the merge stage is named by neither arm

The section names two: a **gate**-stage hold "lifts once the tip has moved past
the tick that placed it, because the world that gate judged is gone"; a
**provision**-stage hold "stays for the run, since nothing on trunk changes
what a worktree could not provision". A **merge**-stage hold is named by
neither, so it keeps the run-scoped default and says so at
`src/loopSupervisor.ts:512`.

The gate's own reason reaches merge: a cherry-pick conflict is a verdict over
one trunk, and a moved trunk is a different pick. The provision reason
explicitly does not reach it. So today's behaviour is the one arm whose stated
reasoning argues against it.

- **Name merge beside gate** (lifts on a moved tip). Cost: an entry whose
  conflict is genuinely its own — two entries that really do overlap — retries
  once per landed sibling. The consecutive-identical-failure backstop still
  bounds that, at one agent span per retry.
- **Name merge beside provision** (stays for the run). Cost: a conflict against
  a trunk that has since moved holds an entry a fresh pick would land.
- **State the silence as deliberate**, with the reason.

**I would name it beside gate.** A pick is a verdict about a tree, and the tree
is gone. But the cost is paid in agent spans, so it is your call, not a
mechanical one.

## Fork 2 — "moved past" is read as "differs from"

The supervisor holds no ref of its own. Its only tip fact is the `headSha` each
child's verdict reports (`src/loopSupervisor.ts:672`), and the lift compares
`hold.tip === latestTip` (`:519`). Under `supervisorPolicy.maxTicks > 1` two
children can settle out of order, so `latestTip` can move *backwards*: a hold
placed at the newer tip then lifts against an older sibling's report, and
symmetrically a hold can stand while the real tip has moved.

Lifting early is the safe direction — the entry is retried, the backstop bounds
the burn — but "moved past" is an ordering claim and inequality is not an order.

- **(a) Ratify the inequality in the sentence**: "lifts once the newest tip a
  verdict reported differs from the one the placing tick reported." No code
  change; the approximation stops being one, and the supervisor keeps its
  design property of reading no ref.
- **(b) Resolve ancestry against the ref.** `isAncestor` is already exported
  from `src/git.ts` and `flume status` already reads refs, so `isAncestor(hold.tip, tip)`
  is exactly "moved past" and is durable disk evidence
  (`engine-boundary.md`, *Told, not inferred*: "Evidence must be durable").
  Cost: the supervisor gains a git read it was deliberately built without
  (`:456` declares that), and the live tip races the next fill anyway under two
  children.
- **(c) Give the engine a tip fact with an order on it** — a per-run counter,
  or each child reporting its base beside its end. The faithful answer, and the
  largest surface.

**I would take (a)**, unless out-of-order lifting has a consequence worth (c):
the approximation errs in the safe direction, and (b) buys exactness by adding
a dependency the component was designed without.

**Flag before you answer (c):** if ordering genuinely matters here, the thing to
revisit is the supervisor's "children report the only tip facts" design, not
this one predicate — the architectural-misstep caveat in
`.claude/rules/collaboration.md`, *Inform before parking*.

**The ask:** one answer per fork. Both are one sentence in one spec section, so
they can be ratified together; (b) or (c) on fork 2 becomes a pending entry.
