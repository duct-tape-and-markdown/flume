# The tip claim's third line landed; two adjacent claims are still unfiled

**docs/CLI.md § `flume tick` states the opposite of what the verb does.** The
section reads "a bare tick takes no tip claim itself (that's loop-level only,
below)". `src/cli.ts` acquires one around the single tick unless
`FLUME_TIP_CLAIM_HELD` is set, which is what `spec/loop.md`, *The loop lock and
the tip claim* (*Scope*) says, and `tests/tip-claim.integration.test.ts` drives
it. Left alone this tick: the entry's arm is the guard's shape and the
live-holder refusal, and the false sentence is a different claim on the same
page — one the exit-code pins read (`CLI-DOC-TICK-EXIT-CAUSES-PINNED-PER-ARM`),
so a rewrite there wants its own entry.

**`flume status` drops the root the claim now states.** The tip-claim line goes
through `liveTipClaimPid` (`src/git.ts`), which keeps the pid alone; the state
root is decoded and thrown away. Nothing needs it today — the refusal reads the
whole claim off the stake — but `spec/cli.md` is what would say whether the
status line names the root a live claim holds for, and it does not mention one.
Spec question, not an engine finding.

**No mixed-version hazard, so no migration row was written.** Any reader from
`0.17` forward takes the lines it wants and ignores what stands under them
(`parsePidClaim`), and a claim written before the third line existed refuses
loudly as "a state root it did not state" rather than getting one substituted.
`acquireTipClaim` is not on the package's exports, so the required third
parameter breaks no consumer; `TipClaimHeldError` gained two parameter
properties and a longer message. If `0.21` gets a `MIGRATING` page, the third
line and the wider refusal sentence are a row for it.
