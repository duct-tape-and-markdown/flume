# Migrating a chain from 0.11 to 0.12

0.12 changes *when and where* the engine touches git, not the chain factory
shape — most 0.11 chains load unmodified. Walk this checklist before bumping
the pin; each item names who is affected.

## 1. Put correctness gates at `afterMerge` (every chain)

Merge sites now absorb foreign commits: an operator (or any non-engine
writer) committing mid-run is legal, and the merged tree is validated **only**
by your `afterMerge` gates — `afterCommit` gates validated the span against
its recorded base, which may not be the tree it merged into. If your
correctness gate (test suite, typecheck-of-the-whole) sits at `afterCommit`,
move it to `afterMerge` or accept the staleness window knowingly. This was
always the safe placement; 0.12 makes it the stated contract
(`spec/chain.md`, *Gate placement*).

## 2. Singleton phases now provision worktrees (chains with singleton phases)

A singleton tick runs its agent in a `flume/[<ns>/]<phase>` worktree and
cherry-picks back, exactly like a one-entry wave. Check:

- **`setupWorktree`/`teardownWorktree` hooks now fire for singleton phases.**
  If your hook assumed fanout-only context (an entry tag, per-entry env),
  make it concurrency-agnostic. A singleton tick now pays your setup cost
  (a `pnpm install --frozen-lockfile` is seconds via the hardlinked store).
- **Prompts or tools that assumed the agent's cwd was the repo checkout**
  (reading operator scratch files, relying on uncommitted state) now see a
  clean worktree at the tick's base commit. Anything the agent needs must be
  committed or injected via the prompt.
- **`afterMerge` gates on singleton phases are now legal and live** — the
  0.11 load refusal is retired. Declare them where useful.
- The operator's checkout is no longer touched mid-tick: no more staged
  residue after discards, no soft-reset of operator commits, ever.

## 3. Commit `pending.json` for dispatch to see it (all consumers)

Decide-reads resolve from `HEAD:`, not the working tree. A pending.json
edited on disk but uncommitted is invisible to dispatch. This only affects
workflows that hand-edited the queue (already against contract) or seeded it
without committing — `flume job new`'s baseline commit already covers the
supported path. `flume check` still validates the working tree, by design.

## 4. Scripts that pass stray positionals now exit 2 (automation)

`flume tick plan`, `flume stop now`, `flume check foo`, `flume loop x`, and
extras past `wake`/`sleep`'s `<phase>` refuse usage-shaped instead of
silently ignoring the argument. `flume status` still exits 0 always.

## 5. Concurrent invocations: the claim is now universal (automation)

A bare `flume tick` acquires the per-ref tip claim and refuses (exit 1) when
another live flume process holds it. If your automation ran overlapping bare
ticks and relied on optimistic verify to sort them out, serialize them. Tick
children spawned by `flume loop` are unaffected (they inherit the
supervisor's claim via `FLUME_TIP_CLAIM_HELD`).

## 6. Pausing a loop: use the stop flag, retire kill choreography (operators)

`flume stop` (or `touch <flumeDir>/stop`) ends the run at the next tick
boundary with the in-flight tick completed and merged. The next
`loop`/`job run` refuses until you remove the flag — that refusal is the
acknowledgement mechanism, not an error. Delete any `taskkill`/process-tree
pause scripts; they are strictly worse now.

## 7. After upgrading flume under a running loop: stop and relaunch (operators)

A running supervisor stays on its launch version while tick children re-read
HEAD. Upgrading the flume dependency (or, in-repo, shipping engine changes)
mid-run can split the supervisor↔child contract — the observed failure is
children refusing every merge against their own supervisor's claim. Rule:
contract-touching upgrade → `flume stop` → relaunch (`spec/loop.md`, *A run
finishes on the contract it started with*).

## 8. API surface deltas (programmatic embedders only)

- `MergeFailure.tag` is now optional (a singleton merge failure has no entry
  tag).
- Merge outcomes gain `afterMerge-revert-refused` (keep-semantics revert
  refused on a bystander collision; commit stays on trunk) and every span
  fate carries `headSha`.
- `DispatcherOptions.ownTipClaimPid` tells the dispatcher which claim is its
  own run's; the CLI sets it — set it if you embed and hold a claim.
- Primary-checkout reverts use `reset --keep` semantics (`resetKeepTo`);
  `dropLastCommit` (`--hard`) remains correct only inside engine-owned
  worktrees.
