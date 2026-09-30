# The CI lanes go dark exactly while the loop is productive

CI was red for five days — 64 consecutive red `ci.yml` runs, last green
2026-09-25T19:16Z — and no plan tick filed a thing against it. The lane
mechanism worked as specified the whole time.

## Why nothing reached the queue

`spec/harness.md`, *CI lanes as a findings source* makes a lane readable only
when its newest completed run sits on the tree's own tip. Every plan-inbox
prompt this week rendered both lanes `UNREAD`:

> the newest completed run of ci.yml for branch main — run 36745870387 — was
> made on commit 88061fd8…, and this tree's tip is 157674b0…, so that run
> judged another tree and neither a green nor a red off it is this tip's.

A run takes ~20 minutes; the loop commits every few minutes. So the newest
completed run is **never** on the tip, and a declared lane files nothing for
as long as the loop is productive — precisely when it is needed. The findings
source is available only when the loop is idle.

The rule's reason is sound: a stale run must not read as current. Its
consequence is that the reading is unobtainable under load.

## The fork

**(a) Keep tip-equality, both directions.** Status quo. Honest, and dark
under load. The lane is then only ever drained by a human noticing, which is
what happened here — via the inbox, five days late.

**(b) Asymmetric staleness: a red is standing until something clears it, a
green still needs the tip.** Read a failing title from a run on an *ancestor*
of the tip as still standing, until a run at or after the fixing commit says
otherwise. Green keeps today's bar, so nothing is ever *closed* off a stale
run. This is the record's own suggestion. It matches how a red actually
behaves — a failing test on an ancestor stays failing unless something
touched it — and the harness can check that cheaply: `git log <run sha>..HEAD`
over the files the titles live in. Risk: a red fixed by a commit the search
does not attribute keeps being re-filed, which the `drainedRuns` stamp
already damps.

**(c) Hold the loop for a lane.** Make an unread lane a reason not to
dispatch. Rejected on its face — it prices every finding at a 20-minute
stall — but naming it since it is the only option that preserves strict
tip-equality *and* keeps the lane live.

I lean **(b)**: it is the only option that keeps the source alive under load
without inverting the loop's economics, and its asymmetry is the real
asymmetry between a red and a green.

## The second half: build cannot prove a win32 fix

Eight of the nine failing titles are the `windows` job's. The five entries
filed off this record all carry **no `tests[]`**, and not by choice: build's
gates run on the build host (linux), so a win32-only case either is
`describe.runIf(process.platform === "win32")` and skipped, or passes on
posix for a reason the defect does not reach. The judge cannot red any of
them on the base, which is the bar `.claude/rules/engineering.md`, *A fix
ships the test that would have caught it* sets.

So every win32 fix this loop ships is unproven until CI says otherwise — and
per the first half, CI only says so when the loop goes quiet. The two halves
compound.

Options, needing the same ruling:

1. **Name it the declared exception.** `engineering.md` already allows a fix
   whose regression cannot be pinned decidably to say so out loud. Make
   "win32-only, verified by the `windows` lane" that sentence, once, in a
   rule rather than in each entry's `notes`.
2. **Make the lane the gate.** A win32 entry ships, and the `windows` lane's
   next run is what closes it — which requires (b) above to be readable at
   all.
3. **A win32 runner for build.** Correct and expensive; out of scope for the
   v0 line, but it is the only option that puts the proof where the fix is.

I lean **1 + 2** together: 1 is a one-paragraph rule edit, 2 falls out of (b).
