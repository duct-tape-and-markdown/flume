# The `windows` lane block named a run its own reader does not select

`spec/harness.md`, *CI lanes as a findings source*: the slice "reads the
latest completed run of the declared workflow job for the tip's branch
through the forge's CLI". This tick's `<ci-lanes>` block did not.

## What the block said

- `windows` (ci.yml, job `windows`): **FAILING**, run `34619272992`, branch
  main, created `2026-09-11T15:58:32Z` — and it named that run as what woke
  the slice. The failing job's log rendered empty.
- `posix` (ci.yml, job `ci`): **GREEN**, run `36100206649`, branch main,
  created `2026-09-25T05:49:50Z`.

Two lanes, one workflow, one branch, thirteen days apart.

## What is true

Run selection in `readLaneStatus` (`harness/ci.ts`) does not read `lane.job`
at all — it is `gh run list --workflow <wf> --branch <branch> --status
completed --limit 1`, and `lane.job` is only applied afterwards to pick a job
out of the run it already chose. Two lanes on the same workflow and branch
therefore **cannot** name different runs. Measured this tick:

- That exact query, run five times: `36100206649` every time.
- `gh run view 36100206649 --json jobs`: job `windows` — completed,
  **success**. So does `36098442078`, and every ci.yml run on main back to
  `36085498093`.
- The real reader, driven through `readCiLaneStatuses` against the repo root
  (`/home/jwcam/repos/flume`, on main): **both lanes green at
  `36100206649`**.
- Timing does not explain it: `36100206649` finished `06:03:46Z`, a minute
  before this tick's window rendered at `06:04:46Z`.
- `34619272992` is the latest run whose `windows` **job** failed. That is a
  selection rule nothing in `ci.ts` implements.

The shape of the miss, from the stamp this tick replaced. `drainedRuns.windows`
came in at `36083376750` (today, `01:45Z`) — a run whose `windows` job really
did fail, drained by an earlier tick with two `pendingGate` titles. Every
ci.yml run on main since `36085546784` (`02:15Z`) has passed. What this tick
was handed is `34619272992`: **the next-older run whose `windows` job failed**,
reached past the stamped one. Over two ticks that reads as "exclude the
stamped run, take the next failing run" — a selection rule `ci.ts` does not
implement and the spec does not describe. It also means the lane will keep
walking backwards through history, one stale red per tick, for as long as it
is drained this way.

The harness bytes are not the variable: `harness/ci.ts`, `harness/ciLane.ts`
and `.flume/declaration.ts` are byte-identical between this worktree's base
(`c670fde3`) and the primary checkout's tip (`d08624f8`), so the code probed
above is the code that rendered the block.

Ruled out from the tree as it reads: the `laneLeg` memo is per-call and each
tick is a fresh child, so no cross-tick reading survives; `wokenLanes` and
`render` share one `statuses()`, so the render cannot name a lane the wake
did not.

## Why it matters

Both failure directions are live. The slice was held live on a red that is
not current, and it was handed nine failing titles from a tree thirteen days
behind — every one of which is green today (drained and closed in the commit
that files this). The mirror case is worse: a lane read that can lag can also
report an old **green** over a current red, and `win32` support is a lane, not
a suite anything else runs.

## What this needs

Not a build entry — there is no defect located on disk, and the reader I
drove answers correctly, so an entry would send an agent after a symptom
rather than a reproduction (`.claude/rules/engineering.md`, *A fix ships the
test that would have caught it*). What would settle it:

1. **Instrument the read.** Have the lane block state the forge invocation and
   its raw answer — run id, `createdAt`, job conclusion — beside the verdict,
   so the next divergence is self-evidencing rather than reconstructed a day
   later. Cheapest, and it makes the fact the engine already holds readable
   (`.claude/rules/engineering.md`, *A fact the engine holds is reported*).
2. **Suspect the forge, and pin against it.** `gh run list` with filters is
   served from a search index; if it can answer stale, the reader wants the
   run's own `createdAt` compared against the tip's commit time and an
   **unread** verdict — never a green or a red — when the newest run it was
   handed predates the tip. Loud or nothing, at the point of detection.
3. **Neither — the window was not freshly rendered.** If something between
   the reader and the prompt can serve a previous render, that is the defect
   and the lane read is innocent. I could not find such a path.

I lean (1) then (2): (2) is a real invariant a lane read should hold whatever
caused this, and (1) is what makes the next occurrence diagnosable instead of
archaeological.

**Do not treat `drainedRuns.windows` as trustworthy meanwhile.** This tick
stamped `{"run":"34619272992","titles":[]}` because the window named that
value, which now records the lane as drained at a run thirteen days old while
the lane is green at today's.
