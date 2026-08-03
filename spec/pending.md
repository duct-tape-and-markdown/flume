# The pending queue

The pending queue is the contract between a producer phase and a consumer phase: a JSON array
at `<flumeDir>/plan/pending.json`, each element one unit of work. This file governs what the
engine owns in that shape (`src/PendingSchema.ts`), what a chain declares on top of it, how an
entry becomes pickable, how a picked entry's writes are fenced, how entries are partitioned
into a parallel wave, and what counts as shipping one. The engine validates and interprets only
what its own mechanics consume; everything else on an entry is chain-declared payload it passes
through untouched.

## The entry core

`PendingEntryCore` (`src/PendingSchema.ts`) is a **strict** object — a field that is neither core
nor chain-declared fails validation loudly. Silent stripping is not an option: the dispatcher
rewrites `pending.json` on ship, so a stripped field would be destroyed on disk.

- **`tag`** — identity. Appears in commit messages, worktree/branch slugs, and revert-note
  filenames. Grammar below.
- **`gate`** — a discriminated union controlling pickability: `open`, `blockedBy{tag}`,
  `parked{reason}`, `deferred{reason}`, `requiresCapability{capability}`.
- **`dependsOnForks`** — array of opaque fork slugs, defaulting to `[]`. A cross-cutting
  pickability predicate, not a gate kind (below).
- **`files`** — `{ new: FileChange[], edit: FileChange[], retire: string[] }`, each `FileChange`
  a `{ path, description }`. The fence declaration and the partition input.
- **`observedFiles`** — optional `string[]`, dispatcher-maintained. Not authored by the producer
  phase.

The parsed type is `PendingEntry = z.infer<typeof PendingEntryCore> & Record<string, unknown>`:
extension fields are typed `unknown`, because the chain that declared them is the side that
knows their shape and narrows locally.

Entry order is meaningful — top is next. An empty array is valid and means nothing pending.

## Tag grammar is mechanical safety, nothing more

`TAG_PATTERN` admits letters, digits, and `._()-`, length 1..`TAG_MAX_LENGTH`. No whitespace, no
path separators. `TAG_MAX_LENGTH = 255 - 39`: 255 is the conservative shared filesystem
`NAME_MAX`, and 39 is the fixed scaffolding `Dispatcher.writeRevertNote` wraps around a raw tag
(`<stamp>--<tag>--reverted.md`) — the tightest raw-tag consumer. Every other tag-derived
component (the commit-message token, and the `slugify`d branch name and prior-attempt key —
`slugify` never lengthens) is looser, so this bound clears them too. It is not the only ceiling a
tag meets: the worktree **directory** component answers to
git's own win32 worktree-path wall, which is tighter than `NAME_MAX` and independent of it, so a
schema-valid tag's raw slug can exceed it — `worktreeDirName` truncates and hashes to stay under
(see spec/worktrees.md). The arithmetic lives at the writer, not in a second copy here, and is
pinned against the real writer by a gate-revert on the longest tag the schema accepts.

Queue-wide **tag uniqueness** is enforced by the composed list schema, and is mechanical too:
`cli`'s find-by-tag and the dispatcher's `blockedBy`/`shippedTags` lookups key on the tag, so a
duplicate silently resolves to the wrong entry. Every index sharing a tag gets its own issue
naming the others, so a three-way collision is fully attributed.

Anything beyond this — an ALL-CAPS house style, a slug convention — is a chain's refinement,
declared in its extension. The engine has no stake in tag grammar it never parses.

## The chain-declared extension

A chain declares `Chain.entryExtension?: EntryExtension` — `Record<string, EntryExtensionField>`,
each field carrying **both** its validator and its prompt hint:

```ts
interface EntryExtensionField { schema: StandardSchemaV1; hint: string }
```

One declaration drives two surfaces: `composePendingList` builds the validator,
`renderSchemaForPrompt` builds the prompt's schema block. The prompt and the parser cannot
disagree, because there is only one declaration to disagree with. A chain declaring no extension
gets the bare core, and validates and renders as such.

- **The engine adapts, never merges.** `adaptStandardSchemaField` wraps each declared validator
  in an engine-instance zod position that calls `field.schema["~standard"].validate(value)`,
  re-raises returned issues with their own messages at their own composed paths, and returns the
  validator's **output value**. No chain-constructed schema object enters an engine schema graph.
- **The adapter is value-preserving, never a bare check.** Standard Schema returns `{ value }` on
  success precisely because validators transform — defaults, coercion, trimming. A verdict-only
  adapter passes every obvious test while silently dropping a `.default([])` field. The wrapper is
  `z.any().optional()` so the enclosing object defers to the validator's own verdict on an absent
  key rather than synthesizing its own "required" issue and discarding the validator's result —
  that is the mechanic defaulted fields depend on.
- **An extension may not shadow a core field**, with one exception: **`tag`**. A declared `tag`
  composes as an intersection with the core pattern, so a chain can only narrow the grammar,
  never widen past or replace the mechanical floor. The rendered schema block composes the same
  way — the tag line reads the core hint `AND` the chain's hint, so the prompt states whichever
  constraint is actually in force. Shadowing any other core field throws — a
  chain-config defect, not a `pending.json` defect, so it never becomes a `ParseResult` issue.
- **An async validator is refused, loudly, naming the field** (`AsyncEntryExtensionValidatorError`).
  `parsePending` is synchronous and feeds decision and rewrite paths; a `Promise` read as a result
  object has no `issues` and would accept everything. It surfaces at first parse, not at compose,
  because asynchrony is only observable by calling `validate`.
- **`StandardSchemaV1` is vendored type-only** (`src/standardSchema.ts`), not depended on. The
  spec is published to be copied; zod ≥3.24, valibot, and arktype all publish `~standard` and
  unify structurally. `zod` stays a private engine dependency for the core fields — not a peer,
  not re-exported on `FlumeApi`. Putting a third-party library on flume's public surface would
  freeze its major for every bay that declares an extension.

**Why a validator protocol rather than a schema merge.** A merge reaches into zod's internal
protocol, so it holds only while both sides are the same physical copy. Measured against an
engine on 4.0.17: a bay on **4.4.3** composes and enforces correctly (a `^4.0.0` range skew is
benign); a bay on **3.25.76** composes *silently*, then every `safeParse` throws
`TypeError: Cannot read properties of undefined (reading 'traits')` from inside zod — and because
it **throws** rather than returning a failed result, it escapes the `ParseResult` contract
entirely, bypassing both the parse-failure path and `readPendingTolerant`'s declared degradation.
Loud, but naming neither the field nor the skew. The merge also bought nothing: extension fields
are typed `unknown`, so the engine derived no type information from the objects it held. What its
mechanics consume is a verdict, a value, and the field *names* (for strict unknown-key rejection)
— all three of which a validator protocol supplies without the engine ever holding the chain's
object.

## `files` is a prediction the scheduler consumes

`declaredPaths(entry)` is `files.new[].path ∪ files.edit[].path ∪ files.retire`. It is what the
entry's author committed to. Four mechanics read it: the fanout partition (below), ship
detection, `pendingGate`'s fence pre-check, and — only where a chain opts in — the entry-scoped
write guard and the prompt's effective-fence rendering.

`files` is a **prediction, not a permission**. The producer declares what the work will touch —
accurately, neither defensively nor aspirationally. Over-declaring costs wave width, because the
partition treats a shared path as a collision; under-declaring costs at most a cherry-pick
conflict, which the dispatcher aborts and leaves pending for a retry. Where a phase may write is
`phase.writablePaths`, not any entry's business (see *The entry-scoped write guard is opt-in*).

## Pickability

Two implementations, one rule set:

- **`isPickableNow(entry, shippedTags, isForkResolved?, capabilities?)`** — exported for chains:
  the handoff/pickability reasoning a chain does off the API parameter (`.flume/chain.ts`,
  `examples/backlog-groomer-chain.ts`). Resolves `blockedBy` against a **shipped-tags set**.
- **`isPickable(entry, pending, isForkResolved?, capabilities?)`** — `src/Dispatcher.ts`, internal
  to fanout selection. Resolves `blockedBy` against the **pending list**: a dep is satisfied iff
  it is no longer pending, since entries are removed on ship.

Both short-circuit identically before the gate switch: **if any declared `dependsOnForks` slug is
unresolved, the entry is not pickable, regardless of gate kind** — including `open`. Then the
switch: `open` → pickable; `blockedBy` → iff the blocker landed; `parked`/`deferred` → never;
`requiresCapability` → iff the chain asserts the named string.

Selection additionally drops entries whose slug the supervisor quarantined earlier in the run
after a worktree-provisioning failure; `pending.json` itself is untouched, so a fresh run retries
from scratch (see spec/loop.md).

**Why `dependsOnForks` is a side-array and not a gate kind.** `gate` is a discriminated union —
one entry has exactly one gate state. An entry can simultaneously be `open`, rest on two open
forks, and later be capability-gated. Folding foundations into `gate` would force the producer to
choose which fact to record and lose the other. A composable array is strictly more expressive
for the same code. It defaults to `[]` — an entry declaring no fork never invokes the resolver and
is governed by its gate alone.

## The fork-resolution seam

Resolution detection is consumer policy, **injected**, never baked into the engine.

- `DispatcherOptions.forkResolver?: (repoRoot: string) => (slug: string) => boolean` — returns,
  for a given repo, a predicate answering "is this fork resolved?"
- `ChainModule.forkResolver` of the same shape, carried on the chain factory's **return value**
  (`(api: FlumeApi) => ChainModule`), not a named module export — a named export cannot receive
  the API, and leaving it as one would preserve exactly the resolution path the plugin boundary
  removes. See spec/chain.md.
- The dispatcher resolves `chainModule.forkResolver ?? this.opts.forkResolver` **once per tick**
  (beside the `agent` override), calls it with `repoRoot`, and threads the resulting predicate
  into fanout selection. Selection is the sole site; a singleton phase does not pick from pending.
- **Default: every slug resolved.** A chain supplying no resolver, or an entry declaring no
  forks, never changes behavior.
- **The engine is format-agnostic.** It does not know that one project marks resolution with a
  `RESOLVED` token on the slug line and another uses an `OQ#` header. Encoding either would couple
  a generic harness to one project's prose format. The resolver is where that knowledge lives.
- **Fail-open is the resolver's contract, documented, not enforced.** The recommended resolver
  treats an **absent** slug as resolved (a fork answered and deleted must *unblock* its dependents,
  never wedge them) and an **unknown/mistyped** slug as resolved (a bookkeeping error must never
  permanently block the loop). The engine takes no position; it trusts the predicate.

## Environment-gated pickability

`gate: { kind: "requiresCapability", capability: string }` is pickable iff the string appears in
the chain's declared `Chain.capabilities?: string[]`. `chain.ts` is TypeScript, so a chain may
probe the environment at load time and assert a capability only when the probe succeeds.
Undeclared means nothing is asserted: a capability-gated entry stays non-pickable until the chain
names it.

The skip is never silent — `flume status` names every entry stuck on an unasserted capability and
the capability it wants (see spec/cli.md). The mechanism is generic by construction; no named
environment is an engine enum variant.

## Selection-time semantics

The governor runs **at selection time, before any agent is invoked or any worktree is created** —
the same place and shape as `blockedBy`. A blocked entry is simply not pickable this tick, and
three behaviors fall out of the one filter:

- **Skip-to-settled.** Selection filters the whole pending list before partitioning, so a blocked
  head entry is skipped and a deeper settled entry builds. No separate code path.
- **Idle, not build-laterally.** If every entry is blocked, `pickable.length === 0` and the phase
  returns the clean no-work outcome — no agent ran, so no no-commit classification applies —
  handoff advances the phase and the loop drains to hibernation. **A hibernating loop here is the
  intended signal**, not a fault: the next work needs a human decision, which is louder and safer
  than shipping onto an unsettled foundation.
- **Never failed, never reverted.** A blocked entry is not mutated, not marked failed, and burns
  no gate-revert. It is invisible to selection until its blocker settles, then picked up
  automatically on the next tick.

## Fanout partition — disjoint touched paths

`partitionByFileOverlap(entries, { maxParallel })` groups pickable entries into ordered batches
whose members have **disjoint `touchedPaths()` sets**, so a batch can run in parallel worktrees.
It is greedy: walk pending in order, place each entry in the first batch that has room
(`< maxParallel` members) and whose paths it doesn't collide with, otherwise open a new batch — so
a batch closes on capacity as well as on overlap. Not optimal by count, but stable and respectful
of pending order (priority). The dispatcher runs `batch[0]`, then re-derives pending and partitions again.

`maxParallel` comes from `DispatcherOptions.maxParallel` and **defaults to 4**. The CLI forwards
no override, so a CLI-driven wave runs at most four agents concurrently; only a programmatic
embedder changes it. The value is unvalidated: a non-positive one satisfies no batch's capacity
test, so every entry opens its own batch and the wave runs a single entry rather than refusing.

The disjointness input is deliberately **wider** than the fence input:

```
touchedPaths(entry) = declaredPaths(entry) ∪ (entry.observedFiles ?? [])
```

`declaredPaths` is what the author promised; `observedFiles` is what a reverted attempt actually
touched. The partition needs the union — otherwise a retry rides the same wave as the entry it
already collided with. The write guard and ship detection deliberately do **not** consume
`observedFiles`: it feeds parallelism, not permission, and not proof of work.

## `observedFiles` — the dispatcher's collision record

`observedFiles` is dispatcher-maintained, never producer-authored. It records the *actual* commit
footprint of an attempt that did not ship, persisted on the entry so the next partition separates
the retry from whatever it collided with — even where the declared `files` understated the reach.
It is written from three paths:

- an **`afterMerge` gate failure**, where the cherry-picked commit's diff is the footprint and
  trunk is reset;
- an **in-worktree `afterCommit` gate revert**, where the footprint is captured from the gate
  loop's already-computed diff before `dropLastCommit` discards the evidence;
- a **cherry-pick conflict**, where the un-merged worktree commit's diff is captured before
  `cherryPickAbort` — best-effort: if `showNameOnly` throws, no footprint is recorded and the
  retry partitions on declared files alone. Nothing landed on trunk, so this is not a revert, but
  it grows the collision record all the same: `commitPendingUpdate` folds in every merge outcome
  carrying a non-empty footprint, without filtering on outcome kind.

All three land through the same wave-end `pending.json` rewrite, sourced from the wave's own verdict
records rather than a second bookkeeping map. A producer phase may carry or drop the field
freely — the dispatcher rebuilds it on the next failure.

## The entry-scoped write guard is opt-in, and off by default

**`phase.writablePaths` is the containment boundary.** It is a standing fact about the phase —
build writes code, a producer phase writes plan artifacts, neither writes spec — and it is
enforced on every tick, scoped or not. That is the guard's whole default behavior.

**Narrowing further to the assigned entry is a chain declaration**, `Phase.scopeWritesToEntry`,
default `false`. Undeclared, a scoped tick's write allowance is byte-identical to a singleton
tick's. Declared:

```
declaredPaths(entry) ∪ phase.entryChannelPaths     — the fence
with phase.writablePaths                            — the outer ceiling (both checks apply)
```

Why it is not the default: where a phase may write is a standing relationship between phases,
and `writablePaths` is where a chain declares it. An entry is a *work item* — pushing the write
allowance down into it makes the producer phase the authority over the consumer phase's
implementation, which is the lane inversion `.claude/rules/spec-plan-build.md` forbids
everywhere else. It also overloads one field with opposed pressures: `files` is simultaneously
the fanout partition's disjointness key (which wants a narrow, honest declaration) and a
permission whose under-statement reverts the commit (which wants a wide, defensive one). No
producer can satisfy both, and the failure is measurable — when one shared path entered
substantially every entry, mean first-batch wave width fell from 3.17 to 1.99 at
`maxParallel: 4`.

The capability stays because a chain may legitimately want blast-radius bounding on a risky
entry, and because the mechanism is already correct — `writablePathsGate` takes its entry scope
as an optional parameter and runs the ceiling check unconditionally. The dispatcher supplies
that parameter only when the phase asks for it (`Dispatcher.runAfterCommitGates` consults
`phase.scopeWritesToEntry`), so narrowing is a chain declaration rather than engine behavior.
Flume's own chain declares nothing and is therefore containment-only.

- **`Phase.entryChannelPaths?: string[]`** (default `[]`) — globs always writable on a scoped
  tick regardless of what the assigned entry declared. The channel allowance for cross-tick
  artifacts an entry never declares: a build phase reporting a finding into the producer's
  open-questions file, prior-attempt context, and the like.
- **The union has one home.** `entryWriteScopeUnion` (`src/paths.ts`) is consumed both by
  `writablePathsGate`'s entry-scope check, which enforces the fence, and by
  `effectiveFenceLines` (`src/Prompt.ts`), which renders it into the tick's `<harness>` block.
  The stated fence and the enforced fence cannot differ, because they are the same computation.
  Path matching is `matchesAny` (`src/paths.ts`) — regex specials escaped, `*` and `**` the only
  wildcards, so a declared literal path matches only itself.
- **Failure semantics are the phase guard's**: whole-commit revert. The violation message
  distinguishes the two failure modes — outside the ceiling, versus inside the ceiling but
  outside the entry's fence — and names the offending paths, which reach the retrying tick
  through the `<prior-attempt>` block's gate details (see spec/loop.md).

## Ship detection requires a declared-files diff

Landing on the trunk is not shipping. A commit that only writes an `entryChannelPaths` file — a
park note, no implementation — passes every check on that path, and classifying it as shipped
would remove a never-built entry from the queue.

Before an entry joins `shipped`, the dispatcher diffs the cherry-picked commit against the
entry's **declared** `files.{new,edit,retire}` — `declaredPaths`, deliberately not
`touchedPaths()`, which folds in `observedFiles`, itself a downstream artifact of prior
collisions rather than evidence that *this* diff shipped work. The commit diff is the one the
gate loop already computed for this commit, not a second `git show --name-only`.

- **Zero overlap → not shipped.** The entry is not added to `shipped`/`shippedTags` and stays in
  `pending.json` exactly as it is on disk — the absence of a removal, not a new write.
- **Any overlap → shipped**, including a real ship that also touches channels alongside its
  declared files. The predicate refuses only the zero-declared-files case.
- **The commit still lands.** This gates *classification*, not *landing*: channel content must
  still reach the trunk. Only whether the entry leaves the queue changes.
- **The refusal is logged distinctly** (`touches no declared file — entry stays pending
  (channel-only commit)`), paired with the cherry-pick line, and recorded as a `channel-only`
  merge outcome in the tick verdict — so the wave log and the verdict both separate
  landed-but-not-shipped from landed-and-shipped.

No new no-commit mode. The no-commit taxonomy classifies ticks that produced no usable commit;
this sits downstream of a commit that did land, cherry-picked clean, and passed its gates. See
spec/loop.md for the taxonomy and the verdict artifact, and spec/worktrees.md for the
per-entry revert isolation the fanout merge path uses.

## Wave auto-unblock

A `blockedBy` gate naming a tag the same wave shipped is opened **mechanically**, at wave-end
bookkeeping: the dispatcher just merged and gated that tag, so "did the blocker land" needs no
producer tick, and a chained entry advances without a plan interim. Judgment gates (`parked`,
`deferred`) are never auto-opened — those are the producer's call.

The rewrite re-reads `pending.json` fresh immediately before deriving it, **not** the tick-start
snapshot: a wave's fanned-out agent runs and serial cherry-picks can take long enough for another
process to land its own commit to the queue, and deriving from the stale snapshot would blindly
overwrite that write. Sourcing from current on-disk state means the wave only ever removes the
tags it shipped and touches `observedFiles`/`blockedBy` for tags it knows about.

A footprint-only update that changes nothing is skipped rather than committed — committing an
unchanged file fails. When the state root is relocated outside the repo, the ledger is written to
disk with no chore commit: an out-of-tree state root is invisible to git by construction, and the
disk write alone carries the auto-unblock and footprints forward.

The ledger commit's message is caller-overridable (`DispatcherOptions.commitMessage`, called with
the tags this wave shipped and the tags whose footprints it recorded) — the
`chore(flume): ship <tags>` / `chore(flume): record merge-failure footprints for <tags>` wording
is a chain's convention, not the engine's, the same split `spec/jobs.md` states for the seed
commit.

## `pendingGate` — validation and fence pre-check as an opt-in builtin

`pendingGate(opts)` (`src/builtinGates.ts`) is an `afterCommit` gate a chain attaches to whichever
phase produces the queue. It is a convenience builtin, not engine behavior — a chain that wants
neither check attaches neither.

1. **Schema validation.** Parses the queue against the composed core + `opts.extension` — the
   same declaration passed to `renderSchemaForPrompt`, so gate and prompt cannot drift. Failure
   reports one line per issue, entry-indexed.
2. **Fence pre-check.** Each entry's `declaredPaths` are matched against
   `opts.targetFence.writablePaths ∪ opts.targetFence.entryChannelPaths` — typically the consumer
   phase passed as the value itself. An entry whose declaration cannot survive the consumer's
   fence fails **here, at the producer's own commit, naming the offending paths**, instead of
   being handed downstream as work guaranteed to revert.

The gate runs on **every** commit of the phase it is attached to — it never consults the commit's
touched paths — and an absent queue file fails it (`<pendingPath> missing after commit`), which
reverts the commit. Attaching it to a phase whose ticks do not always leave a queue on disk
therefore reverts every such tick. This is the opposite policy from `chainLoadGate`
(see spec/chain.md), which skips-as-pass when the commit did not touch its artifact.

The fence is read fresh on every run, never hoisted to construction, so a declaration-driven
phase (writable paths backed by a per-job declaration read after the gate is built) is checked
against its current value. `opts.pendingPath` defaults to `plan/pending.json`.
`opts.fenceWhen?: (entry) => boolean` selects which entries are fence-checked, defaulting to all
— a chain that exempts, say, parked entries from the consumer fence supplies the predicate; the
engine ships the injection point and the chain owns which `gate.kind` values count as exempt.
`opts.hint` appends chain-authored operator guidance verbatim to both violation messages.

## Queue reads are strict

`Dispatcher.readPending` throws `PendingParseFailure` on a parse error rather than degrading to
`[]`. It backs every read the dispatcher **acts** on: the singleton and fanout decide-reads and
the wave-end rewrite read. A decision or a rewrite must never derive from an input that failed to
resolve.

`readPendingTolerant` is the one declared exception, used only for the informational
`TickResult.pendingAfter` re-read taken after the strict read already ran and after shipped work
already landed. A failure there means something outside the tick corrupted the file in between;
degrading to `[]` is bounded because that value feeds only a chain's advisory handoff check,
never a rewrite or a work decision.

`parsePendingLoose` is a separate core-only reader for chain-less informational commands that
count or inspect entries without loading the chain: it validates the core and passes unknown
fields through unvalidated. It is never used on a write path — rewriting the queue from a parse
that did not know the extension is how declared fields get destroyed.

## What the package exports

`src/index.ts` and `FlumeApi` (`src/flumeApi.ts`) are the canonical lists. Both carry the *values*
`composePendingList`, `parsePending`, `parsePendingLoose`, `renderSchemaForPrompt`,
`touchedPaths`, `isPickableNow`, and `partitionByFileOverlap`. Types are index-only by
construction — `FlumeApi` carries values, never types — so a chain takes `PendingEntry` /
`PendingList` / `EntryExtension` / `EntryExtensionField` / `ParseError` / `ParseResult` /
`StandardSchemaV1` through `import type` (erased at runtime), and every value off the API
parameter (see spec/chain.md).
