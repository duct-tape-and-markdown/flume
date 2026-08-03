# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## pendingGate — report both violation classes in one pass (inbox finding 3)

**PARKED**

`pendingGate` (`src/builtinGates.ts`, v0.8 §6) calls `parsePending`
(`src/PendingSchema.ts`), which is all-or-nothing over the whole entry
array (`z.array(...).safeParse`)
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

## ENGINE-BRANCH-VERBS-VS-NAVIGATION-RULING

The navigation doctrine (`spec/loop.md`, *The engine records, never
navigates*) states: "The engine never runs `checkout` or `branch`, and ships
no branch grammar." The engine does both. `git.addWorktree` runs
`worktree add -B <branch>`; `git.deleteBranch` runs `branch -D`; and
`Dispatcher.createWorktree` constructs the grammar itself —
`flume/<namespace>/<slug>`, or `flume/<slug>` unnamespaced.

The `cherry-pick` half of this ruling was already amended once (d604d55) to
declare fanout's merge as a named carve-out rather than leave it an unnoticed
violation. The branch half was not, and it is the same shape: ephemeral refs
the engine creates, uses, and deletes inside one wave, which no operator ever
sees or chooses.

Needs a human call because it is a doctrine question, not a code question —
nothing is broken either way, but the corpus currently says one thing and
ships another.

Options:

1. **Ratify as a second carve-out.** Amend the ruling the way cherry-pick was
   amended: the prohibition scopes to refs the *operator* chose, and the
   engine's own ephemeral `flume/**` names are recording, not navigating.
   Cheapest, and consistent with how the first carve-out was settled. The
   spec text already reads this way pending the call.
2. **Tighten the ruling's wording instead.** Say the engine never runs
   `checkout`, and never touches a ref outside `flume/**` — which is
   checkable, and would let a gate or sweep lens enforce it rather than
   leaving it prose.
3. **Remove the branch usage.** `worktree add` can operate on a detached
   HEAD, so the `-B` and the grammar could go. Real work, and it would cost
   the readable `git worktree list` output the branch names currently give an
   operator mid-wave.

Recommended: (2). It ratifies the same behavior (1) does, but states the
condition rather than the exception — so the claim becomes something a sweep
can evaluate instead of prose that drifted once already
(`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*).
