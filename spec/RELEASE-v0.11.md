# Flume — v0.11 Release Target (minor: the boundary line)

## 1. Purpose & scope

Four rulings, one boundary. The first two (operator, 2026-07-31) draw
the line between the engine and the implementation's git topology; the
third (operator, 2026-08-01, §6) draws it between the engine and the
chain's module graph; the fourth (operator, 2026-08-01, §8) draws it
between the engine and the decision to spend a tick at all:

**The engine records, never navigates.** The engine's entire git
surface is the tick record — the commits a wave produced, landed on the
tip it was handed, plus the guarded revert its gates depend on, plus
observational reads. *Navigation* — choosing which line of history the
operator is on: `checkout`, `branch`, branch grammar, endings — belongs
to the implementation. The engine never runs `checkout` or `branch`, and
ships no branch grammar.

The engine does run `cherry-pick`, and that is recording, not
navigating: a fanout wave's per-entry worktree commits are carried onto
the tip the tick started on, in order, with `cherry-pick --abort` on
conflict (`src/git.ts`, `Dispatcher.runFanout`). The tick's own output
reaches the tick's own tip; no ref the operator chose is moved, created,
or checked out. The distinction is *whose* history is touched, not which
plumbing command is spelled — and the fanout merge is the one carve-out,
named here so it is a declared boundary rather than an unnoticed
violation.

**The engine owns the tip its process runs on.** The tip (the ref HEAD
resolves to) is the one resource the engine's commit mechanic consumes,
so the engine defends it: an advisory claim ensures one flume writer
per tip, and an optimistic verify refuses to commit onto a tip that
moved mid-tick. Not a total lock — a signal, plus a fact when the
signal was bypassed. The engine does not choose the tip, name it, or
move between tips.

**The engine hands the chain its API.** A chain is a plugin loaded into
a host, not a library consumer resolving its own copy. The engine calls
the chain's factory with its own surface; the chain imports no engine
value at runtime, so a second physical engine in one process stops
being reachable. See §6 — and §11, which applies the same ruling to the
one dependency that survived it running the other way: the zod objects
a chain hands the engine to merge into its own schema graph.

**The chain decides whether a tick is worth spending.** The engine
supplies the skip; the chain supplies the reason. Measured on a 50-tick
run: 14 plan ticks — 28% — spent a full agent invocation to conclude
"the queue has pickable work, hand to build," a verdict computable from
`pending.json` before any agent runs. The engine had no seam to say so —
`handoff` runs after the tick, gates run after the commit, and nothing
is consulted before the invocation. See §8.

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
workflow) get documentation, not machinery. §6 does not reopen it —
removing the chain's runtime dependency is an identity change, and it
compares no versions at all. Drift between a bay's *installed* version
and its chain stays parked, because after §6 the installed copy no
longer executes.

Supersedes v0.5 §5 (the job convention: branch grammar, lifecycle
choreography, extract), v0.6 §4 (`job new`'s branch legs; seeding
itself survives), and v0.6 §5 (`Chain.harvest` — extract's consumer
dies with it). §6 additionally supersedes v0.2 §2's `agent` named
export, v0.2 §3's default-export-a-`Chain` contract, and v0.3 §2's
`ChainModule.forkResolver` bridge. §10 supersedes v0.1 §3's "last
commit" clause. §11 supersedes v0.8 §2's per-field zod schema as the
declared type of an extension field. Frozen files stay frozen; this file is the ruling of
record. v0.6 §2–3 (config/state residency and `--job`
resolution) and v0.6.2 §6 (`Chain.friction`, minus its extract-harvest
leg) survive unchanged.

Blast radius: `src/job.ts`, `src/cli.ts`, `src/Dispatcher.ts`,
`src/Phase.ts`, `src/git.ts`, `src/index.ts`, `src/builtinGates.ts`,
`src/PendingSchema.ts`, new type-only `src/standardSchema.ts`,
`tests/`, `examples/`, `README.md`, `docs/CLI.md`,
`docs/CHAIN-AUTHORING.md`, new `docs/MIGRATING-0.11.md`, CHANGELOG.
Net-negative line count is the expectation for the job removals; §6 is
additive in the engine and subtractive in every chain. This repo's own
`.flume/chain.ts` declares none of the removed job fields, but §6 does
require a companion change to it — the dogfood chain moves to the
factory shape in the same commit as the loader that calls it. §8 needs
a second, separate companion change there (plan declaring `shouldRun`),
but that one is not atomic with the engine: an undeclared `shouldRun`
is unchanged behavior, so the seam ships first and the chain adopts it
after.

Explicitly not in this line: any engine verb that creates branches or
worktrees; per-tick claims; mtime-heartbeat claim staleness
(evidence-gated: ships only if containerized-bay reclaim incidents
appear — pid-liveness is correct for the single-machine bays that
exist); commit-tree+update-ref CAS commits (the verify's residual
check-to-commit window defends against race-timed adversaries the
threat model doesn't contain); any replacement for `extract`; any
loader hook, specifier rewrite, version handshake, or lockfile compare
in service of §6; any engine-side scheduling *policy* (§8 ships the
seam, never a default that skips anything); any change to
`TAG_MAX_LENGTH` itself (§9 bounds the directory name, not the tag);
any `flume status` verbosity flag; any zod peer-dependency, `FlumeApi`
re-export, or cross-copy version handshake (§11 removes the seam rather
than guarding it).

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
clean exit, and after SIGTERM on POSIX; on win32 SIGTERM maps to
`TerminateProcess`, which runs no handler, so the claim survives the
kill and the next acquirer's liveness probe reclaims it as stale —
release-on-signal is a POSIX guarantee, stale-reclaim is the
cross-platform one; a hand-planted claim with a dead pid is
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

## 6. The chain is a plugin, not a consumer

The engine hands the chain its API. A chain module's default export is a
**factory** the engine calls with its own surface; `chain.ts` never
imports the engine at runtime.

Why: a chain today writes `import { tscGate } from "@dtmd/flume"`, which
Node resolves by walk-up from the chain's directory. That makes the chain
a *consumer* resolving its own copy of a library — so a second physical
copy is reachable whenever the running engine is not the one the walk-up
finds. Two field-traced shapes (consumer bay, engine 0.9.0):

- A globally-installed engine is structurally unreachable from the
  chain's import, so the run dies with a raw `ERR_MODULE_NOT_FOUND`
  naming the very package that is running.
- With a bay copy present, the process runs **two engines**: the invoked
  dist drives the Dispatcher while the chain constructs Phase/Gate/Agent
  objects from the bay copy. `instanceof` and module-level state split
  across two physical copies **at equal versions**. Nothing reports it,
  and the output is commits.

The second is the one that rules the design. A silent degradation whose
product is commits is what `engineering.md`'s *Loud or nothing* forbids
outright, and a refusal is the wrong fix — the condition should not be
reachable. Removing the chain's runtime dependency removes it by
construction, where a specifier rewrite or an identity check would only
redirect or report it.

Shape:

- A chain module default-exports `(api: FlumeApi) => ChainModule`, where
  `ChainModule` is `{ chain: Chain; agent?: Agent; forkResolver?: ForkResolver }`.
  Everything the chain previously supplied as a named export now rides
  the factory's return, because a named export cannot receive the API.
- `FlumeApi` carries the runtime surface a chain composes with — the
  builtin gates, `setupWorktree`, the pending-schema helpers, the agent
  constructors, the error classes chains branch on. It is the same
  objects the engine itself holds, passed by reference, never resolved.
- **Type-only imports stay.** `import type { Chain, FlumeApi } from
  "@dtmd/flume"` is erased at runtime, so a types-only devDependency
  cannot execute and its staleness cannot reach a tick.
- A chain module whose default export is not a function is **refused**
  at load with a usage-shaped error naming the migration — the v0.2 §3
  mount-dead class, not a silent fallback to the old shape.
- The engine's own dogfood chain moves to the same shape. No exemption
  for the host repo.

`src/index.ts` remains the package's public surface for programmatic
embedders (anyone constructing a `Dispatcher` directly) and for types.
What changes is that chains stop taking *values* from it.

Supersedes: v0.2 §2's `agent` named export re-resolving with the chain,
v0.2 §3's "default-exports a valid Chain" as `chainLoadGate`'s check
(now: default-exports a factory returning a valid `ChainModule`), and
v0.3 §2's `ChainModule.forkResolver` named-export bridge.

Explicitly not in this section: any loader hook or specifier rewriting;
any version comparison, handshake, or lockfile check (the v0.9 doctrine
stands — this is an identity change, not a version one).

Blast radius: `src/Dispatcher.ts` (`loadChain`, `diskChainLoader`),
`src/index.ts` (the `FlumeApi` type and the object the engine passes),
`src/builtinGates.ts` (`chainLoadGate`'s validation), `.flume/chain.ts`,
`examples/`, `tests/` (every `staticLoader` fixture), `README.md`,
`docs/CHAIN-AUTHORING.md`, `docs/MIGRATING-0.11.md`, CHANGELOG.

Acceptance: a chain factory receives the **identity-same** objects the
dispatcher holds (compared with `toBe`, not deep-equal — a resolved
second copy would pass a structural check); a consumer chain's only
engine import is `import type`; a default export that is not a function
exits with the mount-dead code and names the migration; a chain that
value-imports the engine is unnecessary to test because nothing in the
engine resolves it; `.flume/chain.ts` runs under the factory shape with
the suite green.

## 7. Docs

- `README.md`, `docs/CLI.md`: jobs described as coexisting state
  roots; branch guidance reduced to "run on whatever branch you want
  the record on"; worktrees documented as the operator's parallelism
  recipe; tip claim/verify behavior documented as facts an operator
  may hit.
- `docs/CHAIN-AUTHORING.md`: `harvest` retired; `seedDir` and
  `friction` unchanged. The chain-shape section leads with the factory
  (§6) — every value the chain composes with arrives as a parameter,
  and the only engine import a chain writes is `import type`.
- New `docs/MIGRATING-0.11.md`: for bays with live `job/<name>`
  branches — integrate or abandon the branch with ordinary git (merge
  keeps the record, squash keeps it clean; the state root rides
  either way), delete the branch, done. Includes the extract-
  replacement recipe (side branch + operator integration). Also
  carries the §6 chain-shape migration: wrap the existing chain object
  in a factory, take every engine value from the parameter, and demote
  the remaining engine import to `import type`. Names the symptom
  operators will have already seen — a raw `ERR_MODULE_NOT_FOUND` for
  the package that is running, or unexplained `instanceof` failures —
  so the doc is findable from the failure.

- `docs/CHAIN-AUTHORING.md` additionally gains a `shouldRun` section
  beside `handoff` (§8), leading with the yield-to-pickable-work case
  that motivated it and stating the cheap-and-synchronous contract.
- `docs/CLI.md` and `README.md`'s `status` lines match §10 — no doc
  claims `flume status` prints a commit.
- `docs/CHAIN-AUTHORING.md` §10 states the extension field's declared
  type as a Standard Schema validator (§11), keeping its zod example as
  *an* implementation rather than the contract, and noting that a chain
  calling `.parse()` on its own schema is unaffected.
  `docs/MIGRATING-0.11.md` carries no §11 migration step — the widening
  compiles existing chains as-is — but records the failure it retires:
  an extension declared against a zod copy the engine does not share,
  surfacing as an internal `TypeError` naming neither field nor version.

Acceptance: `grep -rin 'extract' README.md docs/CLI.md
docs/CHAIN-AUTHORING.md` is empty; MIGRATING-0.11 contains the
branch-integration, extract-replacement, and chain-factory recipes;
no doc shows a chain taking a *value* from an engine import; no doc
claims `flume status` prints a commit.

## 8. `Phase.shouldRun` — decline before the invocation

An optional predicate the dispatcher consults **before** rendering the
prompt or invoking the agent. Returning `false` ends the tick as a
declined no-op: no agent invocation, no commit, `handoff` still runs so
the chain can pass the baton on.

```ts
shouldRun?: (ctx: TickContext) => boolean;
```

- **Undeclared is unchanged behavior.** A phase without `shouldRun`
  always runs, byte-identically to today. A capability with an injection
  point, not a policy: the engine supplies the skip, the chain supplies
  the reason (`engine-boundary.md`, *Capability vs convention*).
- **Context is what already exists.** `TickContext` carries `pending`
  (all entries, for singleton phases that read the plan) and
  `assignedEntry`. No new plumbing; the predicate sees what `promptArgs`
  sees.
- **Synchronous, and cheap by contract.** It runs before every
  invocation. A predicate needing I/O is doing too much — that work
  belongs in the tick it is trying to avoid.
- **A declined tick is a distinguishable fact**, not a silent no-op: it
  reports its own outcome in the tick summary/verdict, separate from
  `voluntary-bail` (the agent ran and refused) and from hibernation
  (nothing was awake). A supervisor must be able to tell "the chain
  declined" from "the agent bailed" without reading session logs —
  otherwise the fix hides exactly what it set out to expose.
- **Baton mechanics unchanged.** The phase sleeps and `handoff` runs
  exactly as on a no-commit tick.

Acceptance: a phase whose `shouldRun` returns `false` produces no agent
invocation (asserted against a stub agent that throws if called), no
commit, and still hands off; the same phase returning `true` is
byte-identical to a phase declaring none; a chain declaring no
`shouldRun` anywhere reproduces today's tick counts exactly; the
declined outcome is distinguishable in the verdict from
`voluntary-bail`.

## 9. Worktree directory names are length-bounded

`createWorktree` derives the fanout worktree directory from
`slugify(entry.tag)`. It instead derives a **length-bounded** name: the
slug truncated to a fixed budget, plus a short hash of the full tag so
distinct tags stay distinct.

Why: `git worktree add` refuses a worktree path around 200 characters on
win32 with `fatal: '$GIT_DIR' too big` — below MAX_PATH, unaffected by
`core.longpaths`, and untouchable by Node-side `toNamespacedPath`
because git builds that path itself. `TAG_MAX_LENGTH` is Linux
`NAME_MAX` arithmetic (`255 - 39`), so the schema accepts tags whose
fanout worktree cannot be provisioned on Windows. The engine already
reports this loudly (a `provisionFailure` carrying git's own error) —
but the entry can never ship on that platform, and nothing warns the
author upstream.

- The bound is an engine constant chosen so `<wtBase>/<namespace>/<dir>`
  clears git's ceiling with room to spare — not a chain knob, because it
  is a property of git, not of any implementation's taste.
- **The tag itself is untouched.** `pending.json`, commit messages,
  logs, the §5 prior-attempt record, and every tag-keyed lookup keep the
  full tag. Only the directory name is bounded. Shortening the tag would
  be a breaking schema change punishing POSIX chains for a
  git-on-Windows limit.

Acceptance: a fanout entry whose tag is `TAG_MAX_LENGTH` characters
provisions and ships on win32; two tags sharing their first N characters
get different worktree directories; the full tag still appears in the
commit message and the entry's §5 record; the two win32-skipped cases in
`tests/Dispatcher.test.ts` (`PRIORATTEMPT-WIN32-PATH-TOTAL-LIMIT`,
`TAG-LENGTH-BOUND-AGREEMENT-PIN`) come off their skips and run on every
platform.

## 10. `flume status` — the "last commit" clause is retired

v0.1 §3 says `status` prints "awake phases, pending entry count, last
commit". The first two shipped; the third never did, and should not.
`git log -1` already answers it, `engineering.md`'s *Derived state is
computed, never restated beside its source* names "a HEAD sha beside
git" as the shape to avoid, and printing it would give a command
specced to always exit 0 its first failure mode outside `.flume/` (a
detached HEAD, a repo with no commits).

`flume status` owes: awake phases, pending entry count, supervisor
liveness, tip claim state, and the chain-declared extras (friction count
where declared and non-empty).

Acceptance: `docs/CLI.md`, `HELP_TOP`, and `HELP_SUB.status` describe
exactly that list and no more; `flume status` still exits 0 on a
detached HEAD and in a repo with no commits; no doc claims `status`
prints a commit.

## 11. The extension seam takes a validator, not a zod schema

§6 removed the engine as a runtime dependency of the chain. One
dependency survived it running the other way: the chain still
constructs **zod** objects and hands them to the engine, which merges
them into its own schema graph. `EntryExtensionField.schema` changes
type from `z.ZodTypeAny` to `StandardSchemaV1`, and the engine adapts
each declared validator at the boundary. No chain-constructed schema
object enters an engine schema graph again.

Why: `composePendingList` merges the chain's objects at exactly two
lines — `PendingEntryCore.extend(shape)` and
`PendingEntryCore.shape.tag.and(refinement.schema)`
(`src/PendingSchema.ts:240`, `:244`; `renderSchemaForPrompt` reads only
`hint`, never the schema). A merge reaches into zod's internal
protocol, so it holds only while both sides are the same physical copy.
Measured, engine on 4.0.17:

- a bay on **4.4.3** composes and enforces correctly — a `^4.0.0` range
  skew is benign;
- a bay on **3.25.76** composes *silently*, then every `safeParse`
  throws `TypeError: Cannot read properties of undefined (reading
  'traits')` from inside zod. Because it **throws** rather than
  returning a failed result, it escapes `parsePending`'s `ParseResult`
  contract entirely: `readPending` never converts it to
  `PendingParseFailure`, and `readPendingTolerant`'s declared
  degradation (`Dispatcher.ts:2592`) is bypassed with it. Loud, but
  naming neither the field nor the skew.

And the merge buys the engine nothing. Extension fields are typed
`unknown` on `PendingEntry` (`PendingSchema.ts:139-140`) — the chain
narrows locally — so the engine derives no type information from the
objects it merges. What its mechanics consume is a verdict and a value
per field, plus the field *names* for `.extend`'s strict-unknown-key
rejection — all three of which a validator protocol supplies without the
engine ever holding the chain's object.
Holding the object is the engine reaching past what it consumes
(`engine-boundary.md`), and guarding the skew rather than removing it
would be the shallow fix (`engineering.md`, *The fix lands at the
mechanism*).

Shape:

- **`EntryExtensionField.schema: StandardSchemaV1`.** Standard Schema is
  the cross-library validator protocol; zod ≥3.24, valibot, and arktype
  all publish `~standard`. A chain may declare its fields with any of
  them, or with a hand-written object.
- **The engine adapts, never merges.** Each declared validator is
  wrapped in an *engine-instance* schema that calls
  `validator["~standard"].validate(value)`, re-raises the returned issues
  with their own messages and paths, and **returns the validator's output
  value** on success. Every downstream mechanic is unchanged: strictness,
  entry-indexed error paths, the `tag` intersection floor, queue-wide tag
  uniqueness, `ParseResult`'s shape.
- **A validator produces a value, not just a verdict.** Standard Schema
  returns `{ value }` on success precisely because validators transform —
  defaults, coercion, trimming. The adapter is a value-preserving
  position in the schema, never a bare check: `.flume/chain.ts:87`
  declares `tests` as `.default([])`, and an adapter that forwarded only
  the verdict would silently stop materializing it. Measured: the
  verdict-only shape drops the key; the value-preserving shape yields
  `tests: []` from both a 4.4.3 and a 3.25.76 bay.
- **The `tag` floor keeps its meaning.** The engine's mechanical pattern
  intersects with the *adapted* refinement, so a chain still only
  narrows the grammar and can never widen past or replace the floor
  (v0.8 §3, unchanged).
- **An async validator is refused, loudly, naming the field.** Standard
  Schema permits a `Promise`; `parsePending` is synchronous and feeds
  decision and rewrite paths, and a `Promise` read as a result object has
  no `issues` — it would **accept everything**. The refusal is a declared
  error class thrown by the adapter, the same treatment
  `composePendingList` already gives a core-field-shadowing extension: a
  chain-config defect, not a pending.json defect, so it does not become a
  `ParseResult` issue. It surfaces at first parse rather than at compose,
  because asynchrony is only observable by calling. Measured: the throw
  escapes zod rather than being swallowed into an issue, so the refusal
  holds.
- **`StandardSchemaV1` is vendored, not depended on** — a type-only
  declaration carrying no runtime code, per the spec's own
  published-to-be-copied posture. zod ships its own copy
  (`zod/v4/core/standard-schema`), and the two unify structurally, so
  vendoring costs a chain nothing and keeps flume's public type off a
  deep import into another library's internals.
- **`zod` stays a private engine `dependency`.** Not a peer, not
  re-exported on `FlumeApi`. Both alternatives guard the skew instead of
  removing it, both leave a bay free to reintroduce it by ignoring the
  API, and both put a third-party library on flume's public surface —
  freezing its major for every bay that declares an extension.

Existing chains need no change: every zod schema already satisfies
`StandardSchemaV1`, so this widens the declared type and compiles as-is.
A chain calling `.parse()` on its **own** schema (`.flume/chain.ts:409`,
`docs/CHAIN-AUTHORING.md` §10) is untouched — it owns that object and
its concrete type.

Blast radius: `src/PendingSchema.ts`, new type-only
`src/standardSchema.ts`, `src/index.ts`, `tests/PendingSchema.test.ts`,
`docs/CHAIN-AUTHORING.md` §10, `docs/MIGRATING-0.11.md`, CHANGELOG. No
chain change: `.flume/chain.ts`, `examples/`, and
`.github/workflows/ci.yml` compile untouched.

Acceptance: the agreement gate drives the **real** `parsePending` over
an extension whose validators are hand-written `~standard` objects built
with no zod at all — proving library-independence, not merely
version-independence — and asserts the whole verdict set: a conforming
entry accepts; a field violation rejects carrying the foreign
validator's own message at the entry-indexed path, and a nested one at
its composed path (`[0].per.path`, not `[0].per`); a chain `tag`
refinement narrows and cannot widen the core floor; an undeclared key
rejects; a duplicate tag rejects. The pin carries its vacuity assertion
— the foreign validator was actually invoked, not skipped past.

Two pins beyond the verdict set, each failing on a plausible wrong
implementation: **a declared field whose validator supplies a value for
an absent key materializes it in the parsed entry** (the drafting error
this section caught — a verdict-only adapter passes every other case in
this list while silently dropping `.flume/chain.ts`'s `tests: []`), and
**an async validator's declaration is refused naming the field** rather
than accepting the entry vacuously. A chain declaring zod schemas parses
byte-identically to today.

## 12. CHANGELOG

- 0.11.0 section: Breaking — the job branch convention (`job/<name>`)
  is retired; `flume job extract` and `Chain.harvest` are removed; the
  HEAD-guard legs on tick/loop are removed; `job new`/`run`/`rm` no
  longer create, assert, or switch branches. **A chain module now
  default-exports a factory `(api) => ChainModule` instead of a `Chain`
  object, and takes every engine value from that parameter; `agent` and
  `forkResolver` move from named exports onto the factory's return. A
  non-function default export is refused. This removes the dual-engine
  process class — a globally-invoked engine running against a bay-
  resolved chain copy, splitting `instanceof` and module state at equal
  versions — see MIGRATING-0.11.** Added — advisory tip claim (one
  flume writer per tip, worktree-visible, stale-reclaimed) and
  tip-moved verify (no commit onto a tip that moved mid-tick; reported
  as a tick fact). Existing `job/<name>` branches are the operator's to
  integrate — see MIGRATING-0.11.
- Also in 0.11.0: **Added** — `Phase.shouldRun`, an optional predicate
  consulted before the agent is invoked, so a chain can decline a tick
  without spending one; a declined tick is reported as its own outcome,
  distinct from a voluntary bail (§8). **Changed** — fanout worktree
  directory names are length-bounded, the full tag preserved everywhere
  it is read, so a max-length tag provisions on Windows where
  `git worktree add` refuses a path around 200 characters (§9).
  **Removed** — `flume status` never printed a last commit and no longer
  claims to; supersedes v0.1 §3's third clause (§10).
- Also in 0.11.0: **Changed** — a `Chain.entryExtension` field declares
  its validator as a Standard Schema (`~standard`) rather than a zod
  schema, and the engine adapts it instead of merging it. Existing zod
  declarations satisfy the new type and need no edit; what goes away is
  the failure where a chain's zod copy is not the engine's — previously
  an internal `TypeError` thrown past `parsePending`'s structured-error
  contract, naming neither the field nor the version skew. `zod` remains
  a private engine dependency: not a peer, not re-exported (§11).
- Version bump + `npm publish` stay human-performed at cut time.

