# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## PLAN-SHOULDRUN — wire Phase.shouldRun into the plan phase (chain.ts amendment)

**PARKED**

`Phase.shouldRun` shipped this delta (v0.11 §8, 80cf11d) — the capability
is literally motivated by "plan concludes hand-to-build with no derive
needed" (measured 28% of ticks, docs/CHAIN-AUTHORING.md's own
`hasUnplannedChanges` example). `.flume/chain.ts`'s `plan` phase
(chain.ts:316-375) declares no `shouldRun`, so plan is still invoked on
every wake even when nothing changed since the last `plan:` commit. A prior
tick was a live instance: an earlier invocation did an exhaustive audit,
found the tree byte-identical to the last plan commit, and voluntarily
bailed with no commit — a cost `shouldRun` exists to avoid.

`.flume/chain.ts` sits outside every phase's writable lane
(`.claude/rules/spec-plan-build.md`; chain.ts:176-179: "harness surfaces
... are outside every phase lane"), so this can't become a pending entry —
it needs a human edit to chain.ts itself.

Options:
1. **Wire `shouldRun` on `plan`.** Decline when: spec-delta is empty, inbox
   is empty, no `blockedBy` entry is newly unblockable, and pending-now has
   no pickable entry to promote-check — mirroring, ahead of invocation, the
   same no-op condition a bail already reaches post-hoc. The sweep
   dimension complicates this: it can still have real work (next
   neighborhood) even when derive/drain/promote are all quiet, so a naive
   predicate would wrongly decline a tick the sweep needed. The predicate
   needs to either read the sweep frontier synchronously too, or `shouldRun`
   only ever declines when pending-now already carries a pickable entry
   (sweep yields to pickable work anyway, so that path is always real
   build-handoff work, never a sweep tick) — narrower but simpler, and closes
   the exact case this tick hit (pending-now empty is the case with no
   engine-verifiable "nothing changed" signal).
2. **Leave undeclared.** A no-op invocation already exits cheap (voluntary
   bail, no commit) — `shouldRun` is new, proven only in its own test
   suite, not yet in this repo's own loop.

Recommended: lean toward (1), scoped to the narrower predicate — decline
only when pending-now has no pickable entry AND no dimension trigger fired
(spec-delta empty, inbox empty, no promotable blockedBy) — since that's the
one case a purely-mechanical check on already-injected context can decide
without duplicating the sweep's own frontier logic.

## pendingGate — report both violation classes in one pass (inbox finding 3)

**PARKED**

`pendingGate` (`src/builtinGates.ts:321-390`, v0.8 §6, drifted from :304-367
by intervening inserts) calls `parsePending`,
which is all-or-nothing over the whole entry array (`z.array(...).safeParse`)
— a single entry's schema violation (e.g. an undeclared field) fails the
entire parse with no `entries` to fence-check, so a sibling entry's fence
violation only surfaces after the schema issue is fixed, costing a second
correction round (carto, observed). `parsePendingLoose` already exists as a
lenient sibling but is documented read-path-only (status-class commands)
and is itself still all-or-nothing at the array level — it doesn't solve
this.

Options:

1. **Partial per-entry parse mode** (some entries ok, some errored, in one
   pass) — changes `parsePending`'s return contract, a real semantics
   change beyond `pendingGate` itself.
2. **Keep fail-fast, improve the message** to note that fence violations
   may exist among the unparsed entries and will surface next round —
   cheap, no semantics change, doesn't actually collect both classes.
3. **Leave as-is.** Two-round correction is a UX cost, not a correctness
   defect — no entry ever ships without both checks eventually passing.

Recommended: lean (3) unless the two-round cost proves expensive in
practice — (1) is disproportionate machinery for a UX papercut, (2) barely
helps. Every real fix here is heavier than the problem it solves
(collaboration.md's complexity signal).

## setupWorktree install-options surface (inbox finding 4, narrowed)

**PARKED**

`setupWorktree(dir)` (`src/setupWorktree.ts`) takes no options — install
commands are hardcoded arrays; v0.7 §11's acceptance/non-goals text locks
the exact `pnpm install --frozen-lockfile` / `npm ci` shape with no options
surface.

The gate half of this question shipped: `BUILTINGATES-PNPM-HARDCODED-NO-OVERRIDE`
(86789b8/48a87df, cites `engine-boundary.md`'s *Capability vs convention*)
gives `tscGate`/`vitestGate`/`eslintGate` an optional `cmd` override the
chain supplies directly. A prior tick's audit found the override only closes
the gap for pnpm/yarn-classic-shaped tools — args stay hardcoded to the
bare-bin invocation, so `{cmd:"npm"}` fails npm's own "Unknown command" for
tsc/lint; filed `BUILTINGATES-CMD-OVERRIDE-PNPM-SHAPED-ARGS` to close that.
What remains open here is `setupWorktree`'s own missing options surface (no
`{ args?, env? }` of any kind today) — that one still needs a human call on
whether it's spec-worthy.

Options:

1. **Spec amendment.** Extend §11 with an optional `{ args?, env? }` on
   `setupWorktree` — becomes a normal derive-from-spec entry once written.
2. **Decline, chain-side workaround.** A chain wanting `--no-audit
   --no-fund` or `CI=true` can already wrap `setupWorktree` itself.

Recommended: (2) unless a real chain hits the need — the sharper duplication
smell (gates hardcoding `pnpm` with no override at all) is gone now that
the cmd override shipped; what's left is a wrap-it-yourself gap, not an
asymmetry.
