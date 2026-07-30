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

## 2026-07-30 — 0.8 migration friction, second batch: asp-lens, carto, platform h2-env-pool (jeff pass, routed by operator)

Operator pre-triage against HEAD (reporters tested published 0.8.0; several items are fixed in unreleased HEAD — verify, don't re-derive):

1. **asp-lens: pendingGate pickable-only scope** — closed at HEAD by `fenceWhen` (11f2613), modulo verification: the predicate receives only the entry, so "exempt parked/deferred" is expressible (`entry.gate.kind` check) but full pickability (blockedBy-vs-shipped, capabilities) is not — confirm asp-lens's semantics ("parked entries may sit off-fence pending a ruling") are covered by the gate-kind form. Add a `fenceWhen` mention to MIGRATING-0.8 §3 and CHAIN-AUTHORING's gate section so migrating chains discover it instead of declining adoption.
2. **carto: root-pinned bay unrunnable, diagnostic contradicts filesystem** — same defect as temper's wedge, independently hit; core fixed at HEAD by 21ff4e5 (self-reference proceeds as authority). Residuals to route: (a) should `readPin` also consult `<flumeDir>/package.json` so a bay-manifest pin is first-class (temper raised the same), or should the guide rule the pin's home explicitly — small design call; (b) MIGRATING-0.8 gains a pin-placement bullet either way; (c) verify the arm-2 refusal text can no longer name a path where the install demonstrably runs.
3. **pendingGate: report both violation classes in one pass** — new: an entry carrying an undeclared field AND an out-of-fence path surfaces only the schema violation; the fence violation costs a second correction round (carto, observed). Collect both classes before failing.
4. **setupWorktree install options + gate manager-detection** — new, injection-point shaped: helper gains optional `{ args?: string[], env?: Record<string,string> }` (carto's predecessors passed `--no-audit --no-fund`, `CI=true` — paid ×N per fanout wave without it); builtin `tscGate`/`vitestGate` hardcode pnpm while `setupWorktree` already detects the manager from the lockfile — share the detection so npm repos stop forking the gates; `shellGate` gains an env option (carto scrubs `CARTOGRAPH_DB_URL` in a bespoke fork today).
5. **platform h2-env-pool: needs-rescope commit shipped as success** — reported high; operator analysis: the v0.7 §12 declared-files-diff guard is present in the v0.8.0 tag (`Dispatcher.ts` channel-only classification), and this symptom is the exact pre-§12 shape (8f11af9 class) — the job almost certainly ran under the machine's since-upgraded 0.6.2 global (third independent corroboration of the old-engine blind spot, see the parked handshake-audience question). Derivation should verify HEAD's guard covers their described drain-and-promote path (incl. blockedBy promotion off a channel-only commit) rather than assume regression. Their two riders, boundary-ruled: refuse-on-`needs-rescope`-subject is commit-message convention — the engine's mechanical guard (declared-files diff) is the fix and exists; state.md restamping is a chain-owned artifact the engine rightly doesn't know — platform's chain can restamp in its own ship-side handoff. Decline both at the engine, say why in the drain.
6. **platform: prompt inline-exec fails on Windows, ticks run blind** — new, real engine surface: `!`cmd`` blocks spawn as a single argv token via `/usr/bin/bash` (`node -e '...'` looked up as a literal filename) and `$FLUME_DIR` interpolates backslashed Windows paths into bash. Win32 bays get `<exec-failed>` digests every tick — which is what let finding 5 go unseen. Fix the spawn-through-shell mechanics + path quoting; their empty-cursor symptom is chain-side but note it in the drain.
7. **platform: brief.md open questions bypass the ledger at cursor-advance** — platform chain workflow (brief.md is not an engine concept); decline at the engine with the boundary rationale and return it to the platform chain's own backlog.

Handshake-audience update for the parked question's record: the operator's machine global is now 0.8.0 — live exposure closed on that machine; the structural ruling (trip-wire vs documented non-goal) still awaits the human.
