# Fanout and worktrees — provisioning, isolation, teardown

A fanout wave runs each pickable entry in its own ephemeral git worktree, then carries the
per-entry commits back onto the tip the tick started on. This file governs that machinery:
where worktrees are placed and named, how the shared `.git/worktrees` metadata is protected,
the chain hooks that provision and tear one down, and what survives a revert — the per-entry
merge isolation, the trunk footprint, the reverted-prose snapshot, the friction harvest, and
the removal fallback. Singleton phases run in the main checkout and touch none of it. The
tick lifecycle around a wave (waking, no-commit classification, quarantine, tip claim/verify)
is `spec/loop.md`; where gates are placed and what a chain declares is `spec/chain.md`.

## Fanout is the engine's declared navigation carve-out

The engine records, never navigates (`spec/loop.md`). Both carve-outs declared there are fanout
mechanics — the wave is what they serve, not one of them. These are their details:

- `git worktree add -B <branch> <path> <fromRef>` (`src/git.ts:addWorktree`), where `branch`
  is `flume/<namespace>/<slug>` when a namespace is set and `flume/<slug>` otherwise
  (`src/Dispatcher.ts:createWorktree`), and `fromRef` is the tip the tick started on.
- `git branch -D <branch>` at teardown (`src/git.ts:deleteBranch`).
- The per-entry commits are `cherry-pick`ed onto that same tip, in batch order
  (`src/Dispatcher.ts:runFanout`) — the other half of the same carve-out, declared in
  `spec/loop.md`.

The refs involved are engine-created, engine-consumed, and engine-deleted within one wave. No
ref the operator chose is created, moved, or checked out. `flume/**` is the only grammar the
engine ships, and it exists solely because `git worktree add` requires a branch to attach.

## Placement — the worktree base and the job namespace

The base directory is `FLUME_WORKTREES_DIR` when set (resolved absolute), else
`<flumeDir>/worktrees` (`src/Dispatcher.ts:createWorktree`). The default tracks the state root,
which is itself relocatable via `FLUME_DIR`, so the one-`rm` teardown promise holds.

The override exists for one measured vector: an agent whose `pwd` contains the root checkout's
path as a prefix can derive the root and write there. Pointing `FLUME_WORKTREES_DIR` outside
every repo-path prefix removes the prefix, and with it the inference.

Both the branch name and the directory path carry the job namespace when one is set. The path
must, not just the branch: under a shared `FLUME_WORKTREES_DIR` two jobs with identical tag
slugs would otherwise collide on `<base>/<dirName>`, and the stale-directory cleanup that runs
before `worktree add` would remove the other job's live worktree.

The namespace is a `DispatcherOptions.namespace` value the CLI resolves from `--job` /
`FLUME_JOB` and passes in (`src/cli.ts`). The dispatcher never sniffs it back out of
`flumeDir` — job resolution has one authority (`spec/jobs.md`).

## Worktree directory names are length-bounded

The filesystem component is `worktreeDirName(tag)` (`src/Dispatcher.ts`): `slugify(tag)`
when it fits `WORKTREE_DIRNAME_MAX` (48), else the slug cut to leave room for a separator plus
a 10-hex-character SHA-1 of the **full** tag — so the finished component is exactly 48
characters, and two tags sharing a long common prefix still land on distinct directories. The
bound is on the finished name, not on the slug before the suffix.

Why: `git worktree add` refuses a worktree path at around 200 characters on win32 with
`fatal: '$GIT_DIR' too big`. That ceiling is below `MAX_PATH`, unaffected by `core.longpaths`,
and unreachable by `toNamespacedPath`/`namespacedJoin` because git builds the offending path
itself before any Node fs call sees it. `TAG_MAX_LENGTH` (`src/PendingSchema.ts`) is
`255 - 39` — Linux `NAME_MAX` less the fixed scaffolding of the revert-note filename
`<ISO-timestamp>--<tag>--reverted.md` (below), the tightest raw-tag consumer the schema has to
clear. That is the wider of the two ceilings, so the schema accepts tags whose worktree cannot
be provisioned on Windows. The engine reports that loudly as a provisioning failure, but the
entry could never ship on that platform.

The bound is an engine constant, not a chain knob: it is a property of git, not of any
implementation's taste. **The tag itself is untouched** — `pending.json`, commit messages,
logs, the prior-attempt key, and every tag-keyed lookup keep the full tag; only this one
directory component is bounded. Shortening the tag would be a breaking schema change punishing
POSIX chains for a git-on-Windows limit.

## Every `.git/worktrees` mutation is serialized; the agent fanout is not

`git worktree add`/`remove`/`prune` are not concurrency-safe against the shared
`.git/worktrees/` metadata directory: one task's `--force` remove can fail a sibling's `add`
mid-validation, because git scans every worktree's metadata during validation.

- A pre-wave `git worktree prune` recovers from prior crashes and partial waves. Without it,
  one half-broken `.git/worktrees/<slug>/` fails `worktree add` for *every* subsequent slug.
- Worktree creation is a sequential `for…await` over the batch — `createWorktree` internally
  does a stale-directory removal followed by the add, both mutating the shared dir.
- Teardown is the same sequential walk, with the chain's `teardownWorktree` hook, the friction
  harvest, the removal, and the branch delete all riding it. Teardown is off the critical path,
  so a plain serial walk beats interleaving the git-mutating step out alone.
- **The expensive work stays parallel**: per-entry agent invocations run concurrently, and so
  do the chain's `setupWorktree` hooks. Neither touches `.git/worktrees/`.

A mutex would be equivalent; `for…await` is preferred as the simpler mechanism, mirroring the
already-serialized prune.

Provisioning failure is isolated to the entry that hit it: the failed entry stays pending and
the wave continues with the rest, with `provisioned` and `worktrees` kept index-aligned for
everything downstream. The run-scoped quarantine and consecutive-failure abort built on top of
that are `spec/loop.md`.

Cross-*job* contention on the same metadata dir is a different matter, and is accepted rather
than serialized — see `spec/jobs.md`.

## `setupWorktree` and `teardownWorktree` — the chain's provisioning hooks

A fresh worktree holds only tracked files, so something has to materialize whatever the gates
need before they run. Both hooks are optional, fanout-only, and receive the same
`WorktreeSetupContext` — `{ worktreePath, repoRoot, entryTag }` (`src/Phase.ts`).

- **`Phase.setupWorktree?(ctx): Promise<void | WorktreeSetupResult>`** runs after the worktree
  is created and before the agent. Returning `{ extraEnv }` (the exported type
  `WorktreeSetupResult`) merges those vars into *this worktree's* agent invocation, layered on
  `process.env` — for a per-worktree `DATABASE_URL`, a scratch path, a short-lived credential.
  A hook with nothing to inject returns `void`; the result object exists only to carry
  `extraEnv`. The scope is the agent invocation alone: gates spawn from the dispatcher's own
  env and do not see these vars, and singleton phases never carry `extraEnv` at all.
- **`Phase.teardownWorktree?(ctx): Promise<void>`** runs after the agent and gates, before
  removal — drop a per-worktree DB, release a lease. Best-effort by contract: a throw is
  logged and removal proceeds. A leaked resource is recoverable; a stuck worktree is not.

## The lockfile-aware install helper

`setupWorktree(dir)` (`src/setupWorktree.ts`, exported from `src/index.ts` and handed to chains
on `FlumeApi`) is the shared default for the hook above, and a sibling of the `builtinGates`
precedent — a standalone export, not a `Gate`, since provisioning runs before the agent rather
than as a pass/fail check after it. It inspects the target directory and runs the install its
lockfile implies:

- `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`
- `package-lock.json` → `npm ci`
- both present → pnpm wins
- neither → it **refuses** with a message naming the fix, rather than guessing a package
  manager.

Spawns pass `shell: true` on win32, where both binaries are `.cmd` shims Node cannot spawn
bare. Yarn and bun lockfiles are unsupported: no observed site needs them, and a guess is worse
than a refusal.

## Never symlink `node_modules` into a worktree

The measured constraint behind the helper: **pnpm deletes a symlinked `node_modules` on
install** (pnpm/pnpm#9973), so the symlink pattern breaks silently the first time a fanout
entry runs an install. A real install inside the fresh worktree is the default, and it is cheap
because pnpm hardlinks from its global store — seconds, not a re-download.

`enableGlobalVirtualStore` (`pnpm-workspace.yaml`, https://pnpm.io/git-worktrees) is documented
as an **opt-in optimization only**, explicitly flagged experimental. Flume does not teach an
experimental-by-default pattern.

Whichever strategy a chain picks, provisioning is verified rather than assumed: a
**strategy-agnostic `afterCommit` sanity gate — one that fails loud if a sentinel dependency
stops resolving from the worktree root — is recommended defense-in-depth**, and the sentinel is
derived from the worktree's own manifest rather than hardcoded (`.flume/chain.ts` runs that
assertion at the tail of its `setupWorktree` hook, so a failed provision surfaces before the
agent runs rather than as post-agent module-resolution noise).

> **Drift:** per-entry provisioning isolation does not extend to the chain's hook. The
> `provisionFailures` try/catch in `Dispatcher.runFanout` wraps `createWorktree` alone; the
> `setupWorktree` hooks then run in an unguarded `Promise.all`, so a throw from one entry's hook
> rejects the wave and fails the tick rather than parking that entry. The isolation contract
> stated above under *Every `.git/worktrees` mutation is serialized* is therefore narrower in
> code than in prose.

> **Drift:** `Phase.setupWorktree`'s own JSDoc (`src/Phase.ts`) still describes the hook as
> materializing `node_modules` and `.env` "by symlinking them from the main repo" — the exact
> pattern this section prohibits for `node_modules` under pnpm.

## Per-entry `afterMerge` revert isolation

Each entry's worktree commit is cherry-picked onto the tip individually and gated individually
(`src/Dispatcher.ts:runFanout`). The first failing `afterMerge` gate attributes the failure to
*that* entry — it is the only delta between the pre-cherry-pick tip and the merged sha — and
the engine resets to the pre-cherry-pick tip, dropping **only that entry's commit**.

- The N−1 clean siblings already on the tip **stay shipped**. Later siblings are evaluated
  against the tip without the reverted commit.
- The offending entry stays pending, and its retry carries the prior-attempt record built while
  the cherry-picked sha was still reachable (`spec/loop.md`).
- Its `git show --name-only` footprint is recorded as an `afterMerge-reverted` merge outcome.
- A cherry-pick that conflicts is `--abort`ed so the tree is clean for the next tick, the entry
  stays pending, and its footprint is captured best-effort.

This is what makes "expensive correctness gates at `afterMerge`" safe as default guidance
(`spec/chain.md`): without it, one flaky merge-time gate reverts a whole wave of clean commits
and the retry wave starts cold.

> **Drift:** the `Concurrency` JSDoc (`src/Phase.ts`) still teaches the contract this section
> retired — "Merging back into the trunk runs serially with a postMerge gate; failure reverts
> the wave." Both halves are dead: wave-wide revert was replaced by the per-entry isolation
> above, and `postMerge` is not a gate phase — `src/Gate.ts:GatePhase` is
> `"afterCommit" | "afterMerge"`. The same retired vocabulary repeats on `Phase.gates` ("Gates
> that run at preCommit / postCommit / postMerge points") and on `GateContext.cwd`
> (`src/Gate.ts`, "or trunk for postMerge gates").

## An in-worktree revert still leaves a trunk footprint

An `afterCommit` gate revert happens inside the fanout worktree: the commit is dropped there
and the worktree is removed at wave end, so nothing about it reaches the tip on its own. Left
that way, the next plan tick sees an empty delta and requeues the identical entry blind — the
loop re-derives into the same fence at full tick cost with zero learning per attempt.

So the reverted entry's actual touched paths are recorded as an `afterCommit-reverted` merge
outcome and land on the tip through the **same** footprint-commit mechanism the `afterMerge`
path uses (`src/Dispatcher.ts:commitPendingUpdate`). One bookkeeping surface, not two.

The footprint is `verdict.touchedPaths`, which the gate loop already computed for this commit —
reused rather than re-derived with a second `git show --name-only`, and captured before
`dropLastCommit` discards the evidence. It reaches the tip by being merged into the entry's
`observedFiles` (`spec/pending.md`), which is what the next partition reads.

> **Drift:** the recorded footprint is the tag plus the touched paths. The gate name, its
> message, and the specific out-of-allowance paths from the gate's details are *not* on the
> trunk record — they ride the prior-attempt record and the revert note instead, neither of
> which is committed.

## Reverted prose survives the reset

A gate-reverted tick's `git reset --hard` destroys everything the commit wrote, including
findings that exist nowhere else — a plan tick's `state.md` / `open-questions.md` prose is lost
with the schema-failing `pending.json` that tripped the gate. **Recovery must never require
reading session logs.**

Before the drop, every non-deleted file the reverted commit touched is snapshotted verbatim —
post-image content, under a mirror of its repo path — into
`<flumeDir>/prior-attempts/<key>.reverted/` (`src/Dispatcher.ts:snapshotRevertedFiles`).

- It is a sibling of the prior-attempt JSON, under the state root and gitignored, **not** in
  the worktree — so it outlives both the reset and worktree teardown.
- Recovery is "open the file". The prior-attempt digest is `git show --stat`: filenames and
  counts, never content, so it cannot recover findings. That is why this is a distinct artifact.
- **Generic by construction.** It snapshots whatever the commit changed, so the engine needs no
  chain-specific notion of which artifact is "prose" and which is "machine-checkable".
- Best-effort: a snapshot failure never blocks or fails the revert.
- A later clean commit under the same key clears both the JSON and the snapshot, so a shipped
  entry leaves no stale recovery artifact.

> **Drift:** the snapshot is wired only on the singleton revert path
> (`src/Dispatcher.ts:runSingleton`). A fanout entry reverted by an `afterCommit` gate writes
> the revert note (below) but no prose snapshot. In this repo plan is singleton and build is
> fanout, so the plan-prose case is covered — but the two revert paths do not carry the same
> guarantee.

## The revert note — the operator's copy of the verdict

When `Chain.friction` is declared and an `afterCommit` gate reverts a fanout entry's commit,
the engine writes `<flumeDir>/<friction>/<ISO-timestamp>--<tag>--reverted.md`
(`src/Dispatcher.ts:writeRevertNote`) containing, verbatim from data it already holds: the gate
name, its message, its details (for the write fence, the offending path list), and the reverted
commit's subject and body. Otherwise that evidence dies with the worktree and lives only in
supervisor stdout.

The write is best-effort — a failure is logged and the tick proceeds. Timestamp colons and dots
are replaced for filename safety, and the path is joined through the win32 extended-length
idiom (`src/paths.ts:namespacedJoin`) because the friction dir's full depth is not bounded by
the tag's own length bound.

Fanout-only by construction — `writeRevertNote`'s sole call site is `runFanoutEntry`
(`src/Dispatcher.ts`). A singleton tick reverted by an `afterCommit` gate writes no note, and
relies on the prose snapshot above instead.

## Teardown harvest — the delivery guarantee

Only the engine is present when a fanout worktree dies, so only the engine can guarantee a
worktree-local friction note survives it. At wave end, for each worktree, **before removal**
(`src/Dispatcher.ts:harvestFriction`):

- Resolve the worktree-local mirror of the declared channel — the state root's repo-relative
  path, joined inside the worktree, joined with `chain.friction` — and **move** every file in
  it into the primary `<flumeDir>/<friction>/`, prefixing each filename with `<tag>--` for
  provenance and collision-freedom against other waves and the primary's own files.
- Across a device boundary (a relocated `FLUME_WORKTREES_DIR`) `rename` fails `EXDEV`; the
  harvest falls back to copy-then-remove.
- This is a **move by harness code across the worktree boundary**, not an agent write. The
  agent-facing rule is unchanged: worktree agents write only under their own `$PWD`.
- Scope: the state root must live inside the repo tree, so a worktree contains a mirror. A
  relocated state root has no mirror and the harvest is a no-op. An undeclared `chain.friction`
  is a no-op too — the declaration is `spec/chain.md`.
- **Harvest failure never aborts the wave.** An absent mirror dir is expected and silent;
  anything else (unreadable dir, locked file) is logged per item and the wave continues,
  leaving what could not move for the removal fallback to surface.

## Worktree removal has a win32 fallback, unconditionally

Independent of any friction declaration. `git worktree remove --force` fails on win32 when a
just-installed `node_modules` still has handles open, reporting `Directory not empty` instead
of removing. `src/git.ts:removeWorktree` therefore falls through rather than surfacing that as
a wave failure:

1. `git worktree prune`, then a recursive filesystem removal with bounded retry (5 attempts,
   200 ms apart — exactly the EBUSY/locked-handle class `fs.rm`'s `maxRetries`/`retryDelay`
   exist for), through the extended-length path prefix.
2. If the directory survives, throw with the surviving path so the caller can aggregate.
3. On success, prune again — `--force` left a stale `.git/worktrees/` entry behind.

The wave reports surviving paths **once, at wave level**, not once per worktree: a locked
`node_modules` on one entry must not produce N identical log lines. Branch deletion runs
regardless and swallows only git's own "branch not found" wording; any other failure (most
commonly a branch still checked out in a worktree that survived removal) is surfaced.

## The default test lane must stay fast

The build's `afterMerge` gate runs `pnpm test` (= `vitest run`) **inside a fanout worktree**.
Real-subprocess tests — spawning real `flume tick`/`loop` through `tsx`, real `git` — are fast
standalone (~2 s measured) but in a freshly-installed worktree under full-suite parallel load
their cold `tsx` starts exceed vitest's 30 s default and **revert clean commits**. That is an
execution-environment artifact, not a chain-reload defect and not a hang.

The suite therefore has two lanes:

- **Fast lane** — the default `vitest run`, exactly what the in-worktree gate invokes. It must
  stay fast and worktree-safe.
- **Integration lane** — anything spawning real subprocesses or needing a warm host. Marked by
  the `*.integration.test.ts` filename convention and **excluded from the default run** by
  `vitest.config.ts`, so the in-worktree gate never runs them. They run at the host — main
  checkout, warm deps, no worktree — via `pnpm test:integration`, which selects the lane with
  `VITEST_LANE=integration`.

Rejected, and worth not re-proposing:

- **Raising the timeout.** The tests are ~2 s standalone; a bigger timeout masks nothing and
  leaves the worktree hostility (cold `tsx` plus parallel contention) in place.
- **Deleting the real-subprocess tests to fit the gate.** Integration coverage is relocated to
  where it is fast and reliable, never dropped.
- A vitest workspace/projects split was judged heavier than the filename convention warrants.
  The standing constraint is the **lane boundary**, not the vitest mechanism.
