# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

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

## win32 inline-exec argv mangling — which fix, at which depth (inbox: NON-ASCII root cause)

**PARKED**

Root cause isolated and reproduced in this repo: `execFile("sh", ["-c", cmd])`
on win32 mangles any non-ASCII byte in the argv round-trip, so `sh` receives
the whole command as a program name and the span renders `<exec-failed>`.
Confirmed here — `.flume/prompts/plan.md`'s two em-dash inline-exec spans
both failed before the ASCII sweep in `2874c2c`. Quoting is innocent; only
non-ASCII content triggers it. `58be15d`'s ENOENT→shell-retry fallback
doesn't help — this isn't an ENOENT, `sh` runs fine, just on mangled input.

Harness-side mitigation already ships (prompts ASCII-swept, PROTOCOL.md's
interim rule, marked for retirement by this fix). This question is the
engine-lane fix underneath it.

Options:

1. **Encode the win32 spawn argv correctly** (UTF-8 codepage handling) —
   lands at the mechanism (engineering.md), but Node/Windows argv encoding
   is genuinely finicky; `58be15d` already misdiagnosed the model once
   before this repro corrected it.
2. **Pass the command via stdin or a temp script file** instead of argv —
   sidesteps the encoding issue entirely; larger change to the inline-exec
   invocation path.
3. **Lint inline-exec for non-ASCII at render, fail loud** — doesn't restore
   the capability (non-ASCII digests still can't run), just fails visibly.
   A floor, not a fix; entangled with the exec-failed question below.

Recommended: needs an empirical spike on (1) before committing — the repro
is already reduced to a one-line em-dash case (ships as the fix's test per
engineering.md), but the right Windows-API-level approach isn't obvious
without testing candidates against it.

## `<exec-failed>` renders and the prompt still sends — loud-or-nothing vs. shipped tolerance (inbox finding)

**PARKED**

`evaluateInlineExec` substitutes `<exec-failed cmd="...">stderr</exec-failed>`
for a failed span and the tick proceeds; `docs/CHAIN-AUTHORING.md` states
this outright and `tests/Prompt.test.ts` asserts it as correct behavior.
This is the one place flume's shipped behavior contradicts
`.claude/rules/engineering.md`'s "Loud or nothing" (no path proceeds over
an unresolved input) — measured cost: a Windows plan tick oriented on a
blinded digest for a full loop with nothing surfacing it.

Deliberate design affordance, not a slipped bug — reversing it deletes
shipped tests. Needs a human/product call before any code moves.

Options:

1. **Fail the tick** on any unresolved span — simplest, loudest; a
   transient digest command failure now costs a tick.
2. **Render but refuse to invoke the agent**, surfacing the failed spans —
   preserves the artifact for debugging; needs a new dispatcher exit path
   and a §6 no-commit classification.
3. **Chain-declared per-span tolerance** (`optional` inline-exec) — most
   flexible, passes the second-implementation test cleanly (engine reports
   the fact, chain owns the interpretation per engine-boundary.md), most
   surface to build.

Recommended: lean (3) per engine-boundary.md's fact/interpretation split,
but this is a product call on shipped, tested behavior — not plan's to
invent silently. Entangled with the win32 argv question above: whichever
wins there changes how often this path is even hit.
