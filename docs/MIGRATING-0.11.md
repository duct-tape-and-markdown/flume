# Migrating to 0.11.0

From a pin **earlier than 0.10.0**: do [MIGRATING-0.10.md](MIGRATING-0.10.md)
first — it routes by starting version and its § 3 must land before the 0.10
pin bump. Then return here.

From **0.10.x**: three sections, one of which must run before the bump.

## 1. Before the bump — find declarations 0.11 refuses at load

0.11 refuses two statically dead declaration shapes that 0.10 loaded
silently (`spec/chain.md`, *A dead declaration is refused at load*). A chain
carrying either fails at the next tick's chain load with a usage-shaped
error, so check now:

```sh
grep -n "entryChannelPaths\|scopeWritesToEntry\|afterMerge\|concurrency" .flume/chain.ts
```

- **`entryChannelPaths` on a phase without `scopeWritesToEntry: true`.** The
  channel allowance is only consulted on a scoped tick; without the flag the
  globs govern nothing. This is almost always the unmigrated-0.9 shape — the
  0.10 flip made narrowing opt-in, and a chain that kept its channel paths
  without adding the flag has been running under the wider fence since.
  Decide what you meant:
  - You wanted the 0.9 narrowing → add `scopeWritesToEntry: true` beside the
    channel declaration. Check first that your entries' `files` declarations
    cover what their commits actually touch — under narrowing, an
    under-declared path reverts the commit.
  - You accept containment-only → delete the `entryChannelPaths` line.
- **A `when: "afterMerge"` gate on a `concurrency: "singleton"` phase.** The
  merge loop is the only site that runs those gates and a singleton phase
  never enters it. Move the gate to `afterCommit`, or make the phase fanout
  if that was the intent.

An empty `entryChannelPaths: []` on a scoped phase and an `afterMerge` gate
on a fanout phase are *not* refused — the bar is static deadness, never
disuse.

## 2. After the bump — behavior that changes under you

None of these need chain edits; all of them change what a run does:

- **Deterministic failure streaks now brake.** The
  consecutive-identical-failure accounting covers merge-stage (cherry-pick)
  failures and gate reverts, not just provisioning
  (`supervisorPolicy.quarantineScope`/`abortThreshold`, defaults unchanged).
  A loop that previously spun forever re-buying the same conflict now
  quarantines the entry or aborts the run at the threshold.
- **Merge-only-failure runs exit non-zero.** A run whose every tick fails at
  the merge stage and ships nothing no longer exits 0. CI that tolerated
  such runs will start failing them — that is the fix, not a regression.
- **Multi-commit entries ship.** The fanout collector verifies ancestry of
  the recorded base instead of parent equality, so an agent that commits
  more than once in its private worktree produces a completed entry (the
  whole span gates and cherry-picks). If your prompts carry a
  "commit once, as your final action" workaround for the 0.10.x
  orphaned-commit defect, you can retire it.

## 3. New opt-ins, when you want them

- `Chain.supervisorPolicy.tickTimeoutMs` — per-invocation wall-clock cap,
  read per tick. The runaway brake autonomous loops previously lacked.
- `flume log [-n N] [--json]`, `flume check`, `flume friction [name]` — read
  verbs over tick verdicts, the working tree's `pending.json`, and the
  declared friction channel. All observational; `check` is the instant
  refusal that previously cost a tick to discover.
- `api.matchesAny` — write chain path policy (a `shipped` predicate) against
  the same glob matcher the engine's fence enforces with.
