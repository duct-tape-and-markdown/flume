# Migrating to 0.20.0

**This note covers `0.19.x` → `0.20.0` and nothing earlier.** The previous
note in the series is [`MIGRATING-0.19.md`](MIGRATING-0.19.md), which walks
`0.18.x` → `0.19.0`. If your pin is below `0.19.0`, work that note first,
including its [section 5, *The queue on disk is an operator cutover*](MIGRATING-0.19.md#5-the-queue-on-disk-is-an-operator-cutover) and its [section 6, *Plan state is one file per slice*](MIGRATING-0.19.md#6-plan-state-is-one-file-per-slice), before you take this one.

One break, and two behavior changes worth knowing before the first run.

## 1. The legacy queue and plan state pages leave the plan fence

`0.19.0` kept the old single-file queue, `plan/pending.json`, and the old
single-file plan state, `plan/state.json`, on the plan fence for exactly one
release, so a plan tick could `git rm` them while splitting them into
directories. That release is over. The two pages are off the fence, and the
harness export `legacyPlanStatePath` is gone with them.

**What to do.** Check that neither page is still in your tree:

```sh
ls "$(git rev-parse --show-toplevel)"/.flume/plan/pending.json   # expect: no such file
ls "$(git rev-parse --show-toplevel)"/.flume/plan/state.json     # expect: no such file
```

If either is still there, run the cutover in [section 5, *The queue on disk is an operator cutover*](MIGRATING-0.19.md#5-the-queue-on-disk-is-an-operator-cutover) or
[section 6, *Plan state is one file per slice*](MIGRATING-0.19.md#6-plan-state-is-one-file-per-slice) of the 0.19 note by hand and commit it before upgrading. Left in place under `0.20.0`, the page is a file no phase
may touch, and a plan tick that tries to remove it is reverted by the fence.

A chain that imported `legacyPlanStatePath` drops the import; nothing
replaces it, because nothing is left for it to name.

## 2. An inbox record counts once it is committed

The inbox slice now wakes from and reads the tip's tree, the same tree its
worktree is cut from. A file you drop into the inbox and leave uncommitted
neither wakes the slice nor reaches its render. Commit the record. The
friction channel is unchanged: it is kept out of the tree and still read from
the shared disk.

## 3. A CI lane reads only a run made for the tip's own commit

A lane whose newest completed run tested any other commit reads as `UNREAD`,
naming both commits. While your loop ships faster than CI finishes, expect
most lane reads to be `UNREAD`. A red that persists reports once the tip's
own run completes, so nothing is lost, only deferred.
