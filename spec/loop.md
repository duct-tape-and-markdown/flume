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
- **Ephemeral fanout branch names.** `Dispatcher.createWorktree` constructs
  `flume/<namespace>/<slug>` (or repo-global `flume/<slug>` with no namespace);
  provisioning is `git worktree add -B` (`git.addWorktree`), and teardown removes the
  worktree (`git.removeWorktree`) and then deletes the branch with `git branch -D`
  (`git.deleteBranch`, called from `Dispatcher.runFanout`). The grammar is the engine's
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
  - *Scope:* loop-level only. A bare `flume tick` takes no claim — the tip verify
    below covers it.
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

`flume status` reports supervisor liveness and the current tip's claim, observationally
— see `spec/cli.md`.

## Tip verify — commit only onto the tip the tick started on

The correctness backstop behind the claim's signal: it catches an operator committing
mid-tick, a pull moving the ref, and claim-less bare-tick collisions. The dispatcher
records the tip at tick start and refuses to let a commit land on anything else. A
refusal means **no commit**; the tick ends with a `tip-moved` fact, and the entry — if
the tick carries one — stays in `pending.json` for a fresh retry against the new tip.
The engine reports the fact; the chain owns what it means.

What survives on disk depends on which leg refused. Where the dispatcher undoes a
commit it observed (`Dispatcher.checkTipMoved`, singleton and per-entry), the undo is
`reset --soft` (`revertTipMovedCommit`) — but what that buys differs by leg. On the
singleton leg the reset runs in the repository itself, so the agent's work stays in the
working tree. On the per-entry leg it runs inside the entry's worktree, which the wave's
teardown loop removes unconditionally (`git.removeWorktree`, `Dispatcher.runFanout`);
the uncommitted work goes with it, and no snapshot is taken — `snapshotRevertedFiles`
rides the afterCommit gate-revert leg only. Where a wave refuses *before* cherry-picking,
no reset is involved: that entry's commit is still on its private worktree branch, which
teardown removes along with the worktree. The entry stays pending in every case; only
the residue differs.

The check takes the shape the commit site allows:

- **Agent-made commits are verified after the fact.** The agent commits directly, so
  the dispatcher never sees the moment of commit: `Dispatcher.checkTipMoved` compares
  the new commit's own *parent* against the recorded tip, and on mismatch soft-resets
  the commit away (`revertTipMovedCommit`, which itself refuses unless the current tip
  is the sha it observed). Run before any gate — a commit on the wrong parent is
  refused regardless of what the gates would have said. Soft rather than hard, so the
  work survives wherever its working tree does (above).
  > **Note:** "re-read the ref before committing" describes the harness's own commits
  > only. An agent-made commit cannot be checked before it exists, so the guarantee
  > here is equivalent rather than identical: a commit whose parent is not the recorded
  > tip could not have been made on it, and is refused on that basis.

- **The revert measures the real span, and cannot attribute it.** A tick landing more
  than one commit produces `parent(postHead) ≠ preHead` exactly as external
  interference does, so `revertTipMovedCommit` counts the commits between the two
  (`git.commitsSince`) and soft-resets all of them rather than assuming one. The
  engine has no way to separate its own N commits from its own N−1 plus an
  operator's: the evidence is identical.

  The accepted consequence is that an operator commit landing inside the tip-verify
  window is soft-reset alongside the tick's own. The reflog holds it, so nothing is
  destroyed, but it leaves the tip. This is the deliberate trade — fully undoing a
  multi-commit tick is the common case, while racing the tip claim is the case the
  claim exists to discourage. It reverses if the dispatcher gains a way to count its
  own commits as it makes them: the revert could then bound itself to its own span
  and leave any excess in place.
- **Harness-driven commits re-read the ref first.** A fanout wave checks the tip
  before each `cherry-pick` (`Dispatcher.runFanout`) and again before the
  pending-ledger commit (`commitPendingUpdate`, checked *before* the `writeFile` so a
  refusal leaves `pending.json` untouched rather than a write with no commit behind
  it). The wave's expected tip advances to each successful merge's sha — the wave's own
  progress is not "moved"; anything else is external interference.
- **Per-entry isolation holds.** Entries already merged before the interference stay
  shipped; every remaining entry in the wave hits the same refusal, since the
  interference does not undo itself. A wave can therefore report `tipMoved` together
  with `committed: true`.
- **A ledger refusal after partial merges leaves the queue behind the tree.** When the
  ref moves between a wave's last cherry-pick and the pending-ledger commit,
  `commitPendingUpdate` returns `tipMoved` before the write, so `pending.json` still
  lists entries whose commits are already on the tip — and `Dispatcher.runFanout` has
  already cleared their prior-attempt slots (`clearPriorAttempt`) on the way in. The
  next tick re-picks them as pickable and dispatches agents against work that shipped,
  with no prior-attempt block to say so. The engine reports the fact; nothing
  reconciles the queue against the tree.

**Dropping a commit requires owning it.** `git.dropLastCommit(cwd, expectedSha)` — the
guarded revert every gate failure depends on — refuses, naming both shas, unless the
current tip is the sha the caller itself created. Dropping another writer's commit
blind is the defect; the refusal leaves recovery to the operator with the evidence in
hand. Tip verify is the same idiom at wave scale.

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
  `<flumeDir>/prior-attempts/<key>.json` and read by the next `flume tick` at prompt
  render. There is no in-memory handoff to assume.
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
each fanout entry's cherry-pick/merge fate with its footprint, any provisioning
failures, and the tick's own one-line summary.

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
- **`readTickVerdicts(flumeDir, n)` is exported** so a chain can render recent tick
  history into a prompt. Whether and what to render is the chain's call.
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
| 1 | harness error, or HEAD detached |
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
  is visible, never silent. Only a *tagged* failure quarantines; a repo-level one no
  entry can be blamed for falls to the backstop.
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
