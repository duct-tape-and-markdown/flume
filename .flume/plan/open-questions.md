# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Engine-ownership requests from centercode-platform's chain (PARKED)

**Status:** PARKED — no spec authorizes this work; needs a human decision on
whether/how to scope an engine-hardening line before plan can derive entries.

**Context:** `.flume/inbox.md` carried four requests (routed out of inbox this
tick, parked here instead) from centercode-platform PR #670: chain code
deleted in favor of "the engine should own this truth." All four are real
(cited evidence, not speculative), but each is a `src/` architecture change
with no citable `spec/RELEASE-*.md` section — plan cannot originate a pending
entry without one (`spec-plan-build.md`: spec is human-authored; plan derives,
it doesn't invent). Recommend: author a `spec/RELEASE-v0.7.md` (or fold into
whatever the next line is) scoping which of these ship and in what order.

1. **Engine validates pending.json against its own schema at plan-commit
   gate.** Kills ~30 hand-rolled lines per chain (`parsePending` already
   exported). Evidence: caught a real malformed-pending revert in
   centercode-platform's 2026-07-24 rehearsal.
2. **Engine pre-checks planned entry paths against the next phase's
   writablePaths, at plan commit.** Same law the build-time write guard
   already enforces; a second hand-rolled glob matcher risks drifting from
   the engine's own semantics (centercode-platform carried and then cut a
   duplicate).
3. **`GateContext` exposes `repoRoot`.** Smallest of the four — kills a
   `git rev-parse --show-toplevel` + fallback helper every gate reinvents.
   Lowest risk, no behavior change, good first candidate if the line gets
   trimmed.
4. **A tick that throws halts the loop; `flume job run` propagates non-zero
   when it shipped nothing because ticks failed.** Currently a chain that
   can't load burns every tick in a `--max` run and still exits 0 — real
   product risk (silent CI green on a dead chain). Needs a design call: what
   distinguishes "ran, settled" (0) from "couldn't run" (non-zero), and
   whether "halts the loop" means the whole `job run` or just that tick's
   supervisor iteration.

**Options:** (a) one `spec/RELEASE-v0.7.md` covering all four as an
engine-hardening line; (b) ship #3 alone as a same-line micro-patch (lowest
risk, smallest surface) and spec the rest separately; (c) decline some/all as
out-of-scope for flume's engine and leave them as chain-level conventions
documented in centercode-platform instead. No recommendation forced — #2 and
#4 both touch dispatcher/loop semantics non-trivially and deserve scoping
before any code lands.
