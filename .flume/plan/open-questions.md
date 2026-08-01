# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## `flume loop`'s tip claim can't literally go "gone after SIGTERM" on win32 (v0.11 §4)

**NEEDS AMENDMENT**

CI run 30675682946 (windows): tests/cli.test.ts's "claim file (and loop.pid)
are gone after SIGTERM" is red. `process.kill` SIGTERM on Windows maps to
`TerminateProcess` — no exit/signal handler runs, so the claim file and
`loop.pid` survive by construction, on every Windows process, not just
flume's. §4's stale-reclaim path (dead-pid liveness check on next acquire)
already covers the mechanism a lost release needs: a stale claim is unusable
by anyone but the next acquirer, who reclaims it. What can't be true on
win32 is §4's literal acceptance text — "gone after SIGTERM" assumes a
handler runs, which win32's `TerminateProcess` semantics rule out
categorically. Not an engine gap; a platform fact, same shape as the
already-parked "flume status last commit" question below.

Options:

1. **Amend §4's acceptance to a win32-conditional form** — "claim file gone
   after clean exit and after SIGTERM on POSIX; reclaimed as stale (not
   necessarily removed) after SIGTERM on win32." The test then asserts the
   platform-appropriate outcome and goes green for a true reason.
2. **Leave the spec text as-is, exempt win32 in the suite only**
   (`it.skipIf`). Spec keeps a claim only POSIX satisfies; a wrong invariant
   stands unflagged.
3. **Force cleanup on win32 anyway** (a supervisor process, a Windows job
   object). This repo's win32 story elsewhere (`core.longpaths`, spawn
   discipline) sticks to Node/OS-native mechanisms; building a supervisor to
   route around an OS primitive designed to prevent exactly this is the
   "complicated solution chasing a tail" `collaboration.md` warns against.

Recommended: (1) — the stale-reclaim mechanism is the actual cross-platform
guarantee; the acceptance text should say what's true per platform instead
of a claim only POSIX satisfies. Once amended, the test-expectation fix
(win32-conditional assertion) is mechanical and files as a normal entry
citing the amended section.

## `flume status` — v0.1 §3's "last commit" leg was never shipped

**NEEDS AMENDMENT**

`spec/RELEASE-v0.1.md:72` says `flume status` prints "awake phases, pending
entry count, last commit". The pending-count leg shipped
(STATUS-PENDING-COUNT-UNSHIPPED, `c982316`/`8bb2061`) — `HELP_TOP`,
`HELP_SUB.status`, and `docs/CLI.md` now agree on it, and the count reads
identically to `flume job status` via the shared `readPendingLoose` probe.
Only "last commit" remains unshipped, and it is still not fileable: §3 names
no format, no purpose, and no exit semantics for it, and nothing downstream
cites it.

Options:

1. **Print `<short-sha> <subject>` for HEAD.** Closest to the spec's words.
   But `status` is the baton surface, and this is git's answer to a git
   question — `engineering.md`'s *Derived state is computed, never restated
   beside its source* names "a HEAD sha beside git" as the shape to avoid.
   It also gives `status` its first failure mode outside `.flume/` (a
   detached HEAD, a fresh repo with no commits) on a command specced to
   always exit 0.
2. **Drop the clause from §3.** `git log -1` already answers it, and every
   real consumer of `status` (the §17 liveness line, the friction count, the
   v0.8 §4 capability lines) is about harness state git cannot report.
3. **Behind a flag** (`status --verbose`). Keeps the option without taxing
   the common path — but invents CLI surface no one has asked for.

Recommended: (2), with §3's sentence amended to name what `status` actually
owes: awake phases, pending entry count, supervisor liveness, and the
chain-declared extras. That makes the section describe the shipped surface
instead of a three-item list two-thirds of which drifted. (1) is defensible
if the intent was a one-glance "where am I" line — if so, say so in §3 and it
becomes a normal entry.

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

## setupWorktree install-options surface (inbox finding 4, narrowed)

**PARKED**

`setupWorktree(dir)` (`src/setupWorktree.ts`) takes no options — install
commands are hardcoded arrays; v0.7 §11's acceptance/non-goals text locks
the exact `pnpm install --frozen-lockfile` / `npm ci` shape with no options
surface.

The gate half of this question is already in flight and no longer needs a
spec amendment: `BUILTINGATES-PNPM-HARDCODED-NO-OVERRIDE` (pending, cites
`engine-boundary.md`'s *Capability vs convention*) gives `tscGate`/
`vitestGate`/`eslintGate` an optional `cmd` override the chain supplies
directly — a capability injection point, not auto-detection, but it closes
the "chain can't reuse these builtins at all" gap without touching §11.
What remains open is `setupWorktree`'s own missing options surface (no
`{ args?, env? }` of any kind today) — that one still needs a human call on
whether it's spec-worthy.

Options:

1. **Spec amendment.** Extend §11 with an optional `{ args?, env? }` on
   `setupWorktree` — becomes a normal derive-from-spec entry once written.
2. **Decline, chain-side workaround.** A chain wanting `--no-audit
   --no-fund` or `CI=true` can already wrap `setupWorktree` itself.

Recommended: (2) unless a real chain hits the need — once
`BUILTINGATES-PNPM-HARDCODED-NO-OVERRIDE` ships, the sharper duplication
smell (gates hardcoding `pnpm` with no override at all) is gone; what's left
is a wrap-it-yourself gap, not an asymmetry.
