# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## plan's delta window can drop a spec change permanently

**PARKED**

`spec/RELEASE-v0.10.md` landed in `c88925a` (10:57:14). The plan tick already
running committed `7080d7d` (10:58:53) with a delta snapshotted before it, so
it saw no spec change and derived nothing — correctly, on its inputs. The next
tick's window is `7080d7d..HEAD`, which excludes `c88925a` by construction. A
whole release line became invisible to the mechanism while `Plan continues:
yes` reported a healthy sweep on top of it. Caught only by reading `spec/`
against the plan-commit history by hand.

This is a correctness defect in the derive dimension, not a papercut: the
harness reported a clean delta while dropping a release line. Second
occurrence of the shape — `28df0d5` audited a mid-tick `chore(flume):` commit
the same way — but commits stay visible to `git log`, so that one self-healed.
A spec change does not.

The delta is computed in `.flume/prompts/plan.md:3-13` (three inline-exec
spans, each keyed on `git log --grep='^plan:' -n 1`). That is chain surface:
plan's `writablePaths` do not reach `.flume/prompts/`, and neither do build's.
Any fix here is a `chore(flume):` commit — which is why this is a question and
not an entry.

Options:

1. **A derive stamp plan controls**, mirroring `posture-sweep.md`'s
   `Posture swept through: <sha>`. State.md carries `Spec derived through:
   <sha>`; the spec-delta span diffs against that, advanced only when a
   derivation closes. Immune to the mid-tick race because plan writes it
   after the fact rather than inferring it from commit order.
2. **Compute the delta at commit time rather than tick start.** Narrows the
   race window; does not close it, since the agent has already reasoned on
   the stale digest by then.
3. **Prose convention** — a prompt paragraph telling plan to check `spec/`
   against plan-commit history every tick. Bottom rung of the ladder, and
   `engineering.md` says so outright; it is also the defence that already
   failed here.

Recommended: (1). It is the pattern this repo already proves for exactly this
problem, and it puts the cursor under the phase's own control. Worth noting
the same race applies to `<commit-delta>` and `<pending-now>`; a stamp fixes
only the spec leg, so whether the other two want the same treatment is part
of the call.

## pendingGate — report both violation classes in one pass (inbox finding 3)

**PARKED**

`pendingGate` (`src/builtinGates.ts:243-306`, v0.8 §6) calls `parsePending`,
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

## setupWorktree/gate install-options & manager-detection sharing (inbox finding 4)

**PARKED**

`setupWorktree(dir)` (`src/setupWorktree.ts`) takes no options — install
commands are hardcoded arrays; v0.7 §11's acceptance/non-goals text locks
the exact `pnpm install --frozen-lockfile` / `npm ci` shape with no options
surface. Separately, `tscGate`/`vitestGate`/`eslintGate`
(`src/builtinGates.ts:111-143`) hardcode `cmd: "pnpm"`, independent of
`setupWorktree`'s own lockfile-sniffing — no shared detection helper
exists, and no spec section covers gates auto-detecting the package
manager (v0.1 §2's public-API list names the gates, not this behavior).

Options:

1. **Spec amendment.** Extend §11 with an optional `{ args?, env? }` on
   `setupWorktree` and describe a shared manager-detection helper the
   pnpm-hardcoded gates adopt — becomes a normal derive-from-spec entry
   once written.
2. **Decline, chain-side workaround.** A chain wanting `--no-audit
   --no-fund` or `CI=true` can already wrap `setupWorktree` itself; a
   chain wanting non-pnpm `tsc`/`vitest` can hand-roll `shellGate`.

Recommended: (1) — the asymmetry (`setupWorktree` already detects the
manager, the gates don't) is a real duplication smell per
engine-boundary.md — but the exact options shape is a spec author's call,
not plan's to invent silently.
