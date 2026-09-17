# The pid-recycling fact lives in a test helper, not in `platform-facts.md`

A reaped pid goes straight back into the host's allocation pool, so a pid
harvested from a child that just exited can name a stranger by the time the
reclaim under test reads it. The `windows` lane recycles soonest, which is why
only that lane reds. This has now cost two CI runs and two drains: the
loop-lock reclaim case at run 35162590336, and the `flume status` stale-pidfile
case at run 35163992613 — the same defect, a second site.

The fix shipped (86735902): `tests/helpers/deadPid.ts` is the one door, minting
a pid above every host's range and probing it at every mint. But the *fact*
now lives in that helper's header — a code comment carrying a platform fact,
which CLAUDE.md says the harness should own instead, and which only an agent
who already opened that file ever sees. `.claude/rules/platform-facts.md` is
the declared home and carries no pid entry today. Neither plan nor build can
write there; this file is the ask.

Proposed entry, if you want it written:

> **## A reaped pid returns to the host's allocation pool**
> Never plant a "dead" pid harvested from a child that just exited — between
> the harvest and the read under test the number can name an unrelated live
> process, and the liveness check refuses with nothing wrong in the code. Mint
> one above the host's range and probe it with signal 0 at the point of use
> (`tests/helpers/deadPid.ts`). win32 recycles soonest.

With that in place, the helper's header shrinks to a pointer in the same
commit (`.claude/rules/engineering.md`, *Narration is the ladder's bottom
rung*) — case-specific reasoning stays, the fact cites the page.

One thing the ask does **not** cover, recorded here so the answer is informed:
eight sites reached for the harvest idiom independently before anything caught
it, and nothing mechanical stops a ninth. No decidable scan separates a
dead-holder plant from `tests/processTree.test.ts`'s legitimate live-child pid
reads, so the one-door helper and its loud refusal are the whole defence
either way — the page entry is what makes the reason survive the next reader.

Raised by the build note on A-STALE-PID-IS-NEVER-A-JUST-EXITED-PID.
