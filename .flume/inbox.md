# Inbox — findings queue

Transient queue of findings awaiting triage by the plan phase. Append-only by external reviewers; drained-only by plan.

## Who writes here

- Humans dropping observations to be routed.
- Future review skills (e.g. multidim-review, security-review) when added.

**Plan does not write here.** Plan-tick self-audit findings go directly to `.flume/plan/pending.json` (file as entry), to `.flume/plan/open-questions.md` (parked for human input), or live only in the `plan:` commit message body (narrative + dispositions).

## Who reads here

The plan phase reads inbox.md every tick and drains each entry into one of three outcomes:

1. **File as a pending entry** in `.flume/plan/pending.json` (with a `per` cite to the relevant spec section).
2. **Park** in `.flume/plan/open-questions.md` if it needs human input before any code can land.
3. **Accept as debt** — note the disposition + one-line reason in the `plan:` commit message body.

After routing, the inbox entry is **removed**. The queue is meant to drain; it is not a log. Narrative history lives in git.

## Format

Each entry is a markdown subsection:

```
## YYYY-MM-DD — <short label> (<source>)

<finding body — observations, file:line cites, severity if known>
```

`<source>` is the writer (e.g. `human`, `multidim-review`). One subsection per finding cluster; group related items under one `##` to keep routing atomic.

---

<!-- entries below this line; newest first -->

## 2026-07-30 — temper 0.8.0 migration friction, two findings (temper agent, routed by operator)

Source: `temper/.flume/friction/session-flume08-{pin-handshake-wedge,pendinggate-pickability}.md`, from temper's completed 0.6→0.8 migration (`3a065c3a`). Operator-verified against flume src before routing.

1. **Pin-handshake wedge — severity high, published 0.8.0 blocks every repo-root-pinned bay.** `readLocalInstall`'s self-reference guard (`src/cli.ts:109`, added by 54d0d70 to prevent re-exec loops) returns `undefined` when the provisioned link's realpath IS the running engine — indistinguishable from "nothing provisioned" — so `engineHandshake` falls to the arm-2 pin refusal. Temper's empirical matrix (published 0.8.0, scratch bays): pinned + unprovisioned → refuse (documented); pinned + provisioned, invoked via the install → self-detect → refuse; pinned + provisioned, invoked via another engine → arm-1 re-exec, child self-detects → refuse. The final authority always sees itself: **no pinned layout can ever run** while `readPin` reads the repo root. "Provision the pinned install" (the refusal's own advice and MIGRATING-0.8's) is unsatisfiable. Fix direction (temper's, verified plausible): self-reference becomes a distinct outcome meaning "this invocation IS the provisioned install — proceed as authority" (skip re-exec AND skip the pin refusal), not a fall-through. Guide's §4 needs the same correction. Temper worked around it by moving the harness manifest into `.flume/` — a layout migration no doc mentions; every 0.6 bay pinned at repo root hits this wall on upgrade. After the fix ships: operator cuts 0.8.1.

2. **`pendingGate` can't express park-exempt fencing.** The builtin fence-checks every entry unconditionally; temper's hand-rolled gate deliberately exempts `parked`/`deferred` entries so plan can *record* work whose paths sit outside today's fence while a human decides whether to widen chain.ts. Under the builtin that park commit reverts — so temper declined adoption and carries a fork of the builtin whose only delta is one predicate. Requested: a `PendingGateOptions` pickability filter (`pickableOnly?: boolean` or `fenceWhen?: (entry) => boolean`) so such chains can adopt and retire forks. Note the boundary angle: fencing-what-when is arguably chain policy — the knob is the injection point.
