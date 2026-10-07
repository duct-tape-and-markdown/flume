# Goal: 0.22.0 ships, and a consumer upgrades to it without a broken queue

**Goal, rank 1** — the only standing goal, so it ranks first. Stated by the
operator in an interactive session, 2026-10-07.

What waits on it: the 0.22.0 release, and cartograph's upgrade to it.
Cartograph runs two ticks at once over a queue of ~157 entries that still
carry the retired `priority` key, so an upgrade today would refuse the queue
and, through the abort defect below, end the run.

The section it serves: `spec/harness.md`, *Adoption and upgrade* — "Upgrading
is one version bump plus the release's migration note." The goal is done when
that sentence is true of 0.22.0: a consumer bumps the version, follows the
note, and its loop runs.

What it needs beneath it (plan files these; the cut itself — changelog,
`docs/MIGRATING-0.22.md`, version bump, tag — stays the interactive session's,
per `CLAUDE.md`, *Release cut*):

- The run abort over a parse failure a sibling had repaired
  (`2026-10-07-a-sibling-ticks-mount-dead-aborts-a-run-its-peer-just-repaired.md`):
  a consumer upgrading with stale queue files hits it under `maxTicks` 2.
- A way for an upgrading consumer's queue to drop `priority` without a hand
  edit per file, if plan judges the migration note's one-line strip is not
  enough; otherwise the note carries it and nothing is filed.
- `A-WORK-ENTRYS-FOOTPRINT-IS-ITS-STEPS-TOO`, already queued, and the work
  `a96a18ca` derives (a session naming the steps it finished): together they
  make the `step` kind 0.22.0 ships usable rather than refused or unsafe.

Not in this goal: the `status` EPIPE crash and the sweep-procedure citations.
They file as ordinary work, parentless.
