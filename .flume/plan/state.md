# State

Phase: **v0.1 + v0.2 lines both shipped/frozen.** Mode this tick: **inbox-drain** — human appended one finding (`.flume/inbox.md`, chaos-flume dogfood). No spec delta; no active derive target (no `RELEASE-v0.3.md`); pending stays `[]`.

## This tick — drained inbox item → OQ#4 PARKED (no pending entry)

Item: orphaned baton (awake flag names a phase the current chain doesn't declare) hibernates indistinguishably from a clean stop; reviewer proposed it as a 4th §5/§6 `NoCommitMode`.

**Verified at source, worse than reported.** `Dispatcher.ts:360-368`: no-match → `{hibernated:true, awakeAfter:[], summary:"awake flags reference unknown phases…"}`, orphaned flag never `baton.sleep`'d. `cli.ts:206` → exit **0** (==clean hibernate). `superviseLoop` (`Dispatcher.ts:1249`) only stops on `baton.hibernating()`=`awake().length===0` (`Baton.ts:57-59`) → flag still on disk → **never stops**; hot-spins to `--max`, host relaunch → unbounded. Tick *claims* hibernation; supervisor structurally can't honor it.

**Routing: PARKED as OQ#4, not filed.** Two independent each-sufficient blockers: (1) no active spec line (v0.1 + v0.2 both frozen, no v0.3) → no `per` cite; (2) **architectural-misstep flag raised** (collab rule "Caveat — architectural missteps"): inbox's "fits §5/§6 union" is a category error — §5/§6 are per-entry agent-ran no-commit *work* outcomes; orphaned-baton is upstream of agent invocation (no phase picked). Shipped contract already excludes it on purpose: `TickOutcome.noCommit` doc `Dispatcher.ts:277-278` "Absent when … ran no agent (nothing pickable)".

**Architectural correction recorded in OQ#4 (user-requested, web-grounded — don't re-derive):** 3 outcome axes — A work/retryable (§5/§6 channel), B clean-quiescence (exit 0 / `hibernating()`), C precondition/config-error (deterministic, non-retryable). Orphaned-baton is **Axis C**, joins §3's `failed`/exit-axis (today only half-built — §3 exits 1, orphaned-baton mis-routed onto B/exit-0). Cites: `sysexits.h` `EX_CONFIG`(78) distinct-exit-class convention; k8s `CreateContainerConfigError` (config, non-retriable, no backoff) vs `CrashLoopBackOff` (runtime, retried) + Pod failure policy fail-fast; poison-pill/dead-letter (silent-ack = ruled-out worst option). Root-cause flag: `superviseLoop`'s sole stop = `baton.hibernating()` reading disk structurally cannot represent "baton non-empty AND unrunnable" — Axis-C stop must come from the child **exit signal**, not the broken disk state. Buildable surface (once specced) is small + `src/`-local (`TickOutcome` field, `cli.ts` exit branch, `superviseLoop` stop, tests) — fully build-derivable, no off-allowlist edit (unlike OQ#1).

## Queue (0)

pending `[]`. Nothing derivable — no spec section authorizes Axis-C work; awaits human spec call (OQ#4 disp A: open `spec/RELEASE-v0.3.md`).

## Active plan target

**None.** `spec/RELEASE-v0.1.md` (frozen), `spec/RELEASE-v0.2.md` (shipped/frozen). No `RELEASE-v0.3.md` → no derive target. Plan hibernates until a human adds/edits a `spec/RELEASE-*.md` or appends `.flume/inbox.md`.

## Open questions

**4.** OQ#4 (NEW this tick — orphaned-baton Axis-C; PARKED, needs human spec call: v0.3 line vs reopen-v0.2). OQ#1 (§7a chain.ts gate-move, PARKED human/`chore(flume):`), OQ#2 (v0.1.2 worktree surface — note: `4187f44`/`eae1ce9` recorded it as RELEASE-v0.2.md §1a; OQ#2 text may now be closeable next spec-delta tick, not re-litigated here), OQ#3 (v0.1.1 tag vs CHANGELOG, PARKED) — all byte-unchanged this tick.

## Writable-paths / trunk

- Wrote `.flume/plan/open-questions.md` (OQ#4 added) + `.flume/inbox.md` (entry drained → empty queue) + `.flume/plan/state.md`. `pending.json` already `[]`, not re-touched. No off-allowlist path.
- Trunk: HEAD `eae1ce9`. Plan-artifact-only tick, no code change. tsc not re-run (no `src/` delta).

Plan continues: no
