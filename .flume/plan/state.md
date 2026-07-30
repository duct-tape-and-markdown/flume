# State

Phase: v0.7 mostly shipped (§10 amendment's job-run-form gap landed
this delta; a narrower validation gap in that same fix found on
audit); v0.8 boundary line (§§2-8) still queued. Mode: **audit**
(commit-delta only; no spec-delta, empty inbox, no promotable
blockedBy entries this tick).

## Queue (11)

1. `ENGINE-PIN-HANDSHAKE-JOBRUN-MAX-VALIDATION` — open (v0.7 §10, audit finding)
2. `STATUS-SUPERVISOR-LIVENESS` — open (v0.7 §17)
3. `DROPLASTCOMMIT-TIP-OWNERSHIP` — open (v0.7 §17)
4. `SUPERVISOR-PROVISION-QUARANTINE` — open (v0.7 §16)
5. `PENDING-SCHEMA-CORE-EXTENSION-SPLIT` — open (v0.8 §2)
6. `REQUIRES-CAPABILITY-GENERALIZATION` — open (v0.8 §4)
7. `TICK-VERDICT-ARTIFACT` — open (v0.8 §5)
8. `TAG-GRAMMAR-MECHANICAL-SAFETY` — blockedBy #5 (v0.8 §3)
9. `PENDING-GATE-BUILTIN` — blockedBy #5 (v0.8 §6)
10. `SUPERVISOR-POLICY-KNOBS` — blockedBy #4 (v0.8 §8)
11. `SECOND-REFERENCE-CHAIN` — blockedBy #8 (v0.8 §7)

## Open questions

0.

## Trunk

HEAD `775080a` at this pass's start; tree otherwise clean besides
untracked `.flume/loop.pid` (live supervisor artifact, not a plan
concern). `.claude/rules/collaboration.md` and `.flume/prompts/plan.md`
still carry uncommitted operator edits outside plan's writable paths —
not this tick's to commit.

Audited `544c963` (job-run-form fix) against v0.7 §10: `handshakeJobRunName`
correctly recovers `<name>` for the common `job run <name>` [--max N]
shapes, matching main()'s rewrite (~813-825) precedence and
`words.length === 1` bound. Gap: it splices the `--max`+value pair
unconditionally, without validating the value is present and
non-dash-prefixed the way the real rewrite does before reading `name`.
A malformed `--max` (missing or dash-prefixed value) followed by a
valid-looking name still yields that name to the handshake, which the
real dispatch would instead reject with usage error 2 — misrouting
arm 1 into that job's local install on a command that never resolves
a job at all. Filed as `ENGINE-PIN-HANDSHAKE-JOBRUN-MAX-VALIDATION`.
Files/scope of `544c963` otherwise match its shipped entry, no other
drift.

Plan continues: no — commit-delta audited clean apart from the one
finding filed; no spec-delta, inbox empty, no blockedBy entries
unblocked this pass.
