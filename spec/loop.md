# The loop — ticks, batons, outcomes, exit codes

This file governs the tick lifecycle: what wakes a phase, what a tick is allowed to
touch in git, how a tick that produces no commit is classified and carried forward,
what artifact a tick leaves behind, and what a process exits with. It covers the
single tick (`Dispatcher.tick`) and the supervisor that repeats it (`superviseLoop`).
Chain declarations (phases, gates, factory shape, policy knobs) are `spec/chain.md`;
the entry queue is `spec/pending.md`; fanout provisioning and merge isolation are
`spec/worktrees.md`; prompt rendering is `spec/prompt.md`; the command surface and its
help text are `spec/cli.md`.

## Baton — presence wakes, absence hibernates

The baton is the only mutable harness state outside committed files, and it is a
directory of empty files: `<flumeDir>/awake/<phase>` (`src/Baton.ts`). Presence of a
flag wakes the named phase on the next tick; absence sleeps it. No daemon, no
database, no in-memory carry. Disk is truth, including the baton. A relocated
`flumeDir` carries the baton with it.

- **`wake`/`sleep` are idempotent.** Repeated calls and missing flags are tolerated,
  so concurrent ticks and partial crashes cannot corrupt baton state.
- **Which phase runs.** A tick takes the first phase in the chain's declared order
  whose name is awake (`Dispatcher.tick`: `chain.phases.find(p => awake.includes(p.name))`).
  Declaration order is the tiebreak, not flag order or flag mtime.
- **Handoff passes the baton.** After the phase's work, the dispatcher sleeps the
  phase that ran, calls `phase.handoff(result)`, and wakes every name it returns
  that is not listed in `chain.humanOnly`. A handoff returning `[]` is how a chain
  ends the run. Handoff runs on every tick that ran a phase — committed, no-commit,
  or declined.
- **Hibernation is the empty baton.** `Baton.hibernating()` is true iff no flags
  exist; `superviseLoop` reads it off disk between children and stops. Hibernation is
  a clean stop, not an error class — `flume tick` exits 0 on it (`tickExitCode`). The
  loop's own exit code is decided by the run totals (see *Exit codes*), not by the
  fact of hibernating.
- **Humans hold the other end.** `flume wake <phase>` / `flume sleep <phase>` touch
  and remove flags directly (`spec/cli.md`); `humanOnly` phases are reachable only
  that way.

## One tick is one fresh process

Each tick is a fresh OS process, and that is an invariant, not an implementation
detail. `flume loop` is a supervisor that spawns exactly one `flume tick` child per
iteration (`superviseLoop`, `defaultTickRunner`), carrying no in-memory chain or
phase state across them; between children it re-reads the baton from disk. The
process boundary is the only mechanism that re-evaluates the whole module graph, so
it is *the* mechanism — see `spec/chain.md` for per-tick chain re-resolution and why
in-process reload cannot deliver it.

Everything that crosses from one tick to the next crosses on disk: the baton, the
prior-attempt record, the tick verdict, the committed tree itself. **What crosses is
a bounded digest, never a session.** Prior-outcome feedback exists so a retry does
not re-derive the same wall; it is not conversational continuity, and no design may
grow it into one.

**A run finishes on the contract it started with.** Tick children re-read HEAD's
code on every spawn, but the supervisor stays resident at its launch version — so
any supervisor↔child contract (the claim-inheritance env, the verdict paths, the
exit-code map) is frozen on one side and live on the other. A commit changing such
a contract is unsafe to absorb mid-run; the observed shape is fresh children reading
their own stale supervisor as a foreign engine instance and refusing every merge.
The rule is operational, deliberately un-engineered while the event stays rare:
after a contract-touching ship, stop the loop (*Graceful stop*) and relaunch. A
chain may mechanize this on existing surface — its build handoff writing the stop
flag after shipping an entry plan marked contract-touching — before any engine
version-fence is considered; the condition that would justify the engine owning it
is a second livelock despite the documented rule.

## The engine records, never navigates

The engine's entire git surface is the tick record — the commits a tick produced,
landed on the tip it was handed, plus the guarded revert its gates depend on, plus
observational reads. *Navigation* — choosing which line of history the operator is
on — belongs to the implementation.

**The condition:** the engine never changes which ref HEAD points at, and never
creates or deletes a ref outside `flume/**`. It freely advances and resets the tip it
was handed — that is recording, and it is the whole point. What it never does is
decide *which* tip you are on.

Stated as a condition rather than a list of forbidden verbs because the verb list
drifted twice: it forbade `cherry-pick`, which the engine has always run, and then
forbade `branch`, which it runs over its own ephemeral `flume/**` names. A condition
can be evaluated by a sweep lens; an exception list only accumulates exceptions.

Two consequences of the condition, spelled out because both look like violations of
the older verb-list wording and are not. Both are the engine recording its own
output:

- **`cherry-pick`.** A fanout wave's per-entry worktree commits are carried onto the
  tip the tick started on, in order, with `cherry-pick --abort` on conflict
  (`git.cherryPick`, `Dispatcher.runFanout`).
- **Ephemeral `flume/**` branch names.** `Dispatcher.createWorktree` constructs
  `flume/<namespace>/<slug>` (or repo-global `flume/<slug>` with no namespace) —
  the slug is a fanout entry's tag under fanout and the phase name under singleton
  (`spec/worktrees.md`, *Singleton runs in a worktree*); provisioning is
  `git worktree add -B` (`git.addWorktree`), and teardown removes the
  worktree (`git.removeWorktree`) and then deletes the branch with `git branch -D`
  (`git.deleteBranch`). The grammar is the engine's
  own throwaway workspace naming, never a line of history the operator visits. See
  `spec/worktrees.md`.

**The engine owns the tip its process runs on.** The tip — the ref HEAD resolves to —
is the one resource the engine's commit mechanic consumes, so the engine defends it:
an advisory claim, and an optimistic verify. Not a total lock: a signal, plus a fact
for when the signal was bypassed. The engine does not choose the tip, name it, or
move between tips.

## The loop lock and the tip claim

Two guards over two different resources. Both stand; neither substitutes for the
other.

- **Loop lock — one supervisor per state root.** `flume loop` writes its pid to
  `<flumeDir>/loop.pid`. A second loop against the same state root is refused while
  the recorded pid is alive (`liveLoopPid`, `src/job.ts`); a stale pidfile (dead pid)
  is reclaimed silently. The lock lives under `flumeDir`, not the repo — the state
  root is what races, and a relocated dock carries its lock with it.
- **Tip claim — one flume writer per tip, advisory.** `flume loop` claims the tip at
  start and releases it at exit (`git.acquireTipClaim`, `git.TipClaimHeldError`).
  - *Keying:* `<git-common-dir>/flume/tip-claims/<ref path>` — e.g.
    `.git/flume/tip-claims/refs/heads/main` — mirroring the ref path as directories.
    The common dir resolves identically from every linked worktree, so a claim taken
    in one is visible from all. Tool state under `.git/` follows the
    `git-lfs`/`sequencer` precedent: shared, untracked, surviving branch switches.
  - *Acquire:* exclusive-create (`wx`). On `EEXIST`, probe the recorded pid with the
    same liveness check as the loop lock — live → refuse, naming the holder
    (`tip refs/heads/X claimed by pid N (<path>)`), exit 1; dead → reclaim (unlink,
    retry the create, re-probing rather than assuming this call won the race).
  - *Contents:* the holder's pid, nothing else — consistent with `loop.pid`.
  - *Release:* the same `exit`/`SIGINT`/`SIGTERM` handlers that drop the loop lock.
    Release-on-signal is a POSIX guarantee only; on win32 `SIGTERM` maps to
    `TerminateProcess`, which runs no handler, so the claim survives the kill and the
    next acquirer's liveness probe reclaims it. Stale-reclaim is the cross-platform
    guarantee.
  - *Scope:* per run. `flume loop` acquires once for the whole run and releases at
    exit; its tick children run under the supervisor's claim — the runner tells the
    child (`FLUME_TIP_CLAIM_HELD=<pid>` in the child env) rather than the child
    probing pids and inferring parentage. A bare `flume tick` acquires and releases
    around its single tick, refusing (exit 1) when another live process holds it.
    Claimless ticks left the startup sweep (`spec/worktrees.md`, *Startup sweep*)
    no way to know a live wave owns the worktree base, and left concurrent bare
    ticks to collide with only optimistic verify between them.
- **Detached HEAD is refused, by both `tick` and `loop`, before any work** (exit 1).
  The tick record's meaning is advancing a named tip, and the claim keys on a ref.
  The refusal names the state plainly. `tick` refuses even though it takes no claim,
  so behavior is identical whether or not a loop wraps it.
- **A git working tree is the precondition**, enforced by the same refusal. Both
  commands resolve HEAD through `git.currentRefPath`, which returns a discriminated
  `CurrentRef`: `ref`, `detached`, `not-a-repository`, or `git-unavailable`. All
  three failure kinds refuse, and the refusal names which one fired
  (`describeRefFailure`) — a caller outside a repository is never told about a
  detached HEAD it is not in.

`flume status` reports supervisor liveness, the current tip's claim, and the stop
flag, observationally — see `spec/cli.md`.

## Graceful stop — the stop flag

Presence of `<flumeDir>/stop` asks the supervisor to end the run at the next tick
boundary: the in-flight tick finishes — merge, park, verdict, and handoff run exactly
as they would have — then the supervisor releases the tip claim and the loop lock and
ends the run. Same philosophy as the awake baton: disk is truth, no IPC, no signals.
Kills are not the pause mechanism — and on win32 they cannot be, because `SIGTERM`
maps to `TerminateProcess`, which runs no handler (*The loop lock and the tip claim*,
above), so a signal-based graceful stop is structurally unavailable on the one
platform that most needs one.

- **Checked between children only.** `superviseLoop` reads the flag off disk at the
  same boundary it re-reads the baton. Nothing polls mid-tick; an in-flight tick
  always completes. A hung agent is therefore still hung — the stop flag is not a
  kill and does not subsume whatever the operator does about a tick that never ends.
- **Presence at start refuses the run.** `flume loop` (and `job run`) with the flag
  already on disk refuses before any tick, exit 1, naming the flag path — removing
  the flag is the operator's acknowledgement that the stop was seen, and the refusal
  message says exactly that. A stale flag can therefore never silently swallow a
  scheduled run: the run refuses loudly until a human acks.
- **A stopped run's exit code is still the run's.** Stop ends iteration; it does not
  reclassify what already happened. `loopExitCode` decides from the run totals as
  ever (*Exit codes*, below) — a graceful stop after errored ticks with nothing
  shipped still exits non-zero. The completion summary names the stop flag as the
  reason iteration ended.
- **`flume tick` ignores the flag.** The flag stops the supervisor's iteration; a
  bare tick is the operator's own explicit action, and refusing it would gate the
  very command an operator uses to test a staged fix before acking the stop.
- **`flume stop` writes the flag; `touch` is equally true.** The verb
  (`spec/cli.md`) is discoverability plus a printed statement of what happens next,
  never a privileged channel — the file is the mechanism, and a script that touches
  the path has used the real interface.

## Crash equals stop

Any death of the supervisor or a tick child, at any point, leaves a state a fresh
`flume loop` resumes without operator repair. Most of this has been true by
construction; it is now the stated guarantee the pieces serve, so a gap in it is a
defect rather than a workaround the operator owes the engine:

- **Locks and claims self-heal.** A stale `loop.pid` (dead pid) is reclaimed
  silently; a stale tip claim is reclaimed by the next acquirer's liveness probe
  (above). On win32, where a kill runs no release handler, stale-reclaim is the only
  release path — which is why reclaim is the guarantee and the exit handler is the
  optimization.
- **State is on disk or in git.** The baton, `pending.json`, prior-attempt records,
  and tick verdicts survive any death, and a tick that died before writing its
  verdict left nothing a fresh supervisor can misread as current (*The tick
  verdict*).
- **No engine mutation destroys uncommitted state it did not author.** The
  shared-checkout revert carries keep-semantics and refuses on collision rather
  than wiping (*Tip verify*, "dropping it must not take bystanders") — the tree an
  engine revert touches may be the only home of two writers' work, including work
  the engine itself declined to sequence seconds earlier. Crash-equals-stop is
  hollow if the recovery a crash leaves intact is one the next merge deletes.
- **A dead wave's residue is swept at the next start.** Worktrees and `flume/**`
  branches abandoned by a killed fanout tick are removed at the next `loop`/`job
  run` start, under the tip claim — `spec/worktrees.md`, *Startup sweep*. Per-wave
  stale-slug removal only ever covered entries being re-provisioned; an abandoned
  entry that left the queue leaked its worktree indefinitely, which was the one
  observed gap between this guarantee and the tree.

The guarantee is bounded by git's own: a child killed inside a git mutation can
leave `index.lock` or an in-progress cherry-pick behind, which git refuses loudly
and a human resolves with the evidence in hand. The engine cannot tell its own
abandoned sequencer state from an operator's in-progress cherry-pick without
inference, so it does not try (`engine-boundary.md`, *Told, not inferred*). The
claim is narrower and holds: the engine adds no state of its own that a crash can
corrupt into silent misbehavior.

Two consequences for the engine's own cherry-pick handling on the primary checkout:

- **An abort is issued only against a sequence that started.** `cherry-pick --abort`
  runs iff the sequencer state (`CHERRY_PICK_HEAD`, `sequencer/`) is present, never
  blind — a blind abort after a pick that failed *before* starting a sequence would
  reset the operator's index and working tree, taking bystanders the pick never
  touched.
- **Staged bystander state is checkpointed before a pick range begins.** Anything
  staged on the primary checkout when the merge stage starts is captured as a dangling
  commit (`git stash create`'s shape — object written, no ref moved, nothing reset) and
  its sha recorded on the tick verdict. Never-destroy-always-leave-a-sha is the same
  idiom span recovery rides: the operator's work is recoverable from the verdict alone
  even if a later abort or reset disturbs it.

## Tip verify — one writer per branch, absorption at the merge

The correctness backstop behind the claim's signal — but the two guard different
things, and the split is load-bearing: **a foreign commit on the tip is legal
history; a second engine writer is not.** The claim file is how the dispatcher tells
them apart without inference — an engine instance always holds the claim, an
operator never does — so tip movement at a harness commit site is *absorbed* when no
live foreign claim exists and *refused* when one does (below). Verify's refusal legs
defend what absorption cannot make safe: a concurrent engine interleaving merges,
and a base rewritten out from under an agent. A refusal means **no commit**; the
tick ends with a `tip-moved` fact, and the entry — if the tick carries one — stays
in `pending.json` for a fresh retry. The engine reports the fact; the chain owns
what it means.

No leg refuses operator activity anymore. Every agent commit lands on a private
`flume/**` branch with exactly one legitimate writer — this tick's agent: per entry
under fanout, per phase under singleton (`spec/worktrees.md`, *Singleton runs in a
worktree*). An operator commit on the trunk is therefore never in the same history
an agent-commit check reads, and it reaches the engine only as a foreign tip at a
merge site — which absorbs it (above). The parent-equality leg this section used to
carry — shared ref, evidence-identical interleavings, full-span revert whose
accepted consequence was resetting operator commits landing mid-tick — is retired
with the shared ref itself; its admitted tension with "dropping a commit requires
owning it" (below) went with it.

What survives a refusal on disk: where the dispatcher undoes a commit it observed
(`Dispatcher.checkTipMoved`), the undo is `reset --soft` (`revertTipMovedCommit`,
which itself refuses unless the current tip is the sha it observed) — run inside
the tick's worktree, which teardown removes along with any uncommitted work; no
snapshot is taken (`snapshotRevertedFiles` rides the afterCommit gate-revert leg
only). Where a wave refuses *before* cherry-picking, no reset is involved: the
commit is still on its private worktree branch, which teardown removes. The entry
stays pending in every case; only the residue differs.

- **Agent-made commits are verified after the fact.** The agent commits directly, so
  the dispatcher never sees the moment of commit; `Dispatcher.checkTipMoved` verifies
  the observed HEAD against the tip recorded at start, and on refusal soft-resets the
  span away (`revertTipMovedCommit`, which itself refuses unless the current tip is
  the sha it observed). Run before any gate — a commit that could not have been made
  on the recorded tip is refused regardless of what the gates would have said. Soft
  rather than hard, so the work survives wherever its working tree does (above).
  > **Note:** "re-read the ref before committing" describes the harness's own commits
  > only. An agent-made commit cannot be checked before it exists, so the guarantee
  > here is equivalent rather than identical.

- **The check is ancestry, and N commits are completion.** A private branch has
  exactly one legitimate writer, so an agent that commits, keeps working, and
  commits again has produced a *completed tick*, not interference. The check —
  both concurrencies, `Dispatcher.checkTipMoved` — is **ancestry**: the recorded
  base must be an ancestor of the observed HEAD, and on success the whole span
  (base..HEAD, in order) runs its gates and cherry-picks like any single-commit
  tick. Refusal fires only when the base is *not* an ancestor of the observed
  HEAD, which on a private branch means something reset or rewrote it out from
  under the agent — never that an operator was active, who has no reason to touch
  a `flume/**` branch and every reason to be on the trunk the merge sites absorb.

  Two obligations ride the refusal, because teardown removes the worktree and no
  snapshot is taken (above): the log line and the persisted record name **both**
  shas the operator needs — the observed HEAD and the recorded base — never the
  HEAD's parent alone, which reads the agent's own work as the intruder and leaves
  the top commit undiscoverable; and the refusal lands in the tick verdict as its
  own dropped-work fact, never as silence a partial ship summary papers over.

  **Why ancestry is stated, not assumed:** an equality check applied to a private
  branch was field-traced downstream (flume 0.10.1) misclassifying a
  commit-then-verify agent's finished entry as `tip moved (no commit)`,
  soft-resetting it, and letting teardown destroy all trace but a dangling sha —
  real gate-worthy work silently orphaned at full agent price, invisible in the
  verdict.
- **Harness-driven commits carry no expected-tip bookkeeping — the claim refuses,
  git arbitrates.** Before each `cherry-pick` and before the pending-ledger commit
  (`commitPendingUpdate`, checked *before* the `writeFile`), the wave asks one
  question: does a live foreign claim exist? There is no expected-sha comparison,
  because a sha equality check at a merge site is wrong in both directions — it is
  provably more pessimistic than the merge it guards (it refuses on provenance
  spans git would land clean, after their gates already passed), and its
  advancement bookkeeping is a desync surface (an engine-landed commit the
  bookkeeping fails to count turns the engine's own history into "interference").
  Both failure shapes were field-paid in one night downstream: a file-disjoint
  operator commit voided a six-wide wave whose gates had all passed, and hours
  later the same check refused four builds over a commit the dispatcher itself had
  just cherry-picked. The claim answers the only question content cannot:
  - **A live claim held by another process is a concurrent engine instance**, and
    the wave refuses exactly as before: `tipMoved`, remaining entries stay pending,
    nothing dropped. Two engines interleaving cherry-picks onto one ref is the
    corruption the claim exists to prevent; absorbing it would launder it.
  - **No live foreign claim means the mover was not an engine, and the commit is
    legal.** An operator committing law, prompts, or chain config mid-run is
    ordinary history, never interference. The wave cherry-picks onto whatever tip
    is current — the foreign commit sits under the wave's, exactly as if it had
    landed between ticks — and **git's own conflict detection is the arbiter of
    content**: a conflicting cherry-pick aborts (`cherry-pick --abort`) into that
    entry's existing `MergeFailure` outcome — the entry stays pending and retries
    against the tip that now carries the foreign commit, which is itself never
    touched — and a clean pick lands, with semantic compatibility owned by the
    `afterMerge` gates (below), never by a provenance check. The pending-ledger
    commit absorbs identically — its content derives from the wave's outcomes, not
    from any tip, so it recommits on whatever tip is current.
- **Absorbing the ledger commit is what closes the queue-behind-tree hazard.**
  Under refuse-on-moved semantics, a ref moving between the last cherry-pick and
  the ledger commit left `pending.json` listing entries whose commits were already
  on the tip — prior-attempt slots already cleared (`clearPriorAttempt`) — and the
  next tick dispatched agents against shipped work with nothing on disk to say so.
  The ledger landing on the moved tip removes the window: a tick can no longer end
  with the queue behind the tree it describes.
- **The merged tree's validity is the chain's `afterMerge` gates** (`spec/chain.md`,
  *Gate placement*). An absorbed foreign commit means the entry's `afterCommit`
  gates validated its span against the recorded base, not the tree it merged into.
  That staleness is deliberate and declared, never silent: `afterMerge` is the only
  validation of the merged tree, and the engine re-gates nothing on its own — what
  validation means is the chain's decision, not the engine's.
- **One window stays a refusal, deliberately.** A foreign commit landing between an
  entry's cherry-pick and that entry's `afterMerge` gate revert leaves the entry's
  commit mid-history, where `dropLastCommit`'s ownership guard refuses (below). The
  refusal is loud, names both shas, and leaves repair to the operator with the
  evidence in hand — the bounded exception to absorption, not a contradiction of
  it: absorbing history is safe; resetting over another writer's commit is the
  defect the guard exists to stop.
- **Per-entry isolation holds.** Entries already merged before a concurrent-engine
  refusal stay shipped; every remaining entry hits the same refusal, since a live
  foreign claim does not release mid-wave. A wave can therefore report `tipMoved`
  together with `committed: true`.

**Dropping a commit requires owning it.** `git.dropLastCommit(cwd, expectedSha)` — the
guarded revert every gate failure depends on — refuses, naming both shas, unless the
current tip is the sha the caller itself created. Dropping another writer's commit
blind is the defect; the refusal leaves recovery to the operator with the evidence in
hand. Tip verify is the same idiom at wave scale.

**And dropping it must not take bystanders.** On the shared checkout the same revert
preserves uncommitted state it did not author: the reset carries keep-semantics
(`reset --keep`, never `--hard`), so an operator's staged or unstaged work survives
any engine revert whose diff does not touch it — and a textual collision refuses
loudly with both writers' work left in place, instead of wiping a tree that may be
the only home of state the engine itself declined to sequence moments earlier
(field-paid downstream: one wave-merge reset destroyed staged operator content and a
refused tick's unstaged writes together, recoverable only from an operator-side
snapshot). Inside an ephemeral worktree the engine is the only writer and `--hard`
stays correct — the distinction is authorship of the tree, not squeamishness about
the flag.

## Declining a tick before the invocation

**The chain decides whether a tick is worth spending; the engine supplies the skip.**
`Phase.shouldRun?: (ctx: TickContext) => boolean` is consulted **before** the prompt is
rendered or the agent invoked. Returning `false` ends the tick as a declined no-op: no
agent invocation, no commit, `handoff` still runs so the chain can pass the baton on.

- **Undeclared is unchanged behavior.** A phase without `shouldRun` always runs,
  byte-identically to one whose predicate returns `true`. A capability with an
  injection point, not a policy — the engine ships no default that skips anything.
- **Context is what already exists.** The predicate sees the same `TickContext`
  `promptArgs` sees: `cwd`, `flumeDir`, `pending` (all entries, for singleton phases
  that read the plan), `assignedEntry` (fanout). No new plumbing.
- **Synchronous, and cheap by contract.** It runs before every invocation; a predicate
  needing I/O is doing work that belongs in the tick it is trying to avoid.
- **What a decline saves depends on the concurrency.** A singleton decline
  (`Dispatcher.runSingleton`) costs a `rev-parse` and the pending read, nothing else.
  A fanout decline is per-entry and consulted inside `Dispatcher.runFanoutEntry`, with
  `ctx.cwd` set to that entry's worktree — which means it runs *after* the whole batch
  has been provisioned (`createWorktree`, serially) and after every `setupWorktree`
  hook has completed, dependency install included. A declined fanout entry therefore
  saves the agent invocation, not the worktree or its install; the worktree is built,
  skipped, and torn down with the wave.
- **A declined tick is a distinguishable fact**, never a silent no-op: `declined: true`
  on `TickOutcome` and on the tick verdict, separate from `voluntary-bail` (the agent
  ran and refused) and from hibernation (nothing was awake). A supervisor must be able
  to tell "the chain declined" from "the agent bailed" without reading session logs.
  Per-entry under fanout: a wave sets `declined` if any provisioned entry declined,
  even when its siblings shipped.

**Why the seam exists:** measured on a 50-tick run, 14 plan ticks — 28% — spent a full
agent invocation to conclude "the queue has pickable work, hand to build," a verdict
computable from `pending.json` before any agent runs. `handoff` runs after the tick and
gates run after the commit; nothing was consulted before the invocation.

## The no-commit taxonomy

A tick that produces no usable commit is classified as exactly one **`NoCommitMode`**
(`src/Prompt.ts`) — four causally-distinct modes, so retries can tell what happened and
platform failures stop masquerading as agent failures:

| mode | meaning |
| --- | --- |
| `gate-revert` | a commit was made and a gate reverted it |
| `voluntary-bail` | the agent exited cleanly without committing — it refused a constraint rather than do the wrong thing |
| `platform-preempt` | the agent process failed for non-work reasons (rate-limit, auth, dispatcher-killed, or a per-tick timeout where one is set — below) — explicitly **not** a defect in the work |
| `render-refused` | the prompt itself never resolved, so the agent was never invoked (`spec/prompt.md`) |

Two facts sit **beside** this union and are never folded into it, because neither is a
cause the four classes classify: `tipMoved` (the harness's own backstop refused; nothing
about the work was at fault) and `declined` (no agent ran at all, so there is nothing to
classify). A nothing-pickable no-op carries no `noCommit` either — no agent was
attempted.

- **The four modes classify how a tick failed to produce a usable commit — nothing
  else.** How the agent process ended is consulted only when the ref did not move:
  `Dispatcher.runSingleton` and `runFanoutEntry` both `rev-parse` unconditionally after
  the invocation and reach `classifyNoCommit` only in the no-commit branch. A commit the
  agent made *before* a non-zero exit, an abort, or a spawn failure is honored like any
  other — tip verify, the full afterCommit stack, cherry-pick, afterMerge, and it can
  ship. `Dispatcher.AgentTermination` declares this deliberate: with a commit in hand,
  how the process ended is irrelevant. Nothing records that the producing process died,
  so a chain wanting that distinction must get it from the agent.
- **No per-tick timeout ships.** `DispatcherOptions.tickTimeoutMs` is the only timeout
  seam, and `Dispatcher.invokeAgent` forwards it only when set. The CLI constructs its
  dispatcher without one and no chain field declares it, so under `flume tick` and
  `flume loop` a hung agent blocks the tick — and the supervisor awaiting the child —
  until the operator kills it. The `platform-preempt` timeout case is reachable only by
  a programmatic embedder.
- **The classification reaches the chain.** `TickResult.noCommit` (`src/Phase.ts`) is
  folded in before `phase.handoff(result)` runs, so a `handoff` can wake a sibling on a
  bail that `shippedTags`/`gateResults` alone cannot distinguish from a genuine no-op.
  Absent on committed ticks; a handoff that ignores the field behaves identically.
  `TickResult.revertedTags` carries tags whose commits were reverted at merge time, so
  merge-thrash is distinguishable from an in-session retry.
- **The nothing-pickable no-op is stated, not left to be reconstructed.** A fanout tick that
  found nothing to run carries `TickResult.nothingPickable: true` and
  `TickResult.quarantinedTags` — the tags selection skipped because the supervisor
  quarantined them this run (*Repeated identical failures*, below). Both are facts; the
  wake decision stays the chain's. Without them a chain reading `pendingAfter` sees the
  quarantined entry as `open`, hands back to the same phase, and the run burns no-op
  ticks to `--max` — the live-lock the fields exist to make expressible. Absent on every
  tick that provisioned an entry; `quarantinedTags` is empty, never absent, on a
  nothing-pickable tick with no quarantine.
- **The classification reaches disk.** It rides `TickOutcome.noCommit`, the tick verdict,
  and the per-entry prior-attempt record.
- **A wave reports one representative cause** when it shipped nothing, by precedence
  `gate-revert > render-refused > platform-preempt > voluntary-bail`: platform failures
  outrank bails because a platform failure masquerading as an agent failure is the harm
  this taxonomy exists to prevent, and a render refusal is a real defect in the
  prompt/config, so it outranks both non-defect classes. Each entry's own mode is still
  persisted to its own prior-attempt record.

## Prior-outcome feedback to the retrying tick

A reverted tick that forwards no signal makes the loop amnesiac: the reset erases the
sha, so `git log` shows nothing happened and the same wall is re-derived every attempt.
When a prior tick for the same entry (fanout, keyed by tag slug) or phase (singleton,
keyed by phase name) produced no usable commit, the next tick receives a **`PriorAttempt`
record** — a mode-tagged union, exactly one variant — rendered into its prompt as a
dispatcher-owned `<prior-attempt>` block:

- `gate-revert` — which gate phase reverted (`afterCommit` or `afterMerge`), the gate's
  `name`, its one-line `message`, its full `details`, and a `git show --stat` digest of
  the reverted commit. Fires for `afterMerge` as well as `afterCommit`: a merge-time
  failure that dies with the dispatcher process is the anti-pattern this closes.
- `voluntary-bail` — the constraint the agent refused to cross, taken from the tail of
  its final message.
- `platform-preempt` — the failure class, marked as not a defect in the prior work.
- `render-refused` — every failing inline-exec span's command text and stderr.
- `tip-moved` — the expected and observed tips.

- **Cross-process by construction.** Persisted at
  `<flumeDir>/prior-attempts/<key>.json` — `priorAttemptPath(flumeDir, tag)`, the
  exported rule (`spec/pending.md`, *What the package exports*) — and read by the next
  `flume tick` at prompt render. There is no in-memory handoff to assume.
- **Every record is anchored.** Each variant carries `headSha` — the trunk tip when the
  record was written — and `at`, an ISO timestamp. A chain deciding "bailed, and nothing
  has changed since" compares `headSha` to the tip, never the record file's mtime to a
  commit time.
- **A gate that names its failing files earns a flake marker.** A `gate-revert` record
  whose gate result carried `failingFiles` (`spec/chain.md`, *What a gate returns*) and
  whose every named file is **disjoint from the reverted span's footprint** is marked
  `suspectFlake: true`: the entry's own edits cannot have caused a failure in files it
  never touched. The marker is derived, never trusted — the engine computes it from the
  two lists, and a gate that reports no `failingFiles` earns no marker.
- **Bounded by construction — a digest, not a transcript.** Gate details, diffstats,
  and agent messages are each capped at a few KB with an explicit truncation marker.
- **No false signal.** The slot is absent on a first attempt, and a clean ship clears
  the record. A corrupt record, or one carrying an unrecognized `mode`, is treated as
  absent rather than fed to the renderer.
  > **Note:** the block is dispatcher-owned and structural — a prompt file declares
  > no `<prior-attempt>` slot and cannot position or suppress it. See `spec/prompt.md`.

## The tick verdict — one facts artifact

Every tick that actually runs a phase writes **one verdict artifact** carrying: phase
name, entry tags provisioned, `committed`, the no-commit class, `tipMoved`/`declined`,
each gate result in run order (`TickVerdictGateResult`: the `gate` name, its `ok`
verdict, its one-line `message`, and its captured `details` — where `writablePathsGate`
lists the violating paths), shipped tags,
each provisioned span's cherry-pick/merge fate with its footprint **and its head
sha** — per entry under fanout, the phase's own single span under singleton — any
provisioning failures, and the tick's own one-line summary. The sha is recovery,
not decoration: a span that was parked or refused after its gates passed must be
re-cherry-pickable from the verdict alone, never re-run at full agent price —
worktree teardown deletes trees and refs, but the objects survive in the shared
store until gc, and the verdict is the only place their sha outlives the branch.

- **Gate results stop at the first failure.** Both gate loops return on the first red
  gate — `Dispatcher.runAfterCommitGates` and the afterMerge loop in
  `Dispatcher.runFanout` — so `gateResults`, and the `<prior-attempt>` record derived
  from it, end there. A gate absent from the list never ran; it did not pass.

  Order is the chain's declaration order, with one engine-appended exception:
  `writablePathsGate` runs **after** every chain-declared afterCommit gate
  (`Dispatcher.runAfterCommitGates`). Combined with the short-circuit, a commit that
  both breaches the fence and fails a chain gate reports only the chain gate — the
  fence violation never reaches the `<prior-attempt>` record, so the retry rediscovers
  it. On a fanout wave the list is every entry's results concatenated
  (`Dispatcher.runFanout`), so absence is per-entry rather than per-tick, and one red
  result can be followed by more from later entries.
- **Two paths under the state dir.** `<flumeDir>/tick-verdict.json` holds this tick's
  verdict alone, cleared before the tick's own work begins so a tick that never reaches
  the write (chain-load failure, hibernation, terminal misconfiguration) leaves nothing
  the supervisor can misread as its own. `<flumeDir>/tick-verdicts.jsonl` appends every
  verdict, bounded to a rolling 200 — history, never cleared.
- **The CLI writes it, not `Dispatcher.tick()`.** `tick()` returns the verdict as a
  pure value on `TickOutcome.verdict`; the `tick` command persists it
  (`writeTickVerdict`). A unit test calling `tick()` directly gains no untracked side
  effect.
- **Every verdict is anchored.** `headSha` is the trunk tip when the verdict was written
  and `at` its ISO timestamp, so "has the world moved since this phase last ran" is a
  comparison against engine state, never an inference from which paths the last commit
  touched — and a phase need not commit on a quiet tick just to leave an anchor behind.
- **Every agent invocation leaves a usage row.** `invocations[]` carries one row per
  agent run in the tick — one for a singleton, one per provisioned entry under fanout —
  with the entry `tag` (absent for a singleton), the agent's model id, turn count,
  duration, and the token counts the agent reports: input, output, cache-creation, and
  cache-read, each as its own field, because cost is unrecoverable without the cache
  split. Recorded when the agent emits them, absent per field when it does not; a chain
  wanting cost telemetry reads the verdict rather than re-parsing the agent's stream in a
  decorator beside it.
- **`readTickVerdicts(flumeDir, n)` is exported** so a chain can render recent tick
  history into a prompt. Whether and what to render is the chain's call.
  **`readLatestVerdictsSync(flumeDir)`** is exported beside it, returning the most recent
  verdict per phase name, synchronously — `shouldRun` and `handoff` are synchronous by
  contract, and the anchor above is useless to them behind an `await`.
- **No interpretation fields.** The artifact records what happened, never what it
  means. "Errored" is not stored: `superviseLoop` derives it at the read site from the
  facts (`gate-revert`, `platform-preempt`, `render-refused`, `tipMoved`, or a
  provisioning failure that left nothing shipped — never `voluntary-bail`, which is the
  agent correctly declining). "Park", "bail worth waking for" are chain readings, not
  engine vocabulary.
- **It is the supervisor's only fact channel.** Child stdio stays `inherit` —
  live-streamed agent output is operationally load-bearing, and piped-and-parsed stdout
  is declined. Exit codes carry *class* (enough for continue-vs-abort); the verdict
  carries counts.
- **Corrupt or partial input degrades to "not a verdict"**, never a thrown parse error
  surfacing as a tick failure; a missing record is never read as a prior tick's stale
  one.

## Exit codes — the run never lies to CI

Classification happens at the process boundary so a caller never has to read logs
(`tickExitCode`, `loopExitCode` in `src/cli.ts`).

`flume tick`:

| code | meaning |
| --- | --- |
| 0 | work done, or clean hibernation |
| 1 | harness error, HEAD detached, or another live process holds the tip claim |
| 2 | usage — including the CJS-context host refusal, a nameable fix rather than a dead chain (`spec/chain.md`) |
| 69 | `EX_MOUNT_DEAD` — the chain module could not load, its state root is missing, or its declaration is invalid (no agent ran); or `pending.json` failed to parse (see below) |
| 78 | `EX_TERMINAL_MISCONFIG` — the chain resolved but declares an inconsistent world (below) |

**69 does not promise "no agent ran".** That holds for the chain-resolution legs, and
for the pending-parse leg when the refusal came from a decide-read — but
`Dispatcher.tick`'s `PendingParseFailure` catch also covers `commitPendingUpdate`'s
rewrite read, which runs *after* a wave's cherry-picks have merged. A fanout tick can
therefore exit 69 having run N agents and landed their work on trunk, with only the
ledger rewrite refusing rather than deriving a rewrite from a parse it never trusted.
Either way a fresh process reads the same unparseable file until a human fixes it, and
that leg writes no verdict at all (see *The tick verdict*).

`flume loop` (and `job run`):

- **Mount-dead aborts immediately.** The supervisor fail-fasts on a child's 69 and
  propagates it, rather than burning the remaining `--max` ticks re-hitting the same
  wall. A mount-dead chain is exactly as dead next tick as this one.
- **78 propagates likewise.** Exiting 0 would re-mask the misconfiguration one process
  boundary up.
- **Otherwise non-zero iff at least one tick errored AND zero entries shipped.**
  "Settled with nothing to do" stays 0. Partial success — ships landed despite some
  tick errors — stays 0, with the errors named in the completion summary so they never
  vanish into a silent green exit.
- **The consecutive-failure abort is unconditionally 1**, regardless of how much the
  run shipped before hitting the wall (below).
- **Tick-level agent failures do not halt the run.** A plain non-zero child exit is
  logged and the loop proceeds — the next tick is a fresh process. Only the classes
  above abort. It still *counts*: a child exiting non-zero is an errored tick whether
  or not it wrote a verdict, so a run of refused ticks — a CJS-context refusal, a
  chain-load failure, an uncaught throw out of `Dispatcher.tick` — cannot burn every
  `--max` tick and still exit green.
- `2` for a bad `--max` (missing, non-numeric, negative); no tick runs.

The run-level totals (`shippedTags`, `erroredTicks`) accumulate across iterations from
each child's on-disk verdict — the exit-code decision needs the whole run's total, not
the last tick's.

## Terminal misconfiguration — the orphaned baton

Outcomes travel three axes: **A** work outcome (the no-commit taxonomy above,
per-entry, retryable), **B** clean quiescence (hibernated, exit 0), **C**
precondition/config error — the declared world is inconsistent; deterministic,
non-retryable, no agent ran. `TickOutcome.terminal?: { kind: "orphaned-awake"; phases:
string[] }` is Axis C's founding member: awake flags naming phases the chain does not
declare. `kind` is a union open to future members; each arrives with its own spec text.

- **A misconfigured baton must terminate the loop loudly**, not hot-spin. Routed onto
  Axis B it would report hibernation while the flag stayed on disk, so a supervisor
  whose only stop signal is `Baton.hibernating()` would never stop.
- **`flume tick` exits 78** when `terminal` is set — distinct from 0 and from the
  mount-dead 69.
- **The supervisor stops on the child's exit signal alone.** It must not consult
  `Baton.hibernating()` for this decision; the orphaned flag definitionally defeats it.
  The flags are re-read only to *name* the orphans in the summary.
- **Mixed flags classify at quiescence.** While any declared phase is awake the tick
  runs it and the orphan persists untouched; `terminal` fires once every remaining
  awake flag is orphaned — eventually-loud, never silently cleared.
- **The orphaned flag stays on disk.** Clearing it would convert the misconfiguration
  into a silent clean stop. The human inspects, then `flume sleep <phase>` or fixes the
  chain.

## Repeated identical failures — quarantine, then abort

A deterministic failure repeats identically every tick — the burn shape the mount-dead
abort exists to prevent, and after the invocation each lap is paid at full agent price.
The accounting therefore covers **every per-entry failure fact the verdict records**,
keyed by stage-tagged signature:

- **provision** — a pre-tick worktree provisioning failure (sweep or create), recorded
  as a `ProvisionFailure` (signature, and the entry tag when one can be blamed). Never
  reaches agent invocation, so it is not a no-commit mode.
- **merge** — a cherry-pick failure at the merge stage (a conflict, or a dirty trunk
  refusing the pick), recorded with the entry tag it kept pending.
- **gate** — a gate revert, signature derived from the gate's name and failure output.
  A retry that genuinely attempts something different produces different output and
  breaks the streak by construction; only byte-identical repetition accumulates, and
  output noise that defeats equality merely makes the brake conservative.

A voluntary bail or park never joins the accounting — an agent correctly declining and
naming its constraint is not evidence anything went wrong. A signature is the bounded,
trimmed failure message used as an **opaque equality key**: compared, never parsed, so
no stage's message grammar becomes engine-read prose (`engine-boundary.md`, *Told, not
inferred*).

Two legs, not either alone:

- **Per-entry quarantine.** The supervisor quarantines the failing entry's slug for the
  remainder of the run: the entry stays in `pending.json` untouched, other entries keep
  dispatching. The quarantine crosses to each child via `FLUME_QUARANTINED_SLUGS`. It
  is run-scoped — a fresh run retries the slug, so a transient hold costs at most the
  rest of one batch — and logged distinctly (tag, stage, failure signature) so the skip
  is visible, never silent, and reported to the chain on `TickResult.quarantinedTags`
  (*The no-commit taxonomy*) so a handoff can tell a quarantined `open` entry from a
  pickable one. Only a *tagged* failure quarantines; a repo-level one no entry can be
  blamed for falls to the backstop.
- **Consecutive-identical-failure backstop.** If the same stage-tagged signature
  repeats three consecutive ticks with no clearing tick between them, the run aborts
  non-zero with a summary naming the repeated signature. This covers the
  non-entry-scoped class quarantine cannot isolate, generalizing the mount-dead abort
  past its class without touching its semantics. Any tick recording no failure of the
  class clears the streaks. The streak is keyed by signature across the whole tick, not
  by the first failure recorded — a multi-failure tick is the normal shape
  (`Dispatcher.runFanout` pushes a repo-level prune failure first, then one per failing
  `createWorktree`), so a signature repeating behind a varying sibling still
  accumulates.

Both constants are **engine defaults, chain-overridable** — `supervisorPolicy.quarantineScope`
(`"run"` default, `"none"` disables the quarantine leg while the backstop still fires)
and `supervisorPolicy.abortThreshold` (default 3). The declaration surface is
`spec/chain.md`; policy constants enter the engine only as overridable defaults, never
as fixed behavior.
