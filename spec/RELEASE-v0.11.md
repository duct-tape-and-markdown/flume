# Flume — v0.11 Release Target (minor: the boundary line)

## 1. Purpose & scope

Two rulings (operator, 2026-07-31), one boundary:

**The engine records, never navigates.** The engine's entire git
surface is the tick record — one tick = one commit on the tip it was
handed, plus the guarded revert its gates depend on, plus observational
reads. Topology — branches, worktrees, merges, endings — belongs to the
implementation. The engine never runs `checkout`, `branch`,
`cherry-pick`, or `merge`, and ships no branch grammar.

**The engine owns the tip its process runs on.** The tip (the ref HEAD
resolves to) is the one resource the engine's commit mechanic consumes,
so the engine defends it: an advisory claim ensures one flume writer
per tip, and an optimistic verify refuses to commit onto a tip that
moved mid-tick. Not a total lock — a signal, plus a fact when the
signal was bypassed. The engine does not choose the tip, name it, or
move between tips.

Why: the job apparatus (v0.5 §5, grown through v0.6.x) put the engine
on the wrong side of its own boundary — branch grammar (`job/<name>`),
mount choreography (`job new`'s branch+checkout+seed), assert-or-
checkout preflights, and a 200-line cherry-pick ending (`extract`)
whose whole purpose is filtering back out the harness commits the model
interleaved into work history. A migration week of field evidence
sorted cleanly: the flags (pick-tax, two-homes state, mutating mount
verbs, resolution-authority misreads, stacked isolation mechanisms)
all trace to the job apparatus; jobless implementations running plain
state roots on a trunk produced none. Meanwhile the model's implicit
lock (`loop.pid`, per state root) never guarded the actually-contended
resource — the ref — which multiple-jobs-per-checkout would have
exposed as a race with no refusal anywhere. Under
`.claude/rules/engine-boundary.md`: git as a state record is the
product value and stays; git coordination was the engine absorbing
convention, and it goes.

Git remains the record because the record gets better, not worse: a
job's progression is path-scoped history (`git log -- <state root>`) on
the branch where the work landed, adjacent to the commits it caused,
with no dedicated branch to visit, sync, or filter.

Version-mismatch posture carries over from v0.9: the removals are
subtractive, and out-of-model invocations (a stale `job/<name>` branch
workflow) get documentation, not machinery.

Supersedes v0.5 §5 (the job convention: branch grammar, lifecycle
choreography, extract), v0.6 §4 (`job new`'s branch legs; seeding
itself survives), and v0.6 §5 (`Chain.harvest` — extract's consumer
dies with it). Frozen files stay frozen; this file is the ruling of
record. v0.6 §2–3 (config/state residency and `--job` resolution) and
v0.6.2 §6 (`Chain.friction`, minus its extract-harvest leg) survive
unchanged.

Blast radius: `src/job.ts`, `src/cli.ts`, `src/Dispatcher.ts`,
`src/Phase.ts`, `src/git.ts`, `tests/`, `README.md`, `docs/CLI.md`,
`docs/CHAIN-AUTHORING.md`, new `docs/MIGRATING-0.11.md`, CHANGELOG.
Net-negative line count is the expectation, not a hope. This repo's
own `.flume/chain.ts` declares none of the removed fields — no
companion change.

Explicitly not in this line: any engine verb that creates branches or
worktrees; per-tick claims; mtime-heartbeat claim staleness
(evidence-gated: ships only if containerized-bay reclaim incidents
appear — pid-liveness is correct for the single-machine bays that
exist); commit-tree+update-ref CAS commits (the verify's residual
check-to-commit window defends against race-timed adversaries the
threat model doesn't contain); any replacement for `extract`.

## 2. A job is a state root

A job is `.flume/jobs/<name>/` — tracked files in the working tree, on
whatever branch the operator is on. Nothing more. Multiple jobs
coexist under one checkout by construction; `--job <name>` /
`FLUME_JOB` select which state root a tick reads, via the existing
resolution (v0.6 §3, untouched).

- The `job/<name>` branch convention is retired: no engine surface
  creates, asserts, or names such a branch.
- The HEAD == `job/<name>` guard legs on `tick` and `loop` (and their
  exit-code documentation) are removed — the engine has no opinion on
  which branch a state root runs on.
- Concurrency is not a posture but a derivation: two jobs run
  alternately under one checkout serialize on the §4 tip claim; to run
  jobs hot simultaneously, the operator gives them different tips
  (`git worktree add` — the operator's act, never the engine's).

Acceptance: `grep -rn 'job/' src/` shows no branch-name construction;
`flume tick`/`flume loop` under `--job` run on any branch; two state
roots under one checkout each tick successfully (fixture: distinct
batons, one branch, sequential runs).

## 3. Job verbs shed navigation; extract is removed

Every surviving verb keeps its record-side behavior and loses its
branch legs. `JobUsageError` classification is unchanged.

- **`job new <name>`**: mkdir + seed from the chain's declared
  `seedDir` (verbatim, skip-existing, declared-but-absent is usage
  error — all per v0.6 §4), ensure runtime ignores (incl. declared
  friction dir), win32 `core.longpaths`, pathspec-scoped baseline
  commit **on the current HEAD**. No branch created, no checkout,
  non-mutating with respect to git topology. Idempotent on re-run.
- **`job run <name>`**: wake the chain's entry phase iff the job's
  baton is hibernating, then loop under the job resolution. The
  branch-exists check and assert-or-checkout preflight are removed.
- **`job rm <name>`**: refuse on a live loop; pathspec-scoped
  `git rm` + cleanup commit **on the current HEAD**; sweep untracked
  runtime remnants. The checkout leg is removed; the operator's
  branches are never touched.
- **`job status`**: unchanged (already observational).
- **`job extract`** is removed entirely, with `Chain.harvest` and its
  tests. The clean-history ending is the implementation's branch
  strategy now: run the job on a side branch, integrate however the
  deliverable demands — ordinary git, documented as a recipe in
  `docs/MIGRATING-0.11.md`, never engine machinery. Friction files
  are read off the working tree by their owner, as v0.6.2 §6 always
  allowed.

Acceptance: `grep -n 'checkout\|cherry-pick\|branch' src/job.ts` hits
no git invocations; `grep -rn 'harvest' src/` is empty; `job new` on a
branch `foo` leaves HEAD on `foo` with one baseline commit; extract's
test suites are deleted, not rewritten.

## 4. Tip claim — one flume writer per tip, advisory

A `flume loop` claims the tip at start and releases it at exit.

- **Keying**: the claim lives at
  `<git-common-dir>/flume/tip-claims/<ref path>` (e.g.
  `.git/flume/tip-claims/refs/heads/main`), mirroring the ref path as
  directories. The common dir resolves identically from every linked
  worktree — a claim taken in one is visible from all. Tool state
  under `.git/` follows the `git-lfs`/`sequencer` precedent: shared,
  untracked, survives branch switches.
- **Acquire**: exclusive-create (`wx`). On `EEXIST`, probe the
  recorded pid with the same liveness check as the loop lock: live →
  refuse, naming the holder (`tip refs/heads/X claimed by pid N
  (<path>)`), exit 1 — the same operational class as the loop-lock
  refusal; dead → reclaim (unlink, retry the exclusive create).
- **Contents**: the holder's pid, nothing else — consistent with
  `loop.pid`. Release in the same `exit`/`SIGINT`/`SIGTERM` handlers;
  a `kill -9` leaves a stale claim the liveness probe reclaims.
- **Scope**: loop-level only. Bare `flume tick` takes no claim — §5
  covers it. The loop lock (one supervisor per state root) and the
  tip claim (one writer per ref) guard different resources; both
  stand.
- **Detached HEAD**: `loop` and `tick` both refuse (exit 1) — the tick
  record's meaning is advancing a named tip, and the claim keys on a
  ref. The refusal names the state plainly.
- **`flume status`** reports the current tip's claim alongside
  supervisor liveness ("tip claimed by pid N" / stale), observational.

Acceptance: two `flume loop`s against different state roots on one
branch — second refuses with the holder pid; same two loops from two
worktrees on different branches — both run; claim file gone after
clean exit and after SIGTERM; a hand-planted claim with a dead pid is
reclaimed silently; `flume loop` on detached HEAD exits 1 before any
tick.

## 5. Tip verify — commit only onto the tip the tick started on

The dispatcher records the tip's sha at tick start. Immediately before
committing the tick's output, it re-reads the ref: unchanged → commit;
moved → **no commit**, the tick ends with a tip-moved outcome — a new
fact in the tick summary/verdict alongside the existing gate-failure
facts. Agent output stays on disk. The engine reports the fact; the
chain owns what it means (retry against the new tip, abort, wake
policy).

This is the correctness backstop behind §4's signal: it catches an
operator committing mid-tick, a pull moving the ref, and claim-less
bare-tick collisions. Same idiom the engine already trusts in
miniature — the guarded revert refuses to drop a commit whose sha it
didn't create.

Acceptance: fixture advances the ref between agent completion and
commit → tick reports tip-moved, no commit lands, working tree retains
agent output; unmoved ref commits exactly as today; the tip-moved
outcome is distinguishable in the verdict a supervisor reads.

## 6. Docs

- `README.md`, `docs/CLI.md`: jobs described as coexisting state
  roots; branch guidance reduced to "run on whatever branch you want
  the record on"; worktrees documented as the operator's parallelism
  recipe; tip claim/verify behavior documented as facts an operator
  may hit.
- `docs/CHAIN-AUTHORING.md`: `harvest` retired; `seedDir` and
  `friction` unchanged.
- New `docs/MIGRATING-0.11.md`: for bays with live `job/<name>`
  branches — integrate or abandon the branch with ordinary git (merge
  keeps the record, squash keeps it clean; the state root rides
  either way), delete the branch, done. Includes the extract-
  replacement recipe (side branch + operator integration).

Acceptance: `grep -rin 'extract' README.md docs/CLI.md
docs/CHAIN-AUTHORING.md` is empty; MIGRATING-0.11 contains the
branch-integration and extract-replacement recipes.

## 7. CHANGELOG

- 0.11.0 section: Breaking — the job branch convention (`job/<name>`)
  is retired; `flume job extract` and `Chain.harvest` are removed; the
  HEAD-guard legs on tick/loop are removed; `job new`/`run`/`rm` no
  longer create, assert, or switch branches. Added — advisory tip
  claim (one flume writer per tip, worktree-visible, stale-reclaimed)
  and tip-moved verify (no commit onto a tip that moved mid-tick;
  reported as a tick fact). Existing `job/<name>` branches are the
  operator's to integrate — see MIGRATING-0.11.
- Version bump + `npm publish` stay human-performed at cut time.
